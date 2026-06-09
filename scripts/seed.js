const bcrypt = require('bcrypt');
const db = require('../app/db/database');
const config = require('../app/config');
const youtubeSampleCandidates = require('../app/services/fixtures/youtubeSampleCandidates');

const existingHousehold = db.prepare('SELECT id FROM households LIMIT 1').get();

if (existingHousehold) {
  console.log('Seed data already exists.');
  process.exit(0);
}

const CATEGORY_RULES = [
  {
    pattern: /nature|blue|otter|cat|rainforest|sea|animal|parkour/i,
    primaryCategory: 'Animals',
    iconKey: 'animals'
  },
  {
    pattern: /pixar|animation|animated|slime|toy|craft|treehouse|bouncing ball/i,
    primaryCategory: 'Art',
    iconKey: 'art'
  },
  {
    pattern: /fraction|math|science|water|physics|history|weapon/i,
    primaryCategory: 'Science',
    iconKey: 'science'
  }
];

const CHANNEL_DECISIONS = {
  UCpVm7bg6pXKo1Pr6k5kx7vA: {
    decision: 'approved',
    reason: 'Seeded as a trusted science-style channel.'
  },
  UC_REVIEW_FIRST_CHANNEL: {
    decision: 'review_first',
    reason: 'Teen drama channel should be reviewed before child display.'
  },
  UC_BLOCKED_CHANNEL_ID: {
    decision: 'blocked',
    reason: 'Dangerous stunt channel is blocked for this household.'
  }
};

const VIDEO_DECISIONS = {
  '3g246c6Bv58': {
    decision: 'allow',
    reason: 'Good science/nature explainer for the demo household.'
  },
  tra66666666: {
    decision: 'allow_limited',
    reason: 'Useful educational video, but keep it in limited child-facing contexts.'
  },
  dQw4w9WgXcQ: {
    decision: 'block',
    reason: 'Music video is outside this child discovery policy.'
  },
  par88888888: {
    decision: 'review_required',
    reason: 'History topic may be educational but includes weapon discussion.'
  }
};

const REVIEW_STATUSES = {
  rev22222222: {
    status: 'review',
    reason: 'Needs parent review because it centers on teen drama and rumors.'
  },
  unk33333333: {
    status: 'unknown',
    reason: 'New creator with too little household context.'
  },
  mdl44444444: {
    status: 'review',
    reason: 'Game content references poison/toxin mechanics.'
  },
  lim77777777: {
    status: 'review',
    reason: 'High-stimulation slime content should be reviewed before approval.'
  },
  not55555555: {
    status: 'unknown',
    reason: 'No-speech ambient audio needs a parent decision.'
  }
};

