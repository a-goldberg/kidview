const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kidview-search-cleanup-'));
process.env.DATABASE_PATH = path.join(directory, 'test.sqlite');
process.env.VIDEO_SOURCE = 'mock';
process.env.NODE_ENV = 'test';
require('../scripts/migrate');
require('../scripts/seed');
const db = require('../app/db/database');
const config = require('../app/config');
const searchService = require('../app/services/searchService');
const youtube = require('../app/services/youtubeSourceService');
const householdId = db.prepare('SELECT id FROM households LIMIT 1').get().id;
const childProfileId = db.prepare('SELECT id FROM child_profiles LIMIT 1').get().id;
const identity = { householdId, childProfileId };
test.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

function rowCounts() {
  return ['search_events', 'search_event_candidates', 'moderation_reviews', 'household_review_items']
    .map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

test('saved results are child scoped, read only, and reflect new parent blocks', async () => {
  const result = await searchService.search({ ...identity, query: 'otters' });
  assert.ok(result.results.length);
  const counts = rowCounts();
  const searchCount = db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n;
  const saved = searchService.getSavedSearch({ ...identity, searchEventId: result.searchEventId });
  assert.deepEqual(saved.results.map(v => v.videoId), result.results.map(v => v.videoId));
  assert.deepEqual(rowCounts(), counts);
  assert.equal(db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n, searchCount);
  assert.equal(searchService.getSavedSearch({ ...identity, childProfileId: childProfileId + 100,
    searchEventId: result.searchEventId }), null);
  const videoId = result.results[0].videoId;
  db.prepare(`INSERT INTO household_video_decisions(household_id,video_id,decision) VALUES(?,?,'block')
    ON CONFLICT(household_id,video_id) DO UPDATE SET decision='block'`).run(householdId, videoId);
  assert.ok(!searchService.getSavedSearch({ ...identity, searchEventId: result.searchEventId })
    .results.some(v => v.videoId === videoId));
  db.prepare('DELETE FROM household_video_decisions WHERE household_id = ? AND video_id = ?').run(householdId, videoId);
});

test('activity writes require matching child and an originally shown video', async () => {
  const result = await searchService.search({ ...identity, query: 'science' });
  assert.ok(result.results.length);
  const data = { ...identity, searchEventId: result.searchEventId, videoId: result.results[0].videoId };
  assert.equal(searchService.recordClickedVideo({ ...data, childProfileId: childProfileId + 100 }), 0);
  assert.equal(searchService.recordClickedVideo({ ...data, videoId: 999999 }), 0);
  assert.equal(searchService.recordClickedVideo(data), 1);
  assert.equal(searchService.markNotWhatIMeant({ ...data, childProfileId: childProfileId + 100 }), 0);
  assert.equal(searchService.markNotWhatIMeant(data), 1);
});

test('audit write failure rolls back household moderation and queue changes', async () => {
  db.prepare(`INSERT INTO channels(source,external_id,title) VALUES('mock','rollback','Archive')`).run();
  const channelId = db.prepare("SELECT id FROM channels WHERE external_id='rollback'").get().id;
  db.prepare(`INSERT INTO videos(channel_id,source,external_id,title,description,duration_seconds)
    VALUES(?,'mock','rollback','rollbackcandidate','Recorded scene',240)`).run(channelId);
  const before = rowCounts();
  db.exec(`CREATE TRIGGER fail_search_audit BEFORE INSERT ON search_event_candidates
    BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END`);
  try {
    await assert.rejects(searchService.search({ ...identity, query: 'rollbackcandidate' }), /simulated audit failure/);
    assert.deepEqual(rowCounts(), before);
  } finally { db.exec('DROP TRIGGER fail_search_audit'); }
});

test('empty hydration and repeated page tokens cannot make unbounded source calls', async () => {
  const original = youtube.searchCandidatePage;
  const originalMode = config.videoSource;
  config.videoSource = 'youtube';
  let calls = 0;
  youtube.searchCandidatePage = async () => ({ candidates: [], nextPageToken: `page-${++calls}` });
  try {
    await searchService.search({ ...identity, query: 'empty pages' });
    assert.equal(calls, Math.ceil(config.youtubeMaxCandidatesPerSearch / config.youtubeMaxSearchResults));
    calls = 0;
    youtube.searchCandidatePage = async () => { calls++; return { candidates: [], nextPageToken: 'repeat' }; };
    await searchService.search({ ...identity, query: 'repeated token' });
    assert.equal(calls, 2);
  } finally { youtube.searchCandidatePage = original; config.videoSource = originalMode; }
});

test('source calls reject malformed JSON and enforce a timeout signal', async () => {
  const originalFetch = global.fetch;
  const originalKey = config.youtubeApiKey;
  config.youtubeApiKey = 'test-only';
  let signal;
  global.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: async () => ({ items: 'not an array' }) };
  };
  try {
    await assert.rejects(youtube.searchCandidatePage('test'), /invalid list/);
    assert.ok(signal instanceof AbortSignal);
    global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid'); } });
    await assert.rejects(youtube.searchCandidatePage('test'), /invalid JSON/);
  } finally { global.fetch = originalFetch; config.youtubeApiKey = originalKey; }
});

test('oversized searches fail before consuming allowance', async () => {
  const before = db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n;
  await assert.rejects(searchService.search({ ...identity, query: 'x'.repeat(201) }), RangeError);
  assert.equal(db.prepare('SELECT SUM(search_count) AS n FROM child_daily_usage').get().n, before);
});


test('malformed legacy result lists do not break viewing or playback attribution', () => {
  const event = db.prepare(`INSERT INTO search_events(household_id,child_profile_id,query,original_query,shown_video_ids_json)
    VALUES(?,?,'legacy','legacy','invalid-json') RETURNING id`).get(householdId,childProfileId);
  assert.deepEqual(searchService.getSavedSearch({ ...identity, searchEventId:event.id }).results, []);
  assert.equal(searchService.recordClickedVideo({ ...identity, searchEventId:event.id, videoId:1 }), 0);
});
