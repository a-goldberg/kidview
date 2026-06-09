const db = require('../db/database');
const { remoderateChannelVideos } = require('./moderationService');

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

function videoDecisionToReviewItemStatus(decision) {
  return decision === 'block' ? 'blocked' : 'approved';
}

function resolvePendingReviewItem({ householdId, videoId, parentUserId, status, reasonCode }) {
  db.prepare(
    `UPDATE household_review_items
     SET
      status = ?,
      reason_code = ?,
      resolved_at = CURRENT_TIMESTAMP,
      resolved_by_parent_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND video_id = ?
      AND status = 'pending'`
  ).run(status, reasonCode, parentUserId, householdId, videoId);
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
        (household_id, video_id, status, decision, parent_facing_reason, parent_explanation, reviewed_by_parent_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(household_id, video_id) DO UPDATE SET
        status = excluded.status,
        decision = excluded.decision,
        parent_facing_reason = excluded.parent_facing_reason,
        parent_explanation = excluded.parent_explanation,
        reviewed_by_parent_user_id = excluded.reviewed_by_parent_user_id,
        reviewed_at = CURRENT_TIMESTAMP`
    ).run(
      householdId,
      videoId,
      videoDecisionToReviewStatus(normalizedDecision),
      videoDecisionToReviewStatus(normalizedDecision),
      parentReason,
      parentReason,
      parentUserId
    );

    resolvePendingReviewItem({
      householdId,
      videoId,
      parentUserId,
      status: videoDecisionToReviewItemStatus(normalizedDecision),
      reasonCode: `parent_decision:${normalizedDecision}`
    });
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

  return remoderateChannelVideos({ householdId, channelId });
}

function bulkUpsertVideoDecisions({ householdId, parentUserId, videoIds, decision, reason }) {
  const ids = videoIds.map(Number).filter(Boolean);

  db.transaction(() => {
    ids.forEach((videoId) => {
      upsertVideoDecision({
        householdId,
        parentUserId,
        videoId,
        decision,
        reason
      });
    });
  })();

  return ids.length;
}

function clearReviewVideos({ householdId, parentUserId, videoIds }) {
  const ids = videoIds.map(Number).filter(Boolean);

  if (!ids.length) {
    return 0;
  }

  const placeholders = ids.map(() => '?').join(',');

  return db.prepare(
    `UPDATE household_review_items
     SET
      status = 'dismissed',
      reason_code = 'parent_cleared',
      resolved_at = CURRENT_TIMESTAMP,
      resolved_by_parent_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND status = 'pending'
      AND video_id IN (${placeholders})`
  ).run(parentUserId, householdId, ...ids).changes;
}

function clearReviewChannels({ householdId, parentUserId, channelIds }) {
  const ids = channelIds.map(Number).filter(Boolean);

  if (!ids.length) {
    return {
      channelsCleared: 0,
      videosCleared: 0
    };
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE household_review_items
     SET
      status = 'dismissed',
      reason_code = 'parent_cleared_channel',
      resolved_at = CURRENT_TIMESTAMP,
      resolved_by_parent_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND status = 'pending'
      AND video_id IN (
        SELECT videos.id
        FROM videos
        WHERE videos.channel_id IN (${placeholders})
      )`
  ).run(parentUserId, householdId, ...ids);

  return {
    channelsCleared: ids.length,
    videosCleared: result.changes
  };
}

module.exports = {
  bulkUpsertVideoDecisions,
  clearReviewChannels,
  clearReviewVideos,
  upsertVideoDecision,
  upsertChannelDecision
};