function classifyCandidate(candidate) {
  const haystack = `${candidate.title} ${candidate.description} ${candidate.channelTitle}`;
  const matchedRule = CATEGORY_RULES.find((rule) => rule.pattern.test(haystack));
  const labels = [];

  if (candidate.isShort) labels.push('short');
  if (candidate.isLivestream) labels.push('livestream');
  if (!candidate.embeddable) labels.push('not-embeddable');
  if (/toy|slime|surprise|mystery|clickbait|won't believe/i.test(haystack)) labels.push('high-stimulation');
  if (/math|fraction|science|nature|history|animation/i.test(haystack)) labels.push('learning');
  if (/dangerous|stunt|weapon|flamethrower|poison|toxin/i.test(haystack)) labels.push('needs-care');

  return {
    primaryCategory: matchedRule ? matchedRule.primaryCategory : 'General',
    iconKey: matchedRule ? matchedRule.iconKey : 'general',
    labels
  };
}

function confidenceFor(candidate) {
  if (VIDEO_DECISIONS[candidate.externalVideoId]) return 0.95;
  if (CHANNEL_DECISIONS[candidate.channelExternalId]) return 0.88;
  if (REVIEW_STATUSES[candidate.externalVideoId]) return 0.72;
  if (candidate.isShort || candidate.isLivestream || !candidate.embeddable) return 0.4;
  return 0.62;
}

function childExplanationFor(candidate, classification) {
  if (classification.primaryCategory === 'Animals') {
    return 'A KidView candidate about nature, animals, or the world around us.';
  }

  if (classification.primaryCategory === 'Science') {
    return 'A KidView candidate that explains an idea in a simple way.';
  }

  if (classification.primaryCategory === 'Art') {
    return 'A KidView candidate about making, building, or animation.';
  }

  return 'A KidView candidate waiting for household review.';
}

const passwordHash = bcrypt.hashSync(config.seedParentPassword, 12);

db.transaction(() => {
  const household = db.prepare('INSERT INTO households (name) VALUES (?)').run('Demo Household');

  const policy = db
    .prepare(
      `INSERT INTO policy_profiles
        (household_id, name, description, max_results, allow_shorts, allow_livestreams)
       VALUES (?, ?, ?, 3, 0, 0)`
    )
    .run(
      household.lastInsertRowid,
      'Default Child Policy',
      'Shows at most three calm, approved discovery results.'
    );

  const parentUser = db
    .prepare(
      `INSERT INTO parent_users (household_id, email, password_hash, display_name)
       VALUES (?, ?, ?, ?)`
    )
    .run(household.lastInsertRowid, config.seedParentEmail, passwordHash, 'Demo Parent');

  db.prepare(
    `INSERT INTO child_profiles (household_id, policy_profile_id, display_name, birth_year)
     VALUES (?, ?, ?, ?)`
  ).run(household.lastInsertRowid, policy.lastInsertRowid, 'Demo Child', 2018);

  const insertChannel = db.prepare(
    `INSERT INTO channels (source, external_id, title)
     VALUES (?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
      title = excluded.title,
      updated_at = CURRENT_TIMESTAMP
     RETURNING id`
  );
  const insertVideo = db.prepare(
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
      published_at,
      view_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`
  );

  const channelIdsByExternalId = new Map();
  const videoIdsByExternalId = new Map();

  for (const candidate of youtubeSampleCandidates) {
    const channelId =
      channelIdsByExternalId.get(candidate.channelExternalId) ||
      insertChannel.get(candidate.source, candidate.channelExternalId, candidate.channelTitle).id;
    const classification = classifyCandidate(candidate);
    const parentExplanation =
      VIDEO_DECISIONS[candidate.externalVideoId]?.reason ||
      REVIEW_STATUSES[candidate.externalVideoId]?.reason ||
      CHANNEL_DECISIONS[candidate.channelExternalId]?.reason ||
      'No household decision has been made yet.';
    const videoId = insertVideo.get(
      channelId,
      candidate.source,
      candidate.externalVideoId,
      candidate.title,
      candidate.description,
      candidate.durationSeconds,
      classification.primaryCategory,
      classification.iconKey,
      JSON.stringify(classification.labels),
      confidenceFor(candidate),
      childExplanationFor(candidate, classification),
      parentExplanation,
      candidate.isShort ? 1 : 0,
      candidate.isLivestream ? 1 : 0,
      candidate.publishedAt || null,
      Number(candidate.viewCount || 0)
    ).id;

    channelIdsByExternalId.set(candidate.channelExternalId, channelId);
    videoIdsByExternalId.set(candidate.externalVideoId, videoId);
  }

  const insertVideoDecision = db.prepare(
    `INSERT INTO household_video_decisions
      (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const [externalVideoId, decision] of Object.entries(VIDEO_DECISIONS)) {
    insertVideoDecision.run(
      household.lastInsertRowid,
      videoIdsByExternalId.get(externalVideoId),
      decision.decision,
      decision.reason,
      parentUser.lastInsertRowid
    );
  }

  const insertChannelDecision = db.prepare(
    `INSERT INTO household_channel_decisions
      (household_id, channel_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const [externalChannelId, decision] of Object.entries(CHANNEL_DECISIONS)) {
    insertChannelDecision.run(
      household.lastInsertRowid,
      channelIdsByExternalId.get(externalChannelId),
      decision.decision,
      decision.reason,
      parentUser.lastInsertRowid
    );
  }

  const insertReview = db.prepare(
    `INSERT INTO moderation_reviews (
      household_id,
      video_id,
      status,
      decision,
      parent_facing_reason,
      parent_explanation,
      confidence_score,
      primary_category
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const [externalVideoId, review] of Object.entries(REVIEW_STATUSES)) {
    const candidate = youtubeSampleCandidates.find((item) => item.externalVideoId === externalVideoId);
    const classification = classifyCandidate(candidate);

    insertReview.run(
      household.lastInsertRowid,
      videoIdsByExternalId.get(externalVideoId),
      review.status,
      review.status,
      review.reason,
      review.reason,
      confidenceFor(candidate),
      classification.primaryCategory
    );
  }
})();

console.log(`Seeded Demo Household with ${youtubeSampleCandidates.length} YouTube sample candidates.`);
console.log(`Parent login: ${config.seedParentEmail}`);
console.log(`Parent password: ${config.seedParentPassword}`);
