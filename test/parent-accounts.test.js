const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const session = require('express-session');
const Database = require('better-sqlite3');

const dbPath = path.join(os.tmpdir(), `kidview-accounts-${process.pid}.sqlite`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbPath;
process.env.VIDEO_SOURCE = 'mock';
process.env.DEMO_MODEL_COMPARISON_ENABLED = 'false';
process.env.APP_ORIGIN = '';
process.env.SESSION_SECRET = 'accounts-test-session-secret-at-least-32-characters';
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
require('../scripts/migrate');
const db = require('../app/db/database');
const { getParentSession, authenticateParent } = require('../app/services/authService');
const { listParents, saveParent, passwordHash } = require('../app/services/parentAccountService');
const { provisionDemo } = require('../app/services/demoHouseholdService');
const { createActiveChildToken, getActiveChildProfile } = require('../app/services/childProfileSessionService');
const { createApp } = require('../server');
const password = 'test-only-password-long';
const hash = passwordHash(password);
const householdId = Number(db.prepare("INSERT INTO households(name) VALUES ('Private owner household')").run().lastInsertRowid);
const ownerId = Number(db.prepare(`INSERT INTO parent_users(household_id, email, password_hash, display_name, role)
  VALUES (?, 'owner@example.test', ?, 'Private owner', 'admin')`).run(householdId, hash).lastInsertRowid);
const privateChildId = Number(db.prepare("INSERT INTO child_profiles(household_id, display_name) VALUES (?, 'Private child')").run(householdId).lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO households(name) VALUES ('Other private household')").run().lastInsertRowid);
const otherParentId = Number(db.prepare(`INSERT INTO parent_users(household_id, email, password_hash, display_name, role)
  VALUES (?, 'other@example.test', ?, 'Other private parent', 'admin')`).run(otherId, hash).lastInsertRowid);
const privateSearchId = Number(db.prepare(`INSERT INTO search_events(household_id, child_profile_id, query, original_query)
  VALUES (?, ?, 'Private search text', 'Private search text')`).run(householdId, privateChildId).lastInsertRowid);
const privateChannelId = db.prepare("INSERT INTO channels(source, external_id, title) VALUES ('mock','owner-private-channel','Private channel')").run().lastInsertRowid;
const privateVideoId = db.prepare(`INSERT INTO videos(channel_id,source,external_id,title,confidence_score,duration_seconds)
  VALUES (?,'mock','owner-private-video','Private video',0.99,420)`).run(privateChannelId).lastInsertRowid;
db.prepare(`INSERT INTO household_review_items(household_id,child_profile_id,video_id,status,reason_code)
  VALUES (?, ?, ?, 'pending', 'review')`).run(householdId, privateChildId, privateVideoId);
const demoId = provisionDemo({ email: 'visitor@example.test', password });
let server, base, store;
function owner() { return getParentSession(ownerId); }
function account(overrides = {}) {
  return { email: 'new@example.test', displayName: 'New parent', role: 'parent', password, isActive: '1', ...overrides };
}
function cookie(response, name = 'kidview.sid') {
  return response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';')[0] || '';
}
async function post(url, body = {}, cookies = '', headers = {}) {
  return fetch(base + url, { method: 'POST', redirect: 'manual',
    headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, ...headers },
    body: new URLSearchParams(body) });
}
async function login(email = 'owner@example.test', loginPassword = password) {
  const response = await post('/auth/login', { email, password: loginPassword });
  assert.equal(response.status, 302);
  return cookie(response);
}
async function get(url, cookies = '') {
  return fetch(base + url, { headers: { cookie: cookies }, redirect: 'manual' });
}
function snapshot() {
  // Session-store writes are expected; application rows must remain unchanged.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

test.before(async () => {
  store = new session.MemoryStore();
  server = createApp({ sessionStore: store, generalRateLimiter: (req, res, next) => next() }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
});

test('migration upgrades existing households and rolls back ambiguous logins safely', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  legacy.exec(fs.readFileSync(path.join(__dirname, '../app/db/migrations/001_initial_schema.sql'), 'utf8'));
  legacy.exec(`INSERT INTO households(name) VALUES ('First'), ('Second');
    INSERT INTO parent_users(household_id,email,password_hash,display_name) VALUES
    (1,'first@example.test','hash','One'), (1,'second@example.test','hash','Two'), (2,'third@example.test','hash','Three');`);
  const sql = fs.readFileSync(path.join(__dirname, '../app/db/migrations/014_parent_accounts.sql'), 'utf8');
  legacy.transaction(() => legacy.exec(sql))();
  assert.deepEqual(legacy.prepare('SELECT role FROM parent_users ORDER BY id').all().map(p => p.role), ['admin', 'parent', 'admin']);
  assert.equal(legacy.prepare('SELECT SUM(is_demo) AS count FROM households').get().count, 0);
  assert.equal(legacy.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();
  const ambiguous = new Database(':memory:');
  ambiguous.exec(fs.readFileSync(path.join(__dirname, '../app/db/migrations/001_initial_schema.sql'), 'utf8'));
  ambiguous.exec(`INSERT INTO households(name) VALUES ('First');
    INSERT INTO parent_users(household_id,email,password_hash,display_name) VALUES
    (1,'DUP@example.test','hash','One'), (1,'dup@example.test','hash','Two');`);
  assert.throws(() => ambiguous.transaction(() => ambiguous.exec(sql))());
  assert.equal(ambiguous.prepare('SELECT COUNT(*) AS count FROM parent_users').get().count, 2);
  assert.ok(!ambiguous.pragma('table_info(parent_users)').some(column => column.name === 'role'));
  ambiguous.close();
});

test('admin page creates, lists and updates accounts without exposing hashes', async () => {
  const adminCookie = await login();
  const created = await post('/parent/accounts', account({ householdId: String(otherId) }), adminCookie);
  assert.equal(created.status, 302);
  const parent = db.prepare("SELECT * FROM parent_users WHERE email = 'new@example.test'").get();
  assert.equal(parent.household_id, householdId);
  assert.notEqual(parent.password_hash, password);
  assert.equal(parent.role, 'parent');
  const page = await get('/parent/accounts', adminCookie);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /new@example.test/);
  assert.doesNotMatch(html, /other@example.test|visitor@example.test|\$2[aby]\$/);
  assert.ok(!Object.hasOwn(getParentSession(parent.id), 'password_hash'));
  const memberCookie = await login('new@example.test');
  assert.equal((await get('/parent/accounts', memberCookie)).status, 403);
  assert.equal((await post('/parent/accounts', account({ email: 'unauthorized@example.test' }), memberCookie)).status, 403);
  assert.equal((await get('/parent', memberCookie)).status, 200);
  const changed = await post(`/parent/accounts/${parent.id}`, account({ password: '', isActive: '0' }), adminCookie);
  assert.equal(changed.status, 302);
  assert.equal((await get('/parent', memberCookie)).status, 302);
  assert.equal(await authenticateParent('new@example.test', password), null);
  assert.equal((await post(`/parent/accounts/${parent.id}`, account({ password: '', isActive: '1' }), adminCookie)).status, 302);
  assert.equal((await get('/parent', memberCookie)).status, 302, 're-enabling must not resurrect an old session');
  const reenabledCookie = await login('new@example.test');
  assert.equal((await get('/parent', reenabledCookie)).status, 200);
  saveParent(owner(), account({ password: '', isActive: '0' }), parent.id);
  assert.equal((await get('/parent', reenabledCookie)).status, 302);
});

test('tenant tampering, duplicate emails, weak passwords and last-admin removal are rejected', async () => {
  const beforeOther = db.prepare('SELECT * FROM parent_users WHERE id = ?').get(otherParentId);
  assert.throws(() => saveParent(owner(), account({ email: 'other@example.test' }), otherParentId), /not found/);
  assert.deepEqual(db.prepare('SELECT * FROM parent_users WHERE id = ?').get(otherParentId), beforeOther);
  assert.throws(() => saveParent(owner(), account({ email: 'OTHER@example.test' })), /unavailable/);
  for (const weak of ['short', 'é'.repeat(37)]) assert.throws(() => saveParent(owner(), account({ password: weak })), /password/);
  assert.throws(() => saveParent(owner(), account({ email: 'owner@example.test', role: 'parent', password: '' }), ownerId), /at least one/);
  assert.throws(() => saveParent(owner(), account({ email: 'owner@example.test', role: 'admin', password: '', isActive: '0' }), ownerId), /at least one/);
  const adminCookie = await login();
  assert.equal((await post(`/parent/accounts/${otherParentId}`, account(), adminCookie)).status, 400);
  const csrf = await post('/parent/accounts', account(), adminCookie, { origin: 'https://attacker.example' });
  assert.equal(csrf.status, 403);
});

test('role changes, password resets and legacy sessions revoke access', async () => {
  const id = saveParent(owner(), account({ email: 'revoked@example.test', role: 'admin' }));
  const adminCookie = await login('revoked@example.test');
  saveParent(owner(), account({ email: 'revoked@example.test', role: 'parent', password: '' }), Number(id));
  assert.equal((await get('/parent/accounts', adminCookie)).status, 302);
  const memberCookie = await login('revoked@example.test');
  saveParent(owner(), account({ email: 'revoked@example.test', password: 'a-new-test-only-password' }), Number(id));
  assert.equal((await get('/parent', memberCookie)).status, 302);
  assert.equal(await authenticateParent('revoked@example.test', password), null);
  assert.ok(await authenticateParent('revoked@example.test', 'a-new-test-only-password'));
  const legacyCookie = await login();
  const sessions = await new Promise((resolve, reject) => store.all((error, rows) => error ? reject(error) : resolve(rows)));
  for (const [id, data] of Object.entries(sessions)) {
    if (data.parentUser?.id !== ownerId) continue;
    delete data.parentUser.sessionVersion;
    await new Promise((resolve, reject) => store.set(id, data, error => error ? reject(error) : resolve()));
  }
  assert.equal((await get('/parent', legacyCookie)).status, 302);
});

test('demo provisioning is isolated, idempotent, revocable and cannot convert a real account', async () => {
  const realBefore = db.prepare('SELECT * FROM parent_users WHERE id = ?').get(ownerId);
  const before = db.prepare('SELECT COUNT(*) AS count FROM child_profiles WHERE household_id = ?').get(demoId).count;
  assert.throws(() => provisionDemo({ email: 'owner@example.test', password }), /unavailable/);
  const visitorCookie = await login('visitor@example.test');
  assert.equal(provisionDemo({ email: 'visitor@example.test', password }), demoId);
  assert.equal((await get('/parent', visitorCookie)).status, 302);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM child_profiles WHERE household_id = ?').get(demoId).count, before);
  assert.deepEqual(db.prepare('SELECT * FROM parent_users WHERE id = ?').get(ownerId), realBefore);
  const demo = await authenticateParent('visitor@example.test', password);
  assert.equal(demo.isDemo, 1);
  assert.equal(demo.role, 'parent');
  assert.throws(() => listParents(demo), /administrator/);
  assert.throws(() => saveParent(demo, account()), /administrator/);
  provisionDemo({ email: 'visitor@example.test', disable: true });
  assert.equal(await authenticateParent('visitor@example.test', password), null);
  provisionDemo({ email: 'visitor@example.test', password });
});

test('demo browsing and forged mutations never change app rows or reveal another tenant', async () => {
  const demoCookie = await login('visitor@example.test');
  const sampleEvent = db.prepare('SELECT id FROM search_events WHERE household_id = ?').get(demoId);
  const sampleVideo = db.prepare("SELECT id FROM videos WHERE source = 'demo' ORDER BY id LIMIT 1").get();
  const before = snapshot();
  for (const url of ['/parent', '/parent/reviews', '/parent/decisions', '/parent/searches', '/parent/profiles', `/parent/searches/${sampleEvent.id}`, '/child/profile']) {
    const page = await get(url, demoCookie);
    assert.equal(page.status, 200, url);
    const html = await page.text();
    assert.match(html, /Read-only demo/);
    assert.doesNotMatch(html, /Private owner|Private child|owner@example.test|other@example.test|\$2[aby]\$/);
  }
  assert.equal((await get('/parent/accounts', demoCookie)).status, 403);
  assert.equal((await get(`/parent/searches/${privateSearchId}`, demoCookie)).status, 404);
  assert.equal((await get(`/parent/reviews/videos/${privateVideoId}/preview`, demoCookie)).status, 404);
  for (const url of ['/model-comparison', '/MODEL-COMPARISON/', '/model-comparison/search']) assert.equal((await get(url, demoCookie)).status, 403);
  for (const [url, body] of [
    ['/parent/accounts', account()], ['/parent/profiles/children', { displayName: 'Tampered' }],
    [`/parent/decisions/videos/${sampleVideo.id}`, { decision: 'block' }],
    ['/parent/reviews/bulk', { action: 'approve_all' }], ['/model-comparison/search', { q: 'spend money' }],
    ['/model-comparison/compare', {}], ['/PARENT/REVIEWS/BULK/', { action: 'approve_all' }]
  ]) assert.equal((await post(url, body, demoCookie)).status, 403, url);
  assert.equal((await post(`/child/profile/${privateChildId}/activate`, {}, demoCookie)).status, 404);
  assert.equal(snapshot(), before);
});

test('demo child handoff remains read-only after parent logout, including alternate route casing', async () => {
  const demoCookie = await login('visitor@example.test');
  const child = db.prepare('SELECT id FROM child_profiles WHERE household_id = ?').get(demoId);
  const activated = await post(`/child/profile/${child.id}/activate`, {}, demoCookie);
  assert.equal(activated.status, 302);
  const childCookie = cookie(activated, 'kidview.child');
  assert.ok(childCookie);
  const before = snapshot();
  assert.equal((await get('/parent', demoCookie)).status, 302);
  const search = await post('/CHILD/SEARCH/', { q: 'any query' }, childCookie);
  assert.equal(search.status, 303);
  assert.equal((await get(`/child/results?searchEventId=${privateSearchId}`, childCookie)).status, 404);
  const results = await get(search.headers.get('location'), childCookie);
  assert.equal(results.status, 200);
  assert.match(await results.text(), /building paper bridges/);
  const video = db.prepare("SELECT id FROM videos WHERE source = 'demo' ORDER BY id LIMIT 1").get();
  const page = await get(`/child/videos/${video.id}`, childCookie);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /video-player.js|<iframe/);
  const realChannel = db.prepare("INSERT INTO channels(source, external_id, title) VALUES ('mock','private-channel','Private channel')").run().lastInsertRowid;
  const realVideo = db.prepare("INSERT INTO videos(channel_id,source,external_id,title) VALUES (?,'mock','private-video','Private video')").run(realChannel).lastInsertRowid;
  assert.equal((await get(`/child/videos/${realVideo}`, childCookie)).status, 404);
  db.prepare('DELETE FROM videos WHERE id = ?').run(realVideo);
  db.prepare('DELETE FROM channels WHERE id = ?').run(realChannel);
  for (const url of [`/child/videos/${video.id}/playback/start`, `/CHILD/videos/${video.id}/playback/progress/`, '/child/search-events/1/not-what-i-meant']) {
    assert.equal((await post(url, {}, childCookie)).status, 403);
  }
  assert.equal(snapshot(), before);
  // A signed cookie from another household cannot override a parent session.
  const ownerSession = owner();
  assert.equal(getActiveChildProfile({ session: { parentUser: ownerSession }, headers: { cookie: childCookie } }), null);
  const foreignCookie = `kidview.child=${createActiveChildToken({ householdId, childProfileId: privateChildId })}`;
  const newDemoCookie = await login('visitor@example.test');
  const protectedSearch = await post('/child/search', { q: 'attack' }, `${newDemoCookie}; ${foreignCookie}`);
  assert.equal(protectedSearch.status, 403);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});


