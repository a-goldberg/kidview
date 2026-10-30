const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const session = require('express-session');

const dbPath = path.join(os.tmpdir(), `kidview-demo-comparison-${process.pid}.sqlite`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = 'comparison-test-secret-at-least-32-characters';
process.env.APP_ORIGIN = '';
process.env.VIDEO_SOURCE = 'mock';
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
require('../scripts/migrate');
const db = require('../app/db/database');
const config = require('../app/config');
const { provisionDemo } = require('../app/services/demoHouseholdService');
const { passwordHash } = require('../app/services/parentAccountService');
const { createActiveChildToken } = require('../app/services/childProfileSessionService');
const password = 'only-for-test-visitors';
const demoId = provisionDemo({ email: 'demo@example.test', password });
provisionDemo({ email: 'limited@example.test', password });
const realHousehold = db.prepare("INSERT INTO households(name) VALUES ('Private household')").run().lastInsertRowid;
db.prepare(`INSERT INTO parent_users(household_id,email,password_hash,display_name,role)
  VALUES (?,'owner@example.test',?,'Private owner','admin')`).run(realHousehold, passwordHash(password));

// Exercise real HTTP/session/authorization paths without spending API quota.
// Separate node:test files run in separate processes, so these replacements
// cannot affect the existing provider or household test suites.
const search = require('../model-comparison/search');
const comparison = require('../model-comparison/compare');
const originalSearch = search.searchVideos;
const originalCompare = comparison.compareVideo;
let searchCalls = 0, compareCalls = 0, searchFailure = false, compareFailure = false, modelFailure = false;
const video = { externalVideoId: 'demoVideo01', title: 'Live test science result', description: 'Learn science with a simple experiment.',
  channelTitle: 'Test science channel', category: 'Science', durationSeconds: 420, madeForKids: true,
  viewCount: 100000, publishedAt: '2026-01-01T00:00:00Z', liveStatus: 'none', isShort: false, embeddable: true };
search.searchVideos = async () => {
  searchCalls++;
  if (searchFailure) throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC');
  return [video];
};
comparison.compareVideo = async (_video, _key, models) => {
  compareCalls++;
  if (compareFailure) throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC');
  return models.map(id => ({ id, name: 'Test model', latencyMs: 1, promptTokens: 50, completionTokens: 20, cost: 0.001,
    ...(modelFailure ? { error: 'PRIVATE_PROVIDER_DIAGNOSTIC' } : {
      assessment: { synopsis: 'A real-time test assessment.', ageRange: '8-12', under13: 'suitable', reason: 'A sample science lesson.' }
    }) }));
};
const { createApp } = require('../server');
const servers = [];
let enabled, disabled;
async function start(flag) {
  const app = createApp({ config: { ...config, demoModelComparisonEnabled: flag, trustProxy: ['loopback'] },
    sessionStore: new session.MemoryStore(), generalRateLimiter: (req, res, next) => next() });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(base, route, body = {}, cookie = '', ip = '192.0.2.1', origin = base) {
  return fetch(base + route, { method: 'POST', redirect: 'manual',
    headers: { origin, cookie, 'x-forwarded-for': ip, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
}
async function get(base, route, cookie = '') {
  return fetch(base + route, { redirect: 'manual', headers: { cookie } });
}
async function login(base, email = 'demo@example.test') {
  const response = await post(base, '/auth/login', { email, password });
  assert.equal(response.status, 302);
  return response.headers.getSetCookie().find(value => value.startsWith('kidview.sid='))?.split(';')[0];
}
function snapshot() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}
const selection = { videoId: video.externalVideoId, models: comparison.MODELS[0].id };

test.before(async () => { enabled = await start(true); disabled = await start(false); });
test.after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  search.searchVideos = originalSearch;
  comparison.compareVideo = originalCompare;
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
});

test('demo comparison is opt-in, requires a parent login, and includes working assets/navigation', async () => {
  const cookie = await login(enabled);
  const offCookie = await login(disabled);
  const beforeCalls = searchCalls;
  for (const route of ['/model-comparison', '/model-comparison/style.css', '/model-comparison/selection.js']) {
    assert.equal((await get(enabled, route)).status, 302);
    assert.equal((await get(disabled, route, offCookie)).status, 403);
    assert.equal((await get(enabled, route, cookie)).status, 200);
  }
  for (const route of ['/model-comparison/search', '/model-comparison/compare']) {
    assert.equal((await post(disabled, route, { q: 'science', ...selection }, offCookie)).status, 403);
    assert.equal((await post(enabled, route, { q: 'science', ...selection })).status, 302);
  }
  assert.equal(searchCalls, beforeCalls);
  assert.match(await (await get(enabled, '/parent', cookie)).text(), /Live model comparison/);
  assert.doesNotMatch(await (await get(disabled, '/parent', offCookie)).text(), /Live model comparison/);
  const child = db.prepare('SELECT id FROM child_profiles WHERE household_id = ?').get(demoId);
  const childCookie = `kidview.child=${createActiveChildToken({ householdId: demoId, childProfileId: child.id })}`;
  assert.equal((await get(enabled, '/model-comparison', childCookie)).status, 302);
});

test('enabled demo uses live comparison handlers without writes, cross-session leaks, or household privileges', async () => {
  const first = await login(enabled), second = await login(enabled);
  const before = snapshot();
  const oldSearchCalls = searchCalls, oldCompareCalls = compareCalls;
  const found = await post(enabled, '/MODEL-COMPARISON/SEARCH/', { q: 'science' }, first);
  assert.equal(found.status, 200);
  assert.match(await found.text(), /Live test science result/);
  const other = await post(enabled, '/model-comparison/compare', selection, second);
  assert.match(await other.text(), /Search again/);
  assert.equal(compareCalls, oldCompareCalls);
  const compared = await post(enabled, '/model-comparison/compare', selection, first);
  assert.equal(compared.status, 200);
  assert.match(await compared.text(), /A real-time test assessment/);
  assert.equal(searchCalls, oldSearchCalls + 1);
  assert.equal(compareCalls, oldCompareCalls + 1);
  const invalid = await post(enabled, '/model-comparison/compare', { ...selection, models: 'not-allowlisted' }, first);
  assert.equal(invalid.status, 400);
  assert.equal(compareCalls, oldCompareCalls + 1);
  const csrf = await post(enabled, '/model-comparison/search', { q: 'bad' }, first, '192.0.2.1', 'https://attacker.test');
  assert.equal(csrf.status, 403);
  for (const route of ['/parent/accounts', '/parent/profiles/children', '/parent/reviews/bulk', '/child/videos/1/playback/start']) {
    assert.equal((await post(enabled, route, { action: 'approve_all' }, first)).status, 403);
  }
  assert.equal((await post(enabled, '/model-comparison/unknown', {}, first)).status, 403);
  assert.equal(snapshot(), before);
});

test('demo quota/provider failures give useful messages without revealing diagnostics', async () => {
  const cookie = await login(enabled);
  searchFailure = true;
  const failedSearch = await post(enabled, '/model-comparison/search', { q: 'science' }, cookie);
  const searchHtml = await failedSearch.text();
  assert.match(searchHtml, /YouTube search is unavailable/);
  assert.doesNotMatch(searchHtml, /PRIVATE_PROVIDER_DIAGNOSTIC/);
  searchFailure = false;
  await post(enabled, '/model-comparison/search', { q: 'science' }, cookie);
  modelFailure = true;
  const failedModel = await post(enabled, '/model-comparison/compare', selection, cookie);
  const modelHtml = await failedModel.text();
  assert.match(modelHtml, /This model is unavailable/);
  assert.doesNotMatch(modelHtml, /PRIVATE_PROVIDER_DIAGNOSTIC/);
  modelFailure = false;
  compareFailure = true;
  const failedCompare = await post(enabled, '/model-comparison/compare', selection, cookie);
  const compareHtml = await failedCompare.text();
  assert.match(compareHtml, /Model comparison is unavailable/);
  assert.doesNotMatch(compareHtml, /PRIVATE_PROVIDER_DIAGNOSTIC/);
  compareFailure = false;
});

test('demo account limits are shared across sessions and IPs, separately for search and comparison', async () => {
  const first = await login(enabled, 'limited@example.test'), second = await login(enabled, 'limited@example.test');
  const before = snapshot();
  const oldSearchCalls = searchCalls;
  for (let i = 0; i < 10; i++) {
    assert.equal((await post(enabled, '/model-comparison/search', { q: 'science' }, i % 2 ? first : second, `198.51.100.${i + 1}`)).status, 200);
  }
  assert.equal((await post(enabled, '/model-comparison/search', { q: 'science' }, first, '198.51.100.50')).status, 429);
  assert.equal(searchCalls, oldSearchCalls + 10);
  const oldCompareCalls = compareCalls;
  for (let i = 0; i < 10; i++) {
    assert.equal((await post(enabled, '/model-comparison/compare', selection, i % 2 ? first : second, `203.0.113.${i + 1}`)).status, 200);
  }
  assert.equal((await post(enabled, '/model-comparison/compare', selection, second, '203.0.113.50')).status, 429);
  assert.equal(compareCalls, oldCompareCalls + 10);
  assert.equal(snapshot(), before);
});

test('real parents retain comparison access when the demo switch is off', async () => {
  const cookie = await login(disabled, 'owner@example.test');
  assert.equal((await get(disabled, '/model-comparison', cookie)).status, 200);
  assert.equal((await post(disabled, '/model-comparison/search', { q: 'science' }, cookie, '192.0.2.200')).status, 200);
  const response = await post(disabled, '/model-comparison/compare', selection, cookie, '192.0.2.200');
  assert.match(await response.text(), /A real-time test assessment/);
});
