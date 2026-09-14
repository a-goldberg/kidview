const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const testDbPath = path.join(os.tmpdir(), `kidview-moderation-cleanup-${process.pid}.sqlite`)
process.env.DATABASE_PATH = testDbPath
process.env.SEED_PARENT_EMAIL = "moderation@example.com"
process.env.SEED_PARENT_PASSWORD = "password123"

fs.rmSync(testDbPath, { force: true })
require("../scripts/migrate")
const originalLog = console.log
console.log = () => {}
require("../scripts/seed")
console.log = originalLog

const db = require("../app/db/database")
const { MODERATION_CANDIDATE_SELECT } = require("../app/services/moderationCandidateService")
const { MODERATION_CACHE_VERSION } = require("../app/services/moderationScoringService")
const { moderateCandidatesWithDiagnostics } = require("../app/services/moderationService")

test.after(() => {
  db.close()
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true })
})

function fixture() {
  const householdId = db.prepare("SELECT id FROM households LIMIT 1").pluck().get()
  const channelId = db.prepare(
    `INSERT INTO channels (source, external_id, title)
     VALUES ('mock', 'moderation-cleanup-channel', 'Calm Science Studio')`,
  ).run().lastInsertRowid
  const videoId = db.prepare(
    `INSERT INTO videos (
      channel_id, source, external_id, title, description, duration_seconds,
      primary_category, icon_key, published_at, view_count,
      youtube_category_id, youtube_category_title, made_for_kids
    ) VALUES (?, 'mock', 'moderation-cleanup-video', 'Otter science lesson for kids',
      'Learn calm animal facts.', 300, 'Animals', 'animals',
      '2026-01-01T00:00:00Z', 500000, '15', 'Pets & Animals', 1)`,
  ).run(channelId).lastInsertRowid
  return { householdId, videoId }
}

const ids = fixture()

function candidate() {
  return db.prepare(`${MODERATION_CANDIDATE_SELECT} WHERE videos.id = ?`).get(ids.videoId)
}

function moderate() {
  return moderateCandidatesWithDiagnostics({
    householdId: ids.householdId,
    candidates: [candidate()],
    limit: 1,
  })
}

test("canonical moderation mapping includes every scoring metadata field", () => {
  const mapped = candidate()
  assert.equal(mapped.youtubeCategoryId, "15")
  assert.equal(mapped.youtubeCategoryTitle, "Pets & Animals")
  assert.equal(mapped.madeForKids, 1)
  assert.equal(mapped.channelTitle, "Calm Science Studio")
  assert.equal(mapped.externalId, "moderation-cleanup-video")
})

test("changed risk metadata invalidates an automated moderation review", () => {
  assert.equal(moderate().results[0].decision, "allow")
  const before = db.prepare(
    "SELECT input_fingerprint FROM moderation_reviews WHERE household_id = ? AND video_id = ?",
  ).get(ids.householdId, ids.videoId)

  db.prepare("UPDATE videos SET title = ?, description = ? WHERE id = ?").run(
    "Dangerous weapon challenge",
    "A flamethrower challenge on a rooftop.",
    ids.videoId,
  )
  const rerun = moderate()
  const after = db.prepare(
    "SELECT decision, input_fingerprint FROM moderation_reviews WHERE household_id = ? AND video_id = ?",
  ).get(ids.householdId, ids.videoId)

  assert.equal(rerun.results.length, 0)
  assert.equal(after.decision, "block")
  assert.notEqual(after.input_fingerprint, before.input_fingerprint)
})

test("a stale moderation version cannot reuse an otherwise matching cache row", () => {
  db.prepare("UPDATE videos SET title = ?, description = ? WHERE id = ?").run(
    "Otter science lesson for kids",
    "Learn calm animal facts.",
    ids.videoId,
  )
  moderate()
  db.prepare(
    `UPDATE moderation_reviews
     SET decision = 'block', status = 'block', cache_version = 'obsolete-rules'
     WHERE household_id = ? AND video_id = ?`,
  ).run(ids.householdId, ids.videoId)

  assert.equal(moderate().results[0].decision, "allow")
  const review = db.prepare(
    "SELECT decision, cache_version FROM moderation_reviews WHERE household_id = ? AND video_id = ?",
  ).get(ids.householdId, ids.videoId)
  assert.equal(review.decision, "allow")
  assert.equal(review.cache_version, MODERATION_CACHE_VERSION)
})
