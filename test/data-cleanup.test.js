const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const testDbPath = path.join(os.tmpdir(), `kidview-data-cleanup-${process.pid}.sqlite`);
process.env.DATABASE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

fs.rmSync(testDbPath, { force: true });
require('../scripts/migrate');

const db = require('../app/db/database');
const decisionService = require('../app/services/decisionService');
const householdService = require('../app/services/householdService');

const householdId = db.prepare("INSERT INTO households (name) VALUES ('Cleanup household')").run().lastInsertRowid;
const parentUserId = db.prepare(
  "INSERT INTO parent_users (household_id, email, password_hash, display_name) VALUES (?, 'cleanup@example.com', 'hash', 'Parent')"
).run(householdId).lastInsertRowid;
const channelId = db.prepare(
  "INSERT INTO channels (source, external_id, title) VALUES ('mock', 'cleanup-channel', 'Cleanup channel')"
).run().lastInsertRowid;
const videoId = db.prepare(
  "INSERT INTO videos (channel_id, source, external_id, title) VALUES (?, 'mock', 'cleanup-video', 'Cleanup video')"
).run(channelId).lastInsertRowid;

test.after(() => {
  db.close();
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
});

test('decision writes reject invalid external input instead of normalizing it', () => {
  assert.throws(
    () => decisionService.upsertVideoDecision({
      householdId,
      parentUserId,
      videoId,
      decision: 'yes',
      reason: ''
    }),
    RangeError
  );
  assert.throws(
    () => decisionService.upsertVideoDecision({
      householdId,
      parentUserId,
      videoId: 0,
      decision: 'allow',
      reason: ''
    }),
    /positive integer/
  );
  assert.throws(
    () => decisionService.upsertChannelDecision({
      householdId,
      parentUserId,
      channelId,
      decision: 'approved',
      reason: 'x'.repeat(501)
    }),
    /500 characters or fewer/
  );
});

test('decision writes require the parent to belong to the household and report missing targets', () => {
  const otherHouseholdId = db.prepare("INSERT INTO households (name) VALUES ('Other')").run().lastInsertRowid;

  assert.throws(
    () => decisionService.upsertVideoDecision({
      householdId: otherHouseholdId,
      parentUserId,
      videoId,
      decision: 'allow',
      reason: ''
    }),
    /belong to the selected household/
  );
  assert.equal(decisionService.upsertVideoDecision({
    householdId,
    parentUserId,
    videoId: 999999,
    decision: 'allow',
    reason: ''
  }), null);
});

test('review_required resolves a pending item truthfully without marking it approved', () => {
  db.prepare(
    "INSERT INTO household_review_items (household_id, video_id, status, reason_code) VALUES (?, ?, 'pending', 'review')"
  ).run(householdId, videoId);

  decisionService.upsertVideoDecision({
    householdId,
    parentUserId,
    videoId,
    decision: 'review_required',
    reason: 'Keep requiring review.'
  });

  const item = db.prepare(
    'SELECT status, reason_code FROM household_review_items WHERE household_id = ? AND video_id = ?'
  ).get(householdId, videoId);
  assert.deepEqual(item, {
    status: 'dismissed',
    reason_code: 'parent_decision:review_required'
  });
});

test('channel decision rolls back when channel re-moderation fails', () => {
  const atomicChannelId = db.prepare(
    "INSERT INTO channels (source, external_id, title) VALUES ('mock', 'atomic-channel', 'Atomic channel')"
  ).run().lastInsertRowid;
  db.prepare(
    "INSERT INTO videos (channel_id, source, external_id, title) VALUES (?, 'mock', 'atomic-video', 'Atomic video')"
  ).run(atomicChannelId);
  db.exec(`
    CREATE TRIGGER fail_cleanup_remoderation
    BEFORE INSERT ON moderation_reviews
    BEGIN
      SELECT RAISE(ABORT, 'forced re-moderation failure');
    END;
  `);

  try {
    assert.throws(
      () => decisionService.upsertChannelDecision({
        householdId,
        parentUserId,
        channelId: atomicChannelId,
        decision: 'blocked',
        reason: 'Atomic test.'
      }),
      /forced re-moderation failure/
    );
    assert.equal(db.prepare(
      'SELECT id FROM household_channel_decisions WHERE household_id = ? AND channel_id = ?'
    ).get(householdId, atomicChannelId), undefined);
  } finally {
    db.exec('DROP TRIGGER fail_cleanup_remoderation');
  }
});

test('shown-video request counts aggregate valid legacy JSON in SQL', () => {
  const insert = db.prepare(
    `INSERT INTO search_events
      (household_id, query, original_query, shown_video_ids_json, result_count)
     VALUES (?, ?, ?, ?, ?)`
  );
  insert.run(householdId, 'one', 'one', JSON.stringify([videoId]), 1);
  insert.run(householdId, 'two', 'two', JSON.stringify([String(videoId), videoId]), 2);
  insert.run(householdId, 'broken', 'broken', '{bad json', 0);

  const history = householdService.getDecisionHistory(householdId);
  const video = history.videos.find((row) => row.video_id === videoId);
  assert.equal(video.request_count, 3);
});

test('schema cleanup archives historical clarification values before dropping inactive columns', () => {
  const upgradePath = path.join(os.tmpdir(), `kidview-data-upgrade-${process.pid}.sqlite`);
  fs.rmSync(upgradePath, { force: true });
  const upgradeDb = new Database(upgradePath);
  const migrationsDir = path.join(__dirname, '..', 'app', 'db', 'migrations');
  const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

  try {
    migrations.filter((name) => name < '013_').forEach((name) => {
      upgradeDb.exec(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
    });
    const upgradeHouseholdId = upgradeDb.prepare(
      "INSERT INTO households (name) VALUES ('Legacy household')"
    ).run().lastInsertRowid;
    const legacyId = upgradeDb.prepare(
      `INSERT INTO search_events
        (household_id, query, original_query, clarified_query, query_intent,
         clarification_options_json, selected_clarification)
       VALUES (?, 'q', 'q', 'clarified', 'learn', '["one"]', 'one')`
    ).run(upgradeHouseholdId).lastInsertRowid;

    upgradeDb.exec(fs.readFileSync(path.join(migrationsDir, '013_schema_cleanup.sql'), 'utf8'));

    const columns = upgradeDb.prepare('PRAGMA table_info(search_events)').all().map((row) => row.name);
    assert.equal(columns.includes('clarified_query'), false);
    const audit = JSON.parse(
      upgradeDb.prepare('SELECT audit_summary_json FROM search_events WHERE id = ?').get(legacyId).audit_summary_json
    );
    assert.deepEqual(audit.legacy_clarification, {
      clarified_query: 'clarified',
      query_intent: 'learn',
      clarification_options_json: '["one"]',
      selected_clarification: 'one'
    });
  } finally {
    upgradeDb.close();
    fs.rmSync(upgradePath, { force: true });
  }
});
