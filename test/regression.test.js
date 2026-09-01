const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ejs = require("ejs");

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
const childProfileSessionService = require("../app/services/childProfileSessionService");
const categoryClassificationService = require("../app/services/categoryClassificationService");
const policyService = require("../app/services/policyService");
const householdService = require("../app/services/householdService");
const searchService = require("../app/services/searchService");
const usageService = require("../app/services/usageService");
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

function policyProfile() {
  return db.prepare("SELECT * FROM policy_profiles LIMIT 1").get();
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
  const child = childProfile();

  policyService.updateChildPolicy({
    householdId: child.household_id,
    childProfileId: child.id,
    allowLimitedPolicy: policy,
    allowLimitedMinConfidence: threshold,
    dailySearchLimit: child.daily_search_limit,
    dailyVideoWatchLimit: child.daily_video_watch_limit,
  });
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
  youtubeCategoryId = null,
  youtubeCategoryTitle = null,
  madeForKids = 0,
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
        view_count,
        youtube_category_id,
        youtube_category_title,
        made_for_kids
      )
      VALUES (?, 'mock', ?, ?, ?, ?, 'Science', 'science', '["learning"]', ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', ?, ?, ?, ?)
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
      youtubeCategoryId,
      youtubeCategoryTitle,
      madeForKids,
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

function insertStoredModerationReview(videoId, decision, confidenceScore = 0.8) {
  db.prepare(
    `INSERT INTO moderation_reviews (
      household_id,
      video_id,
      status,
      decision,
      confidence_score,
      primary_category,
      parent_explanation
    )
    VALUES (?, ?, ?, ?, ?, 'Science', 'Regression moderation result.')
    ON CONFLICT(household_id, video_id) DO UPDATE SET
      status = excluded.status,
      decision = excluded.decision,
      confidence_score = excluded.confidence_score,
      primary_category = excluded.primary_category,
      parent_explanation = excluded.parent_explanation`,
  ).run(household().id, videoId, decision, decision, confidenceScore);
}

test("policy configuration defaults usage limits to unlimited", () => {
  const child = childProfile();
  let policy = policyService.getChildPolicy({
    householdId: child.household_id,
    childProfileId: child.id,
  });

  assert.equal(policy.maxResults, 3);
  assert.equal(policy.allowLimitedPolicy, "block");
  assert.equal(policy.dailySearchLimit, null);
  assert.equal(policy.dailyVideoWatchLimit, null);

  policy = policyService.updateChildPolicy({
    householdId: child.household_id,
    childProfileId: child.id,
    allowLimitedPolicy: "block",
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: 12,
    dailyVideoWatchLimit: 5,
  });

  assert.equal(policy.dailySearchLimit, 12);
  assert.equal(policy.dailyVideoWatchLimit, 5);

  policyService.updateChildPolicy({
    householdId: child.household_id,
    childProfileId: child.id,
    allowLimitedPolicy: "block",
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: null,
    dailyVideoWatchLimit: null,
  });
});

test("policy configuration writes stay household-scoped", () => {
  const child = childProfile();
  const profile = policyProfile();

  const childResult = policyService.updateChildPolicy({
    householdId: child.household_id + 999,
    childProfileId: child.id,
    allowLimitedPolicy: "allow",
    allowLimitedMinConfidence: 0.5,
    dailySearchLimit: 1,
    dailyVideoWatchLimit: 1,
  });
  const profileResult = policyService.updatePolicyProfile({
    householdId: profile.household_id + 999,
    policyProfileId: profile.id,
    maxResults: 1,
  });

  assert.equal(childResult, null);
  assert.equal(profileResult, null);
  assert.equal(childProfile().allow_limited_policy, "block");
  assert.equal(policyProfile().max_results, 3);
});

test("policy configuration rejects invalid limits and policy values", () => {
  const child = childProfile();
  const profile = policyProfile();

  assert.throws(
    () => policyService.updatePolicyProfile({
      householdId: household().id,
      policyProfileId: profile.id,
      maxResults: 4,
    }),
    /1 to 3/,
  );
  assert.throws(
    () => policyService.updateChildPolicy({
      householdId: child.household_id,
      childProfileId: child.id,
      allowLimitedPolicy: "sometimes",
      allowLimitedMinConfidence: 0.7,
      dailySearchLimit: null,
      dailyVideoWatchLimit: null,
    }),
    /not supported/,
  );
  assert.throws(
    () => policyService.updateChildPolicy({
      householdId: child.household_id,
      childProfileId: child.id,
      allowLimitedPolicy: "block",
      allowLimitedMinConfidence: 0.7,
      dailySearchLimit: 0,
      dailyVideoWatchLimit: null,
    }),
    /positive integer/,
  );
});

test("policy management creates and updates household profiles", () => {
  const createdPolicy = policyService.createPolicyProfile({
    householdId: household().id,
    name: "Focused learning",
    description: "A smaller result set for focused searches.",
    maxResults: 2,
  });
  const createdChild = policyService.createChildProfile({
    householdId: household().id,
    policyProfileId: createdPolicy.id,
    displayName: "Policy Test Child",
    birthYear: 2019,
    allowLimitedPolicy: "review",
    allowLimitedMinConfidence: 0.75,
    dailySearchLimit: 8,
    dailyVideoWatchLimit: null,
  });

  assert.equal(createdPolicy.name, "Focused learning");
  assert.equal(createdChild.policy_profile_id, createdPolicy.id);
  assert.equal(createdChild.daily_video_watch_limit, null);

  const updatedPolicy = policyService.updatePolicyProfile({
    householdId: household().id,
    policyProfileId: createdPolicy.id,
    name: "Focused search",
    description: "One result at a time.",
    maxResults: 1,
  });
  const updatedChild = policyService.updateChildProfile({
    householdId: household().id,
    childProfileId: createdChild.id,
    policyProfileId: createdPolicy.id,
    displayName: "Updated Test Child",
    birthYear: "",
    allowLimitedPolicy: "limited_frequency",
    allowLimitedMinConfidence: 0.8,
    dailySearchLimit: "",
    dailyVideoWatchLimit: 4,
  });
  const management = policyService.getPolicyManagement(household().id);
  const managedPolicy = management.policies.find((policy) => policy.id === createdPolicy.id);
  const managedChild = management.children.find((child) => child.id === createdChild.id);

  assert.equal(updatedPolicy.name, "Focused search");
  assert.equal(updatedPolicy.max_results, 1);
  assert.equal(updatedChild.display_name, "Updated Test Child");
  assert.equal(updatedChild.birth_year, null);
  assert.equal(updatedChild.daily_search_limit, null);
  assert.equal(managedPolicy.child_count, 1);
  assert.equal(managedPolicy.child_names, "Updated Test Child");
  assert.equal(managedChild.contentPosture.label, "Balanced");
});

test("policy management rejects duplicate names and cross-household assignment", () => {
  const profile = policyProfile();
  const otherHousehold = db
    .prepare("INSERT INTO households (name) VALUES ('Other Household') RETURNING id")
    .get();
  const otherPolicy = policyService.createPolicyProfile({
    householdId: otherHousehold.id,
    name: "Other policy",
    description: "Not available to the demo household.",
    maxResults: 3,
  });

  assert.throws(
    () => policyService.createPolicyProfile({
      householdId: household().id,
      name: profile.name.toUpperCase(),
      description: "Duplicate name.",
      maxResults: 3,
    }),
    /unique within a household/,
  );
  assert.throws(
    () => policyService.createChildProfile({
      householdId: household().id,
      policyProfileId: otherPolicy.id,
      displayName: "Wrong Household Child",
      birthYear: null,
      allowLimitedPolicy: "block",
      allowLimitedMinConfidence: 0.7,
      dailySearchLimit: null,
      dailyVideoWatchLimit: null,
    }),
    /from this household/,
  );
});

test("profile deletion stays household-scoped and protects assigned policies", () => {
  const householdId = household().id;
  const removablePolicy = policyService.createPolicyProfile({
    householdId,
    name: "Temporary policy",
    description: null,
    maxResults: 2,
  });
  const assignedChild = policyService.createChildProfile({
    householdId,
    policyProfileId: removablePolicy.id,
    displayName: "Temporary child",
    birthYear: null,
    allowLimitedPolicy: "block",
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: null,
    dailyVideoWatchLimit: null,
  });
  const otherHousehold = db
    .prepare("INSERT INTO households (name) VALUES ('Deletion Other Household') RETURNING id")
    .get();
  const otherPolicy = policyService.createPolicyProfile({
    householdId: otherHousehold.id,
    name: "Other deletion policy",
    description: null,
    maxResults: 3,
  });

  assert.throws(
    () => policyService.deletePolicyProfile({ householdId, policyProfileId: removablePolicy.id }),
    /Reassign Temporary child/,
  );
  assert.equal(
    policyService.deleteChildProfile({ householdId, childProfileId: assignedChild.id }),
    true,
  );
  assert.equal(
    policyService.deletePolicyProfile({ householdId, policyProfileId: removablePolicy.id }),
    true,
  );
  assert.equal(
    policyService.deletePolicyProfile({ householdId, policyProfileId: otherPolicy.id }),
    null,
  );
  assert.equal(
    policyService.deleteChildProfile({ householdId, childProfileId: assignedChild.id }),
    false,
  );

  const singleChildHousehold = db
    .prepare("INSERT INTO households (name) VALUES ('Single Child Household') RETURNING id")
    .get();
  const singleChildPolicy = policyService.createPolicyProfile({
    householdId: singleChildHousehold.id,
    name: "Single child policy",
    description: null,
    maxResults: 3,
  });
  const onlyChild = policyService.createChildProfile({
    householdId: singleChildHousehold.id,
    policyProfileId: singleChildPolicy.id,
    displayName: "Only child",
    birthYear: null,
    allowLimitedPolicy: "block",
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: null,
    dailyVideoWatchLimit: null,
  });

  assert.throws(
    () => policyService.deleteChildProfile({
      householdId: singleChildHousehold.id,
      childProfileId: onlyChild.id,
    }),
    /Create another child profile before deleting the last one/,
  );
});

test("active child profile token is signed, expiring, and household-scoped", () => {
  const child = childProfile();
  const token = childProfileSessionService.createActiveChildToken({
    householdId: child.household_id,
    childProfileId: child.id,
  });
  const activeChild = childProfileSessionService.getActiveChildProfile({
    headers: {
      cookie: `${childProfileSessionService.ACTIVE_CHILD_COOKIE_NAME}=${encodeURIComponent(token)}`,
    },
  });
  const tamperedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const expiredToken = childProfileSessionService.createActiveChildToken({
    householdId: child.household_id,
    childProfileId: child.id,
    issuedAt: Date.now() - childProfileSessionService.ACTIVE_CHILD_MAX_AGE_MS - 1,
  });
  const wrongHouseholdToken = childProfileSessionService.createActiveChildToken({
    householdId: child.household_id + 999,
    childProfileId: child.id,
  });

  assert.equal(activeChild.id, child.id);
  assert.equal(activeChild.householdId, child.household_id);
  assert.equal(
    childProfileSessionService.parseActiveChildToken(tamperedToken),
    null,
  );
  assert.equal(
    childProfileSessionService.parseActiveChildToken(expiredToken),
    null,
  );
  assert.equal(
    childProfileSessionService.getActiveChildProfile({
      headers: {
        cookie: `${childProfileSessionService.ACTIVE_CHILD_COOKIE_NAME}=${wrongHouseholdToken}`,
      },
    }),
    null,
  );
});

test("profile chooser lists only children from the authenticated household", () => {
  const child = childProfile();
  const otherHousehold = db
    .prepare("INSERT INTO households (name) VALUES ('Chooser Other Household') RETURNING id")
    .get();
  const otherPolicy = policyService.createPolicyProfile({
    householdId: otherHousehold.id,
    name: "Chooser other policy",
    description: null,
    maxResults: 2,
  });

  policyService.createChildProfile({
    householdId: otherHousehold.id,
    policyProfileId: otherPolicy.id,
    displayName: "Other Household Child",
    birthYear: null,
    allowLimitedPolicy: "block",
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: null,
    dailyVideoWatchLimit: null,
  });

  const householdChildren = childProfileSessionService.listChildProfilesForHousehold(
    child.household_id,
  );

  assert.ok(householdChildren.some((profile) => profile.id === child.id));
  assert.equal(
    householdChildren.some((profile) => profile.displayName === "Other Household Child"),
    false,
  );
});

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

test("policy profile result cap controls child search", async () => {
  const profile = policyProfile();

  policyService.updatePolicyProfile({
    householdId: household().id,
    policyProfileId: profile.id,
    maxResults: 1,
  });

  try {
    const response = await childSearch("capmatrix");
    assert.equal(response.results.length, 1);
  } finally {
    policyService.updatePolicyProfile({
      householdId: household().id,
      policyProfileId: profile.id,
      maxResults: 3,
    });
  }
});

test("child results copy reflects the assigned policy result cap", async () => {
  const templatePath = path.join(__dirname, "../app/views/child/results.ejs");
  const baseView = {
    title: "KidView Results",
    currentParent: null,
    query: "science",
    searchEventId: null,
    candidatesConsidered: 0,
    suggestions: [],
    results: [],
  };
  const oneResultHtml = await ejs.renderFile(templatePath, {
    ...baseView,
    childProfile: { displayName: "Test Child", maxResults: 1 },
  });
  const twoResultHtml = await ejs.renderFile(templatePath, {
    ...baseView,
    childProfile: { displayName: "Test Child", maxResults: 2 },
  });

  assert.match(oneResultHtml, /KidView shows up to 1 choice at a time\./);
  assert.match(twoResultHtml, /KidView shows up to 2 choices at a time\./);
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

test("specific parent video allow overrides a blocked channel", async () => {
  upsertVideoDecision("bad11111111", "allow", "Specific household video exception.");

  const response = await childSearch("parkour");
  const event = latestSearchEvent("parkour");
  const candidate = auditCandidate(event.id, "Parkour");

  assert.ok(response.results.some((result) => result.title.includes("Parkour")));
  assert.equal(candidate.final_decision, "allow");
  assert.equal(candidate.shown_to_child, 1);
  assert.equal(candidate.moderation_source, "parent_video_decision");
  assert.equal(candidate.parent_decision_source, "video");
  assert.equal(candidate.visibility_reason_code, "shown_parent_video_override");
});

test("specific parent video allow overrides a stored automated block", async () => {
  const video = insertVideo({
    externalId: "automated-block-override",
    title: "Automated Block Override Candidate",
    description: "Regression candidate with a stored automated block.",
  });
  insertStoredModerationReview(video.id, "block", 0.95);

  decisionService.upsertVideoDecision({
    householdId: household().id,
    parentUserId: parentUser().id,
    videoId: video.id,
    decision: "allow",
    reason: "Specific parent exception to an automated block.",
  });

  const response = await childSearch("automated block override");
  const event = latestSearchEvent("automated block override");
  const candidate = auditCandidate(event.id, "Automated Block Override");

  assert.ok(response.results.some((result) => result.videoId === video.id));
  assert.equal(candidate.final_decision, "allow");
  assert.equal(candidate.visibility_reason_code, "shown_parent_video_override");
  assert.equal(candidate.parent_decision_source, "video");
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

test("specific parent video allow cannot override format guardrails", async () => {
  upsertVideoDecision("sH8oR3t5y1u", "allow", "Attempted Short exception.");
  upsertVideoDecision("L1v3S_tr34m", "allow", "Attempted live-stream exception.");
  upsertVideoDecision("upcoming-regression-live", "allow", "Attempted upcoming-stream exception.");

  let response = await childSearch("strict schedule");
  let event = latestSearchEvent("strict schedule");
  let candidate = auditCandidate(event.id, "strict schedule");

  assert.equal(response.results.some((result) => result.title.includes("strict schedule")), false);
  assert.equal(candidate.final_decision, "block");
  assert.equal(candidate.moderation_source, "hard_filter");
  assert.match(candidate.hard_block_reason, /Shorts/i);

  response = await childSearch("lofi hip hop radio");
  event = latestSearchEvent("lofi hip hop radio");
  candidate = auditCandidate(event.id, "Lofi Hip Hop Radio");

  assert.equal(response.results.some((result) => result.title.includes("Lofi Hip Hop")), false);
  assert.equal(candidate.final_decision, "block");
  assert.match(candidate.hard_block_reason, /live/i);

  response = await childSearch("upcoming regression");
  event = latestSearchEvent("upcoming regression");
  candidate = auditCandidate(event.id, "Upcoming Regression");

  assert.equal(response.results.some((result) => result.title.includes("Upcoming Regression")), false);
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

test("allow_limited review routing follows child profile policy", async () => {
  const video = insertVideo({
    externalId: "limited-policy-matrix",
    title: "Limited Policy Matrix Candidate",
    description: "A candidate used to verify limited policy routing.",
  });
  insertStoredModerationReview(video.id, "allow_limited", 0.8);

  setChildAllowLimitedPolicy("block");
  await childSearch("limited policy matrix");
  let event = latestSearchEvent("limited policy matrix");
  let candidate = auditCandidate(event.id, "Limited Policy Matrix");

  assert.equal(candidate.shown_to_child, 0);
  assert.equal(candidate.review_queue_state, "none");
  assert.equal(candidate.review_queue_reason_code, "profile_policy:block");

  setChildAllowLimitedPolicy("review");
  await childSearch("limited policy matrix");
  event = latestSearchEvent("limited policy matrix");
  candidate = auditCandidate(event.id, "Limited Policy Matrix");

  assert.equal(candidate.shown_to_child, 0);
  assert.equal(candidate.review_queue_state, "created_pending");
  assert.equal(candidate.review_queue_reason_code, "allow_limited");

  setChildAllowLimitedPolicy("allow");
  await childSearch("limited policy matrix");
  event = latestSearchEvent("limited policy matrix");
  candidate = auditCandidate(event.id, "Limited Policy Matrix");

  assert.equal(candidate.shown_to_child, 1);
  assert.equal(candidate.review_queue_state, "resolved");
  assert.equal(candidate.review_queue_reason_code, "profile_policy:allow");

  setChildAllowLimitedPolicy("limited_frequency", 0.7);
  const response = await childSearch("limited policy matrix");
  event = latestSearchEvent("limited policy matrix");
  candidate = auditCandidate(event.id, "Limited Policy Matrix");

  assert.equal(response.results.filter((result) => result.decision === "allow_limited").length, 1);
  assert.equal(candidate.review_queue_state, "none");
  assert.equal(candidate.review_queue_reason_code, "profile_policy:limited_frequency");

  setChildAllowLimitedPolicy("block");
});

test("zero-result searches appear in the search audit", async () => {
  const response = await childSearch("clickbait");
  const event = latestSearchEvent("clickbait");

  assert.equal(response.results.length, 0);
  assert.equal(event.shown_to_child_count, 0);
});

test("YouTube quota failures provide a child-safe explanation", () => {
  const error = new youtubeSourceService.YouTubeDataApiError({
    endpoint: "search",
    message:
      "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day' of service 'youtube.googleapis.com'"
  });

  assert.equal(error.code, "youtube_data_api_error");
  assert.equal(
    error.userMessage,
    "YouTube has reached its search limit for today. Please try again tomorrow."
  );
  assert.match(error.message, /Quota exceeded/);
});

test("other YouTube failures do not expose provider details to children", () => {
  const error = new youtubeSourceService.YouTubeDataApiError({
    endpoint: "search",
    message: "API key not valid. Please pass a valid API key."
  });

  assert.equal(
    error.userMessage,
    "KidView cannot search YouTube right now. Please try again in a few minutes."
  );
});

test("non-embeddable source candidates are audited but not persisted normally", async () => {
  const originalSource = config.videoSource;
  const originalSearchCandidatePage = youtubeSourceService.searchCandidatePage;

  config.videoSource = "youtube";
  youtubeSourceService.searchCandidatePage = async () => ({
    candidates: [
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
    ],
    nextPageToken: null,
  });

  try {
    await withMutedConsoleAsync(() => childSearch("nonembed regression"));
  } finally {
    config.videoSource = originalSource;
    youtubeSourceService.searchCandidatePage = originalSearchCandidatePage;
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

test("YouTube category and made-for-kids metadata can lift a neutral result to allow", async () => {
  const originalSource = config.videoSource;
  const originalSearchCandidatePage = youtubeSourceService.searchCandidatePage;

  config.videoSource = "youtube";
  youtubeSourceService.searchCandidatePage = async () => ({
    candidates: [
    {
      source: "youtube",
      externalVideoId: "youtube-category-signal-regression",
      title: "Quiet Pony in a Field",
      description: "A calm look at a pony walking through a field.",
      channelExternalId: "UC_CATEGORY_SIGNAL_REGRESSION",
      channelTitle: "Field Camera",
      youtubeCategoryId: "15",
      youtubeCategoryTitle: "Pets & Animals",
      madeForKids: true,
      durationSeconds: 300,
      publishedAt: "2026-01-01T00:00:00Z",
      isShort: false,
      isLivestream: false,
      liveStatus: "none",
      embeddable: true,
      viewCount: 1000000,
    },
    ],
    nextPageToken: null,
  });

  try {
    const response = await withMutedConsoleAsync(() =>
      childSearch("pony category test"),
    );

    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].decision, "allow");
  } finally {
    config.videoSource = originalSource;
    youtubeSourceService.searchCandidatePage = originalSearchCandidatePage;
  }

  const event = latestSearchEvent("pony category test");
  const candidate = auditCandidate(event.id, "Quiet Pony");
  const persistedVideo = videoByExternalId("youtube-category-signal-regression");

  assert.equal(persistedVideo.youtube_category_id, "15");
  assert.equal(persistedVideo.youtube_category_title, "Pets & Animals");
  assert.equal(persistedVideo.primary_category, "Pets & Animals");
  assert.equal(persistedVideo.icon_key, "animals");
  assert.equal(persistedVideo.made_for_kids, 1);
  assert.match(candidate.quality_tags_json, /youtube-pets-and-animals/);
  assert.match(candidate.quality_tags_json, /youtube-made-for-kids/);
});

test("YouTube category and made-for-kids metadata cannot override severe risk", async () => {
  const originalSource = config.videoSource;
  const originalSearchCandidatePage = youtubeSourceService.searchCandidatePage;

  config.videoSource = "youtube";
  youtubeSourceService.searchCandidatePage = async () => ({
    candidates: [
    {
      source: "youtube",
      externalVideoId: "youtube-category-risk-regression",
      title: "Pony Weapon Demonstration",
      description: "A pony in a field.",
      channelExternalId: "UC_CATEGORY_RISK_REGRESSION",
      channelTitle: "Field Camera",
      youtubeCategoryId: "15",
      youtubeCategoryTitle: "Pets & Animals",
      madeForKids: true,
      durationSeconds: 300,
      publishedAt: "2026-01-01T00:00:00Z",
      isShort: false,
      isLivestream: false,
      liveStatus: "none",
      embeddable: true,
      viewCount: 1000000,
    },
    ],
    nextPageToken: null,
  });

  try {
    const response = await withMutedConsoleAsync(() =>
      childSearch("pony risk category test"),
    );

    assert.equal(response.results.length, 0);
  } finally {
    config.videoSource = originalSource;
    youtubeSourceService.searchCandidatePage = originalSearchCandidatePage;
  }

  const event = latestSearchEvent("pony risk category test");
  const candidate = auditCandidate(event.id, "Pony Weapon");

  assert.equal(candidate.final_decision, "block");
  assert.match(candidate.risk_tags_json, /severe-risk-flag/);
  assert.match(candidate.quality_tags_json, /youtube-pets-and-animals/);
  assert.match(candidate.quality_tags_json, /youtube-made-for-kids/);
});

test("child-facing categories use YouTube metadata instead of title matching", () => {
  const assignedCategory = categoryClassificationService.classifyCandidateCategory({
    title: "Science facts about otters",
    youtubeCategoryTitle: "Pets & Animals",
  });
  const musicCategory = categoryClassificationService.classifyCandidateCategory({
    title: "Science facts about otters",
    youtubeCategoryTitle: "Music",
  });
  const unmappedCategory = categoryClassificationService.classifyCandidateCategory({
    title: "Science facts about otters",
    youtubeCategoryTitle: "People & Blogs",
  });

  assert.deepEqual(assignedCategory, {
    primaryCategory: "Pets & Animals",
    iconKey: "animals",
    source: "youtube_category",
  });
  assert.deepEqual(musicCategory, {
    primaryCategory: "Music",
    iconKey: "music",
    source: "youtube_category",
  });
  assert.deepEqual(unmappedCategory, {
    primaryCategory: "General",
    iconKey: "general",
    source: "general_fallback",
  });
});

test("parent review context identifies child profiles that requested pending content", () => {
  const child = childProfile();
  const pendingVideo = db
    .prepare(
      `SELECT videos.id, videos.channel_id, videos.title
       FROM videos
       JOIN household_review_items
        ON household_review_items.video_id = videos.id
       WHERE household_review_items.household_id = ?
        AND household_review_items.status = 'pending'
       LIMIT 1`
    )
    .get(child.household_id);

  assert.ok(pendingVideo, "Expected a pending review video in the seeded household");

  const event = db
    .prepare(
      `INSERT INTO search_events (household_id, child_profile_id, query, original_query)
       VALUES (?, ?, ?, ?)`
    )
    .run(child.household_id, child.id, "parent context regression", "parent context regression");

  db.prepare(
    `INSERT INTO search_event_candidates (
      search_event_id, household_id, child_profile_id, video_id, channel_id,
      title, channel_title, final_decision, visibility_reason, review_queue_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'review', 'Needs parent review.', 'matched_pending')`
  ).run(
    event.lastInsertRowid,
    child.household_id,
    child.id,
    pendingVideo.id,
    pendingVideo.channel_id,
    pendingVideo.title,
    "Regression channel"
  );

  const queue = householdService.getReviewQueue(child.household_id);
  const dashboard = householdService.getParentDashboard(child.household_id);
  const queueVideo = queue.videos.find((video) => video.id === pendingVideo.id);
  const queueChannel = queue.channels.find((channel) => channel.id === pendingVideo.channel_id);
  const dashboardSearch = dashboard.recentSearches.find(
    (search) => search.query === "parent context regression"
  );

  assert.deepEqual(queueVideo.requesting_child_profile_names, [child.display_name]);
  assert.ok(queueChannel.requesting_child_profile_names.includes(child.display_name));
  assert.equal(dashboardSearch.child_profile_name, child.display_name);
});

function youtubeBackfillCandidate(externalVideoId, overrides = {}) {
  return {
    source: "youtube",
    externalVideoId,
    title: "Quiet Field Camera",
    description: "A calm look at a field.",
    channelExternalId: `UC_${externalVideoId}`,
    channelTitle: "Field Camera",
    durationSeconds: 300,
    publishedAt: "2026-01-01T00:00:00Z",
    isShort: false,
    isLivestream: false,
    liveStatus: "none",
    embeddable: true,
    viewCount: 1000000,
    ...overrides,
  };
}

test("YouTube backfill fetches no more than 40 candidates when result slots remain empty", async () => {
  const originalSource = config.videoSource;
  const originalPageSize = config.youtubeMaxSearchResults;
  const originalCandidateLimit = config.youtubeMaxCandidatesPerSearch;
  const originalSearchCandidatePage = youtubeSourceService.searchCandidatePage;
  const pageTokens = [];

  config.videoSource = "youtube";
  config.youtubeMaxSearchResults = 10;
  config.youtubeMaxCandidatesPerSearch = 40;
  youtubeSourceService.searchCandidatePage = async (_query, { pageToken }) => {
    pageTokens.push(pageToken || "first");
    const pageNumber = pageTokens.length;

    return {
      candidates: Array.from({ length: 10 }, (_, index) =>
        youtubeBackfillCandidate(`backfill-blocked-${pageNumber}-${index}`, {
          title: `Weapon Backfill Candidate ${pageNumber}-${index}`,
        }),
      ),
      nextPageToken: `page-${pageNumber + 1}`,
    };
  };

  try {
    const response = await withMutedConsoleAsync(() =>
      childSearch("bounded backfill test"),
    );

    assert.equal(response.results.length, 0);
  } finally {
    config.videoSource = originalSource;
    config.youtubeMaxSearchResults = originalPageSize;
    config.youtubeMaxCandidatesPerSearch = originalCandidateLimit;
    youtubeSourceService.searchCandidatePage = originalSearchCandidatePage;
  }

  const event = latestSearchEvent("bounded backfill test");
  const summary = JSON.parse(event.audit_summary_json);

  assert.equal(pageTokens.length, 4);
  assert.equal(event.source_candidate_count, 40);
  assert.equal(summary.sourcePagesFetched, 4);
});

test("YouTube backfill stops after the active result cap is filled", async () => {
  const originalSource = config.videoSource;
  const originalPageSize = config.youtubeMaxSearchResults;
  const originalCandidateLimit = config.youtubeMaxCandidatesPerSearch;
  const originalSearchCandidatePage = youtubeSourceService.searchCandidatePage;
  let callCount = 0;

  config.videoSource = "youtube";
  config.youtubeMaxSearchResults = 10;
  config.youtubeMaxCandidatesPerSearch = 40;
  youtubeSourceService.searchCandidatePage = async () => {
    callCount += 1;

    return {
      candidates: [
        youtubeBackfillCandidate("backfill-allow-1", {
          youtubeCategoryId: "15",
          youtubeCategoryTitle: "Pets & Animals",
          madeForKids: true,
        }),
        youtubeBackfillCandidate("backfill-allow-2", {
          youtubeCategoryId: "15",
          youtubeCategoryTitle: "Pets & Animals",
          madeForKids: true,
        }),
        youtubeBackfillCandidate("backfill-allow-3", {
          youtubeCategoryId: "15",
          youtubeCategoryTitle: "Pets & Animals",
          madeForKids: true,
        }),
      ],
      nextPageToken: "should-not-be-requested",
    };
  };

  try {
    const response = await withMutedConsoleAsync(() =>
      childSearch("backfill stops at cap"),
    );

    assert.equal(response.results.length, 3);
  } finally {
    config.videoSource = originalSource;
    config.youtubeMaxSearchResults = originalPageSize;
    config.youtubeMaxCandidatesPerSearch = originalCandidateLimit;
    youtubeSourceService.searchCandidatePage = originalSearchCandidatePage;
  }

  const event = latestSearchEvent("backfill stops at cap");
  const summary = JSON.parse(event.audit_summary_json);

  assert.equal(callCount, 1);
  assert.equal(event.source_candidate_count, 3);
  assert.equal(summary.sourcePagesFetched, 1);
});

test("daily search limits stop retrieval before a second search is admitted", async () => {
  const parent = parentUser();
  const child = policyService.createChildProfile({
    householdId: parent.household_id,
    policyProfileId: policyProfile().id,
    displayName: 'Search limit regression child',
    birthYear: 2019,
    allowLimitedPolicy: 'block',
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: 1,
    dailyVideoWatchLimit: null
  });

  const first = await searchService.search({
    query: 'science',
    householdId: parent.household_id,
    childProfileId: child.id
  });
  const second = await searchService.search({
    query: 'animals',
    householdId: parent.household_id,
    childProfileId: child.id
  });

  assert.equal(first.limitReached, undefined);
  assert.equal(second.limitReached, true);
  assert.equal(second.usage.searches.limit, 1);
  assert.equal(second.usage.searches.used, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM search_events WHERE child_profile_id = ?').get(child.id).count, 1);
});

test("daily video limits count distinct started videos and bound progress server-side", () => {
  const parent = parentUser();
  const child = policyService.createChildProfile({
    householdId: parent.household_id,
    policyProfileId: policyProfile().id,
    displayName: 'Watch limit regression child',
    birthYear: 2018,
    allowLimitedPolicy: 'block',
    allowLimitedMinConfidence: 0.7,
    dailySearchLimit: null,
    dailyVideoWatchLimit: 1
  });
  const policy = policyService.getChildPolicy({
    householdId: parent.household_id,
    childProfileId: child.id
  });
  const firstVideo = videoByExternalId('3g246c6Bv58');
  const secondVideo = videoByExternalId('tra66666666');

  const first = usageService.startPlayback({
    householdId: parent.household_id,
    childProfileId: child.id,
    videoId: firstVideo.id,
    policy,
    durationSeconds: 100
  });
  const resumed = usageService.startPlayback({
    householdId: parent.household_id,
    childProfileId: child.id,
    videoId: firstVideo.id,
    policy,
    durationSeconds: 100
  });
  const blocked = usageService.startPlayback({
    householdId: parent.household_id,
    childProfileId: child.id,
    videoId: secondVideo.id,
    policy,
    durationSeconds: 100
  });
  const progress = usageService.recordPlaybackProgress({
    householdId: parent.household_id,
    childProfileId: child.id,
    videoId: firstVideo.id,
    playbackId: first.playback.id,
    currentTimeSeconds: 99999,
    durationSeconds: 100
  });

  assert.equal(first.allowed, true);
  assert.equal(first.resumed, false);
  assert.equal(resumed.allowed, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.usage.watches.used, 1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.usage.watches.remaining, 0);
  assert.equal(progress.playback.max_progress_seconds, 100);
  assert.ok(progress.playback.completed_at);
  assert.equal(usageService.recordPlaybackProgress({
    householdId: parent.household_id,
    childProfileId: child.id,
    videoId: firstVideo.id,
    playbackId: first.playback.id,
    currentTimeSeconds: -1,
    durationSeconds: 100
  }).error, 'invalid_progress');
});
