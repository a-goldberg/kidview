const db = require('../db/database');
const { remoderateChannelVideos } = require('./moderationService');

const VIDEO_DECISIONS = new Set(['allow', 'allow_limited', 'review_required', 'block']);
const CHANNEL_DECISIONS = new Set(['approved', 'review_first', 'blocked']);
const MAX_REASON_LENGTH = 500;

function requirePositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function requireDecision(value, supported, fieldName) {
  if (!supported.has(value)) {
    throw new RangeError(`${fieldName} is not supported.`);
  }

  return value;
}

function normalizeReason(reason) {
  const normalized = String(reason || '').trim();

  if (normalized.length > MAX_REASON_LENGTH) {
    throw new RangeError(`reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }

  return normalized || null;
}

function validateParentHousehold(householdId, parentUserId) {
  requirePositiveInteger(householdId, 'householdId');
  requirePositiveInteger(parentUserId, 'parentUserId');

  const parent = db.prepare(
    'SELECT id FROM parent_users WHERE id = ? AND household_id = ?'
  ).get(parentUserId, householdId);

  if (!parent) {
    throw new RangeError('Parent user must belong to the selected household.');
  }
}

function videoDecisionToReviewItemStatus(decision) {
  if (decision === 'block') {
    return 'blocked';
  }

  return decision === 'review_required' ? 'dismissed' : 'approved';
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
  validateParentHousehold(householdId, parentUserId);
  requirePositiveInteger(videoId, 'videoId');
  const normalizedDecision = requireDecision(decision, VIDEO_DECISIONS, 'video decision');
  const parentReason = normalizeReason(reason);

  if (!db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId)) {
    return null;
  }

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

    // Keep the automated moderation result intact so audit and decision-history
    // views can explain what the durable parent decision overrode.
    db.prepare(
      `UPDATE moderation_reviews
       SET
        reviewed_by_parent_user_id = ?,
        reviewed_at = CURRENT_TIMESTAMP
       WHERE household_id = ? AND video_id = ?`
    ).run(parentUserId, householdId, videoId);

    resolvePendingReviewItem({
      householdId,
      videoId,
      parentUserId,
      status: videoDecisionToReviewItemStatus(normalizedDecision),
      reasonCode: `parent_decision:${normalizedDecision}`
    });
  })();

  return db.prepare(
    'SELECT * FROM household_video_decisions WHERE household_id = ? AND video_id = ?'
  ).get(householdId, videoId);
}

function upsertChannelDecision({ householdId, channelId, parentUserId, decision, reason }) {
  validateParentHousehold(householdId, parentUserId);
  requirePositiveInteger(channelId, 'channelId');
  const normalizedDecision = requireDecision(decision, CHANNEL_DECISIONS, 'channel decision');
  const parentReason = normalizeReason(reason);

  if (!db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)) {
    return null;
  }

  return db.transaction(() => {
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
  })();
}

function bulkUpsertVideoDecisions({ householdId, parentUserId, videoIds, decision, reason }) {
  validateParentHousehold(householdId, parentUserId);
  requireDecision(decision, VIDEO_DECISIONS, 'video decision');
  normalizeReason(reason);
  if (!Array.isArray(videoIds)) {
    throw new RangeError('videoIds must be an array.');
  }
  const ids = [...new Set(videoIds.map((id) => requirePositiveInteger(id, 'videoId')))];

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
  validateParentHousehold(householdId, parentUserId);
  if (!Array.isArray(videoIds)) {
    throw new RangeError('videoIds must be an array.');
  }
  const ids = [...new Set(videoIds.map((id) => requirePositiveInteger(id, 'videoId')))];

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

function ignoreReviewVideo({ householdId, parentUserId, videoId }) {
  validateParentHousehold(householdId, parentUserId);
  const id = requirePositiveInteger(videoId, 'videoId');

  // Ignore is queue-only: it removes the current pending item without creating
  // a durable allow/block/review decision for future searches.
  return db.prepare(
    `UPDATE household_review_items
     SET
      status = 'dismissed',
      reason_code = 'parent_ignored',
      resolved_at = CURRENT_TIMESTAMP,
      resolved_by_parent_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND status = 'pending'
      AND video_id = ?`
  ).run(parentUserId, householdId, id).changes;
}

function clearReviewChannels({ householdId, parentUserId, channelIds }) {
  validateParentHousehold(householdId, parentUserId);
  if (!Array.isArray(channelIds)) {
    throw new RangeError('channelIds must be an array.');
  }
  const ids = [...new Set(channelIds.map((id) => requirePositiveInteger(id, 'channelId')))];

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
  ignoreReviewVideo,
  upsertVideoDecision,
  upsertChannelDecision
};
