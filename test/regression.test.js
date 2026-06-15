const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDbPath = path.join(os.tmpdir(), `kidview-regression-${process.pid}.sqlite`);

// App modules read configuration at require-time. Set test configuration before
// requiring migrations, seed data, or services so every module uses the temp DB.
process.env.DATABASE_PATH = testDbPath;
process.env.VIDEO_SOURCE = "mock";
process.env.SEED_PARENT_EMAIL = "parent@example.com";
process.env.SEED_PARENT_PASSWORD = "password123";

fs.rmSync(testDbPath, { force: true });
fs.rmSync(`${testDbPath}-shm`, { force: true });
fs.rmSync(`${testDbPath}-wal`, { force: true });

function withMutedConsole(callback) {
  const originalLog = console.log;

  console.log = () => {};

  try {
    return callback();
  } finally {
    console.log = originalLog;
  }
}

async function withMutedConsoleAsync(callback) {
  const originalLog = console.log;

  console.log = () => {};

  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

require("../scripts/migrate");
withMutedConsole(() => {
  require("../scripts/seed");
});

const db = require("../app/db/database");
const config = require("../app/config");
const decisionService = require("../app/services/decisionService");
const searchService = require("../app/services/searchService");
const youtubeSourceService = require("../app/services/youtubeSourceService");

test.after(() => {
  db.close();
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
});

function household() {
  return db.prepare("SELECT * FROM households LIMIT 1").get();
}

function childProfile() {
  return db.prepare("SELECT * FROM child_profiles LIMIT 1").get();
}

function parentUser() {
  return db.prepare("SELECT * FROM parent_users LIMIT 1").get();
}

async function childSearch(query) {
  const child = childProfile();

  return searchService.search({
    query,
    householdId: child.household_id,
    childProfileId: child.id,
  });
}

function latestSearchEvent(query) {
  return db
    .prepare(
      `SELECT *
       FROM search_events
       WHERE query = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(query);
}

function auditCandidate(searchEventId, titleLike) {
  return db
    .prepare(
      `SELECT *
       FROM search_event_candidates
       WHERE search_event_id = ?
        AND title LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(searchEventId, `%${titleLike}%`);
}

function videoByExternalId(externalId) {
  return db.prepare("SELECT * FROM videos WHERE external_id = ?").get(externalId);
}

function channelByExternalId(externalId) {
  return db.prepare("SELECT * FROM channels WHERE external_id = ?").get(externalId);
}

function upsertVideoDecision(externalVideoId, decision, reason = "Regression test decision.") {
  const video = videoByExternalId(externalVideoId);

  assert.ok(video, `Expected seeded video ${externalVideoId}`);

  decisionService.upsertVideoDecision({
    householdId: household().id,
    parentUserId: parentUser().id,
    videoId: video.id,
    decision,
    reason,
  });
}

function setChildAllowLimitedPolicy(policy, threshold = 0.7) {
  db.prepare(
    `UPDATE child_profiles
     SET allow_limited_policy = ?,
      allow_limited_min_confidence = ?
     WHERE id = ?`,
  ).run(policy, threshold, childProfile().id);
}

function insertVideo({
  externalId,
  title,
  description,
  channelExternalId = "UC_REGRESSION_CHANNEL",
  channelTitle = "Regression Learning Lab",
  durationSeconds = 300,
  confidenceScore = 0.95,
  liveStatus = "none",
  isShort = 0,
  viewCount = 500000,
}) {
  // Reuse an existing source-cache channel when possible so household channel
  // decisions apply exactly as they would in normal searches.
  const channel = channelByExternalId(channelExternalId) ||
    db
      .prepare(
        `INSERT INTO channels (source, external_id, title)
         VALUES ('mock', ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET title = excluded.title
         RETURNING id`,
      )
      .get(channelExternalId, channelTitle);

  return db
    .prepare(
      `INSERT INTO videos (
        channel_id,
        source,
        external_id,
        title,
        description,
        duration_seconds,
        primary_category,
        icon_key,
        labels_json,
        confidence_score,
        child_explanation,
        parent_explanation,
        is_short,
        is_livestream,
        live_status,
        published_at,
        view_count
      )
      VALUES (?, 'mock', ?, ?, ?, ?, 'Science', 'science', '["learning"]', ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', ?)
      RETURNING id`,
    )
    .get(
      channel.id,
      externalId,
      title,
      description,
      durationSeconds,
      confidenceScore,
      "A calm learning video for regression testing.",
      "Inserted by the regression test suite.",
      isShort,
      liveStatus === "none" ? 0 : 1,
      liveStatus,
      viewCount,
    );
}

function insertAllowedCapFixtures() {
  for (let index = 1; index <= 5; index += 1) {
    const video = insertVideo({
      externalId: `capmatrix-${index}`,
      title: `Cap Matrix Science Lesson ${index}`,
      description: "Capmatrix science facts tutorial lesson for kids.",
    });

    decisionService.upsertVideoDecision({
      householdId: household().id,
      parentUserId: parentUser().id,
      videoId: video.id,
      decision: "allow",
      reason: "Regression cap fixture.",
    });
  }
}

test("allowed result appears for a seeded safe search", async () => {
  const response = await childSearch("otters");

  assert.ok(
    response.results.some((result) => result.title.includes("Sea Otters")),
    "Expected an allowed otter result to be visible to the child.",
  );
  assert.ok(response.results.length <= 3, "Child results should always be capped at three.");
});

test("more than three allowed results are capped", async () => {
  insertAllowedCapFixtures();

  const response = await childSearch("capmatrix");

  assert.equal(response.results.length, 3);
  assert.deepEqual(
    response.results.map((result) => result.decision),
    ["allow", "allow", "allow"],
  );
});

test("parent video allow overrides moderation for a specific video", async () => {
  upsertVideoDecision("dQw4w9WgXcQ", "allow", "Regression allow override.");

  const response = await childSearch("Rick Astley");

  assert.ok(
    response.results.some((result) => result.title.includes("Never Gonna Give You Up")),
    "Expected parent allow decision to make the video child-visible.",
  );
});

test("parent video block hides an otherwise visible result", async () => {
  upsertVideoDecision("3g246c6Bv58", "block", "Regression block override.");

  const response = await childSearch("blue rare nature");

  assert.equal(
    response.results.some((result) => result.title.includes("Blue So Rare")),
    false,
  );
});

test("approved channel boosts a result without becoming a hard override", async () => {
  const response = await childSearch("otters");
  const result = response.results.find((item) => item.title.includes("Sea Otters"));

  assert.ok(result, "Expected approved-channel otter result.");
  assert.equal(result.decision, "allow");
  assert.ok(
    result.labels.includes("household-approved-channel"),
    "Expected approved channel to appear as a quality signal.",
  );
});

test("blocked channel hard-blocks matching results", async () => {
  await childSearch("parkour");
  const event = latestSearchEvent("parkour");
  const candidate = auditCandidate(event.id, "Parkour");

  assert.equal(candidate.final_decision, "block");
  assert.equal(candidate.shown_to_child, 0);
  assert.equal(candidate.moderation_source, "hard_filter");
  assert.match(candidate.hard_block_reason, /blocked/i);
});

test("review-first channel sends matching videos to parent review", async () => {
  await childSearch("teen drama");
  const event = latestSearchEvent("teen drama");
  const candidate = auditCandidate(event.id, "Teen Drama");

  assert.equal(candidate.final_decision, "review");
  assert.equal(candidate.shown_to_child, 0);
  assert.equal(candidate.moderation_source, "parent_channel_decision");
  assert.equal(candidate.review_queue_reason_code, "review");
});

test("Shorts and live or upcoming streams are blocked", async () => {
  insertVideo({
    externalId: "upcoming-regression-live",
    title: "Upcoming Regression Science Livestream",
    description: "Upcoming live science stream.",
    liveStatus: "upcoming",
    durationSeconds: 0,
  });

  await childSearch("strict schedule");
  let event = latestSearchEvent("strict schedule");
  let candidate = auditCandidate(event.id, "strict schedule");

  assert.equal(candidate.final_decision, "block");
  assert.match(candidate.hard_block_reason, /Shorts/i);

  await childSearch("lofi hip hop radio");
  event = latestSearchEvent("lofi hip hop radio");
  candidate = auditCandidate(event.id, "Lofi Hip Hop Radio");

  assert.equal(candidate.final_decision, "block");
  assert.match(candidate.hard_block_reason, /live/i);

  await childSearch("upcoming regression");
  event = latestSearchEvent("upcoming regression");
  candidate = auditCandidate(event.id, "Upcoming Regression");

  assert.equal(candidate.final_decision, "block");
  assert.match(candidate.hard_block_reason, /upcoming/i);
});

test("completed-live recordings require strong trusted-channel signals before allowing", async () => {
  const weakResponse = await childSearch("ambient drone");

  assert.equal(
    weakResponse.results.some((result) => result.title.includes("Ambient Drone")),
    false,
    "Weak completed-live recording should not be child-visible.",
  );

  const trustedChannel = channelByExternalId("UCpVm7bg6pXKo1Pr6k5kx7vA");
  const strongVideo = insertVideo({
    externalId: "strong-completed-live",
    title: "Strong Completed Live Science Lesson",
    description: "Science lesson facts tutorial for kids from a trusted source.",
    channelExternalId: trustedChannel.external_id,
    channelTitle: trustedChannel.title,
    liveStatus: "completed_live",
    viewCount: 2000000,
  });

  assert.ok(strongVideo.id);

  const strongResponse = await childSearch("strong completed live science");

  assert.ok(
    strongResponse.results.some((result) => result.title.includes("Strong Completed Live")),
    "Strong trusted completed-live recording should be eligible for child results.",
  );
});

test("allow_limited follows child profile policy", async () => {
  setChildAllowLimitedPolicy("block");

  let response = await childSearch("fractions");

  assert.equal(
    response.results.some((result) => result.title.includes("Basic Fractions")),
    false,
    "Default block policy should hide allow_limited videos.",
  );

  setChildAllowLimitedPolicy("limited_frequency", 0.7);
  response = await childSearch("fractions");

  assert.ok(
    response.results.some((result) => result.title.includes("Basic Fractions")),
    "limited_frequency should allow one qualifying allow_limited video when slots are open.",
  );

  setChildAllowLimitedPolicy("block");
});

test("zero-result searches appear in the search audit", async () => {
  const response = await childSearch("clickbait");
  const event = latestSearchEvent("clickbait");

  assert.equal(response.results.length, 0);
  assert.equal(event.shown_to_child_count, 0);
});

test("non-embeddable source candidates are audited but not persisted normally", async () => {
  const originalSource = config.videoSource;
  const originalSearchCandidates = youtubeSourceService.searchCandidates;

  config.videoSource = "youtube";
  youtubeSourceService.searchCandidates = async () => [
    {
      source: "youtube",
      externalVideoId: "nonembed-regression",
      title: "Non Embeddable Regression Candidate",
      description: "A source result that cannot be embedded.",
      channelExternalId: "UC_NON_EMBED_REGRESSION",
      channelTitle: "Non Embed Channel",
      durationSeconds: 300,
      publishedAt: "2026-01-01T00:00:00Z",
      isShort: false,
      isLivestream: false,
      liveStatus: "none",
      embeddable: false,
      viewCount: 100000,
    },
  ];

  try {
    await withMutedConsoleAsync(() => childSearch("nonembed regression"));
  } finally {
    config.videoSource = originalSource;
    youtubeSourceService.searchCandidates = originalSearchCandidates;
  }

  const event = latestSearchEvent("nonembed regression");
  const candidate = auditCandidate(event.id, "Non Embeddable Regression");
  const persistedVideo = videoByExternalId("nonembed-regression");

  assert.equal(event.source_mode, "youtube");
  assert.equal(candidate.video_id, null);
  assert.equal(candidate.final_decision, "block");
  assert.equal(candidate.moderation_source, "source_filter");
  assert.equal(candidate.review_queue_reason_code, "source_filter:not_embeddable");
  assert.equal(persistedVideo, undefined);
});
