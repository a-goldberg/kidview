const bcrypt = require('bcrypt');
const db = require('../app/db/database');
const config = require('../app/config');
const { classifyCandidateCategory } = require('../app/services/categoryClassificationService');
const youtubeSampleCandidates = require('../app/services/fixtures/youtubeSampleCandidates');

const existingHousehold = db.prepare('SELECT id FROM households LIMIT 1').get();

if (existingHousehold) {
  console.log('Seed data already exists.');
  process.exit(0);
}

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
  const text = `${candidate.title} ${candidate.description} ${candidate.channelTitle}`;
  const labels = [];
  const liveStatus = candidate.liveStatus || (candidate.isLivestream ? 'completed_live' : 'none');

  if (candidate.isShort) labels.push('short');
  if (liveStatus === 'live') labels.push('live');
  if (liveStatus === 'upcoming') labels.push('upcoming-live');
  if (liveStatus === 'completed_live') labels.push('completed-live');
  if (!candidate.embeddable) labels.push('not-embeddable');
  if (/toy|slime|surprise|mystery|clickbait|won't believe/i.test(text)) labels.push('high-stimulation');
  if (/math|fraction|science|nature|history|animation/i.test(text)) labels.push('learning');
  if (/dangerous|stunt|weapon|flamethrower|poison|toxin/i.test(text)) labels.push('needs-care');

  return {
    ...classifyCandidateCategory(candidate),
    labels
  };
}

function confidenceFor(candidate) {
  const liveStatus = candidate.liveStatus || (candidate.isLivestream ? 'completed_live' : 'none');

  if (VIDEO_DECISIONS[candidate.externalVideoId]) return 0.95;
  if (CHANNEL_DECISIONS[candidate.channelExternalId]) return 0.88;
  if (REVIEW_STATUSES[candidate.externalVideoId]) return 0.72;
  if (candidate.isShort || liveStatus === 'live' || liveStatus === 'upcoming' || !candidate.embeddable) return 0.4;
  if (liveStatus === 'completed_live') return 0.5;
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
      live_status,
      published_at,
      view_count,
      youtube_category_id,
      youtube_category_title,
      made_for_kids
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`
  );

  const channelIdsByExternalId = new Map();
  const videoIdsByExternalId = new Map();

  for (const candidate of youtubeSampleCandidates) {
    const channelId =
      channelIdsByExternalId.get(candidate.channelExternalId) ||
      insertChannel.get(candidate.source, candidate.channelExternalId, candidate.channelTitle).id;
    const classification = classifyCandidate(candidate);
    const liveStatus = candidate.liveStatus || (candidate.isLivestream ? 'completed_live' : 'none');
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
      liveStatus === 'none' ? 0 : 1,
      liveStatus,
      candidate.publishedAt || null,
      Number(candidate.viewCount || 0),
      candidate.youtubeCategoryId || null,
      candidate.youtubeCategoryTitle || null,
      candidate.madeForKids ? 1 : 0
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
    const videoId = videoIdsByExternalId.get(externalVideoId);

    if (!videoId) {
      continue;
    }

    insertVideoDecision.run(
      household.lastInsertRowid,
      videoId,
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
    const channelId = channelIdsByExternalId.get(externalChannelId);

    if (!channelId) {
      continue;
    }

    insertChannelDecision.run(
      household.lastInsertRowid,
      channelId,
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
  const insertReviewItem = db.prepare(
    `INSERT INTO household_review_items
      (household_id, child_profile_id, video_id, status, reason_code)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(household_id, video_id) WHERE status = 'pending' DO NOTHING`
  );

  for (const [externalVideoId, review] of Object.entries(REVIEW_STATUSES)) {
    const candidate = youtubeSampleCandidates.find((item) => item.externalVideoId === externalVideoId);

    if (!candidate || !videoIdsByExternalId.get(externalVideoId)) {
      continue;
    }

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
    insertReviewItem.run(
      household.lastInsertRowid,
      null,
      videoIdsByExternalId.get(externalVideoId),
      review.status
    );
  }
})();

console.log(`Seeded Demo Household with ${youtubeSampleCandidates.length} YouTube sample candidates.`);
console.log(`Parent login: ${config.seedParentEmail}`);
console.log(`Parent password: ${config.seedParentPassword}`);