test('malformed legacy child references stay tenant-scoped and decision services reject demo/disabled actors', () => {
  const { getSearchAuditList, getSearchAuditDetail } = require('../app/services/householdService');
  const { upsertVideoDecision } = require('../app/services/decisionService');
  const malformedId = db.prepare(`INSERT INTO search_events(household_id,child_profile_id,query,original_query)
    VALUES (?, ?, 'malformed sample', 'malformed sample')`).run(demoId, privateChildId).lastInsertRowid;
  assert.equal(getSearchAuditDetail(demoId, malformedId).event.child_profile_name, null);
  assert.equal(getSearchAuditList(demoId).searches.find(event => event.id === malformedId).child_profile_name, null);
  db.prepare('DELETE FROM search_events WHERE id = ?').run(malformedId);
  const demoParent = db.prepare('SELECT id FROM parent_users WHERE household_id = ?').get(demoId);
  const disabledParent = db.prepare("SELECT id FROM parent_users WHERE email = 'new@example.test'").get();
  const before = snapshot();
  for (const actor of [{ householdId: demoId, parentUserId: demoParent.id }, { householdId, parentUserId: disabledParent.id }]) {
    assert.throws(() => upsertVideoDecision({ ...actor, videoId: Number(privateVideoId), decision: 'allow' }), /active parent/);
  }
  assert.equal(snapshot(), before);
});
