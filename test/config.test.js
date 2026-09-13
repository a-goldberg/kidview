const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function loadConfig(overrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'production-session-secret-at-least-32-characters',
    APP_ORIGIN: 'https://kidview.example.com',
    ...overrides,
  };

  return spawnSync(process.execPath, ['-e', "require('./app/config')"], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
}

test('production configuration rejects the development session secret', () => {
  const result = loadConfig({ SESSION_SECRET: 'dev-only-change-me' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unique SESSION_SECRET/);
});

test('production configuration requires a canonical HTTPS origin', () => {
  const missing = loadConfig({ APP_ORIGIN: '' });
  const insecure = loadConfig({ APP_ORIGIN: 'http://kidview.example.com' });

  assert.notEqual(missing.status, 0);
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /https APP_ORIGIN/);
});

test('proxy trust rejects blanket and hop-count settings', () => {
  for (const trustProxy of ['true', '1']) {
    const result = loadConfig({ TRUST_PROXY: trustProxy });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit proxy address/);
  }
});

test('valid production configuration loads', () => {
  const result = loadConfig({ TRUST_PROXY: 'loopback' });

  assert.equal(result.status, 0, result.stderr);
});
