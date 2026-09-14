const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const session = require('express-session');

const testDbPath = path.join(os.tmpdir(), `kidview-http-${process.pid}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = testDbPath;
process.env.VIDEO_SOURCE = 'mock';
process.env.APP_ORIGIN = '';
process.env.SESSION_SECRET = 'http-test-session-secret-at-least-32-characters';
process.env.SEED_PARENT_EMAIL = 'parent@example.com';
process.env.SEED_PARENT_PASSWORD = 'password123';

for (const suffix of ['', '-shm', '-wal'])
  fs.rmSync(`${testDbPath}${suffix}`, { force: true });

const originalLog = console.log;
console.log = () => {};
require('../scripts/migrate');
require('../scripts/seed');
console.log = originalLog;

const config = require('../app/config');
const db = require('../app/db/database');
const { createApp } = require('../server');

const noRateLimit = (req, res, next) => next();
let server;
let baseUrl;

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] || '';
}

function sameOriginHeaders(extra = {}) {
  return { origin: baseUrl, ...extra };
}

async function post(pathname, body, { cookie = '', headers = {} } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...sameOriginHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: new URLSearchParams(body),
  });
}

test.before(async () => {
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    generalRateLimiter: noRateLimit,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
  for (const suffix of ['', '-shm', '-wal'])
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

test('serves login with hardened response headers', async () => {
  const response = await fetch(`${baseUrl}/auth/login`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.match(
    response.headers.get('content-security-policy'),
    /form-action 'self'/,
  );
});

test('permits missing source headers in local development', async () => {
  const missingEvidence = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'parent@example.com',
      password: 'password123',
    }),
  });
  assert.equal(missingEvidence.status, 302);

  const opaqueOrigin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: 'null',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      email: 'parent@example.com',
      password: 'password123',
    }),
  });
  assert.equal(opaqueOrigin.status, 302);

  const opaqueCrossSite = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: 'null',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      email: 'parent@example.com',
      password: 'password123',
    }),
  });
  assert.equal(opaqueCrossSite.status, 403);
});

test('rejects explicit cross-origin browser evidence', async () => {

  const crossOrigin = await post(
    '/auth/login',
    { email: 'parent@example.com', password: 'password123' },
    { headers: { origin: 'https://attacker.example' } },
  );
  assert.equal(crossOrigin.status, 403);

  const contradictoryHeaders = await post(
    '/auth/login',
    { email: 'parent@example.com', password: 'password123' },
    {
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'same-origin',
      },
    },
  );
  assert.equal(contradictoryHeaders.status, 403);
});

test('permits same-origin login and protects parent routes with the session cookie', async () => {
  const unauthenticated = await fetch(`${baseUrl}/parent`, {
    redirect: 'manual',
  });
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.get('location'), '/auth/login');

  const login = await post('/auth/login', {
    email: 'parent@example.com',
    password: 'password123',
  });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/parent');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);

  const parent = await fetch(`${baseUrl}/parent`, {
    headers: { cookie: cookieFrom(login) },
    redirect: 'manual',
  });
  assert.equal(parent.status, 200);
});

test('parent authorization cannot activate another household child', async () => {
  const foreignHousehold = db
    .prepare('INSERT INTO households (name) VALUES (?)')
    .run('Other');
  const foreignChild = db
    .prepare(
      'INSERT INTO child_profiles (household_id, display_name) VALUES (?, ?)',
    )
    .run(foreignHousehold.lastInsertRowid, 'Other Child');
  const login = await post('/auth/login', {
    email: 'parent@example.com',
    password: 'password123',
  });

  const response = await post(
    `/child/profile/${foreignChild.lastInsertRowid}/activate`,
    {},
    { cookie: cookieFrom(login) },
  );
  assert.equal(response.status, 404);
});

test('login has a separate, strict rate limit', async () => {
  const response = await post('/auth/login', {
    email: 'parent@example.com',
    password: 'wrong-password',
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get('ratelimit'), /limit=10/);
});

test('production proxy configuration produces secure session cookies', async () => {
  const productionApp = createApp({
    config: {
      ...config,
      isProduction: true,
      appOrigin: 'https://kidview.test',
      trustProxy: ['loopback'],
    },
    sessionStore: new session.MemoryStore(),
    generalRateLimiter: noRateLimit,
  });
  const productionServer = productionApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => productionServer.once('listening', resolve));

  try {
    const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
    const missingEvidence = await fetch(`${productionUrl}/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'parent@example.com',
        password: 'password123',
      }),
    });
    assert.equal(missingEvidence.status, 403);

    const opaqueOrigin = await fetch(`${productionUrl}/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        origin: 'null',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'parent@example.com',
        password: 'password123',
      }),
    });
    assert.equal(opaqueOrigin.status, 403);

    const response = await fetch(`${productionUrl}/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        origin: 'https://kidview.test',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'parent@example.com',
        password: 'password123',
      }),
    });

    assert.equal(response.status, 302);
    assert.match(response.headers.get('set-cookie'), /Secure/i);
  } finally {
    await new Promise((resolve, reject) =>
      productionServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});


