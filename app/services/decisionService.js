const db = require('../db/database');

const VIDEO_DECISIONS = new Set(['allow', 'allow_limited', 'review_required', 'block']);
const CHANNEL_DECISIONS = new Set(['approved', 'review_first', 'blocked']);

function normalizeVideoDecision(value) {
  return VIDEO_DECISIONS.has(value) ? value : 'review_required';
}

function normalizeChannelDecision(value) {
  return CHANNEL_DECISIONS.has(value) ? value : 'review_first';
}

function videoDecisionToReviewStatus(decision) {
  if (decision === 'review_required') {
    return 'review';
  }

  return decision;
}

function upsertVideoDecision({ householdId, videoId, parentUserId, decision, reason }) {
  const normalizedDecision = normalizeVideoDecision(decision);
  const parentReason = String(reason || '').trim() || null;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO household_video_decisions
        (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(household_id, video_id) DO UPDATE SET
        decision = excluded.decision,
        parent_facing_reason = excluded.parent_facing_reason,
        decided_by_parent_user_id = excluded.decided_by_parent_user_id,
        updated_at = CURRENT_TIMESTAMP`
    ).run(householdId, videoId, normalizedDecision, parentReason, parentUserId);

    db.prepare(
      `INSERT INTO moderation_reviews
        (household_id, video_id, status, parent_facing_reason, reviewed_by_parent_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(household_id, video_id) DO UPDATE SET
        status = excluded.status,
        parent_facing_reason = excluded.parent_facing_reason,
        reviewed_by_parent_user_id = excluded.reviewed_by_parent_user_id,
        reviewed_at = CURRENT_TIMESTAMP`
    ).run(
      householdId,
      videoId,
      videoDecisionToReviewStatus(normalizedDecision),
      parentReason,
      parentUserId
    );
  })();
}

function upsertChannelDecision({ householdId, channelId, parentUserId, decision, reason }) {
  const normalizedDecision = normalizeChannelDecision(decision);
  const parentReason = String(reason || '').trim() || null;

  db.prepare(
    `INSERT INTO household_channel_decisions
      (household_id, channel_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(household_id, channel_id) DO UPDATE SET
      decision = excluded.decision,
      parent_facing_reason = excluded.parent_facing_reason,
      decided_by_parent_user_id = excluded.decided_by_parent_user_id,
      updated_at = CURRENT_TIMESTAMP`
  ).run(householdId, channelId, normalizedDecision, parentReason, parentUserId);
}

module.exports = {
  upsertVideoDecision,
  upsertChannelDecision
};