test('child handoff and saved result navigation do not repeat a search', async () => {
  const login = await post('/auth/login', { email: 'parent@example.com', password: 'password123' });
  const parentCookie = cookieFrom(login);
  const child = db.prepare('SELECT id FROM child_profiles WHERE household_id = 1 LIMIT 1').get();
  const activate = await post(`/child/profile/${child.id}/activate`, {}, { cookie: parentCookie });
  assert.equal(activate.status, 302);
  const childCookie = activate.headers.getSetCookie().find(value => value.startsWith('kidview.child='))?.split(';')[0];
  assert.ok(childCookie);
  const parent = await fetch(`${baseUrl}/parent`, { headers: { cookie: parentCookie }, redirect: 'manual' });
  assert.equal(parent.status, 302, 'handoff destroys the old parent session');

  const created = await post('/child/search', { q: 'otters' }, { cookie: childCookie });
  assert.equal(created.status, 303);
  const location = created.headers.get('location');
  assert.match(location, /^\/child\/results\?searchEventId=\d+$/);
  const before = db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n;
  for (let repeat = 0; repeat < 2; repeat++) {
    const response = await fetch(`${baseUrl}${location}`, { headers: { cookie: childCookie } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Sea Otter/i);
  }
  const legacy = await fetch(`${baseUrl}/child/results?q=otters`, { headers: { cookie: childCookie }, redirect: 'manual' });
  assert.equal(legacy.status, 302);
  assert.equal(db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n, before);

  const foreignChild = db.prepare("SELECT id, household_id FROM child_profiles WHERE household_id != 1 LIMIT 1").get();
  const { createActiveChildToken } = require('../app/services/childProfileSessionService');
  const foreignCookie = `kidview.child=${createActiveChildToken({ householdId: foreignChild.household_id, childProfileId: foreignChild.id })}`;
  const forbidden = await fetch(`${baseUrl}${location}`, { headers: { cookie: foreignCookie } });
  assert.equal(forbidden.status, 404);
});

test('invalid decision requests return explicit errors without writing a fallback decision', async () => {
  const login = await post('/auth/login', { email: 'parent@example.com', password: 'password123' });
  const cookie = cookieFrom(login);
  const videoId = db.prepare('SELECT id FROM videos LIMIT 1').get().id;
  const invalid = await post(`/parent/decisions/videos/${videoId}`, { decision: 'yes' }, { cookie, headers: { accept: 'application/json' } });
  assert.equal(invalid.status, 400);
  const missing = await post('/parent/decisions/videos/999999', { decision: 'allow' }, { cookie, headers: { accept: 'application/json' } });
  assert.equal(missing.status, 404);
});
