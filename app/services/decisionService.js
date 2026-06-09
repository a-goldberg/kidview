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

  ids.forEach((videoId) => {
    upsertVideoDecision({
      householdId,
      parentUserId,
      videoId,
      decision,
      reason
    });
  });

  return ids.length;
}

function deleteReviewVideos({ householdId, videoIds }) {
  const ids = videoIds.map(Number).filter(Boolean);

  if (!ids.length) {
    return 0;
  }

  const placeholders = ids.map(() => '?').join(',');

  return db.transaction(() => {
    db.prepare(
      `DELETE FROM moderation_reviews
       WHERE household_id = ?
        AND video_id IN (${placeholders})`
    ).run(householdId, ...ids);

    return db.prepare(
      `DELETE FROM videos
       WHERE id IN (${placeholders})
       AND NOT EXISTS (
          SELECT 1
          FROM household_video_decisions
          WHERE household_video_decisions.video_id = videos.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM moderation_reviews
          WHERE moderation_reviews.video_id = videos.id
        )`
    ).run(...ids).changes;
  })();
}

function deleteReviewChannels({ householdId, channelIds }) {
  const ids = channelIds.map(Number).filter(Boolean);

  if (!ids.length) {
    return {
      channelsDeleted: 0,
      videosDeleted: 0
    };
  }

  const placeholders = ids.map(() => '?').join(',');

  return db.transaction(() => {
    const eligibleChannelRows = db
      .prepare(
        `SELECT channels.id
         FROM channels
         WHERE channels.id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1
            FROM household_channel_decisions
            WHERE household_channel_decisions.channel_id = channels.id
          )`
      )
      .all(...ids);
    const eligibleChannelIds = eligibleChannelRows.map((row) => row.id);

    if (!eligibleChannelIds.length) {
      return {
        channelsDeleted: 0,
        videosDeleted: 0
      };
    }

    const eligiblePlaceholders = eligibleChannelIds.map(() => '?').join(',');
    const videoRows = db
      .prepare(
        `SELECT videos.id
         FROM videos
         WHERE videos.channel_id IN (${eligiblePlaceholders})
          AND NOT EXISTS (
            SELECT 1
            FROM household_video_decisions
            WHERE household_video_decisions.video_id = videos.id
          )`
      )
      .all(...eligibleChannelIds);
    const videoIds = videoRows.map((row) => row.id);

    let videosDeleted = 0;

    if (videoIds.length) {
      const videoPlaceholders = videoIds.map(() => '?').join(',');

      db.prepare(
        `DELETE FROM moderation_reviews
         WHERE household_id = ?
          AND video_id IN (${videoPlaceholders})`
      ).run(householdId, ...videoIds);

      videosDeleted = db.prepare(
        `DELETE FROM videos
         WHERE id IN (${videoPlaceholders})
          AND NOT EXISTS (
            SELECT 1
            FROM household_video_decisions
            WHERE household_video_decisions.video_id = videos.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM moderation_reviews
            WHERE moderation_reviews.video_id = videos.id
          )`
      ).run(...videoIds).changes;
    }

    const channelsDeleted = db.prepare(
      `DELETE FROM channels
       WHERE id IN (${eligiblePlaceholders})
        AND NOT EXISTS (
          SELECT 1
          FROM household_channel_decisions
          WHERE household_channel_decisions.channel_id = channels.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM videos
          WHERE videos.channel_id = channels.id
        )`
    ).run(...eligibleChannelIds).changes;

    return {
      channelsDeleted,
      videosDeleted
    };
  })();
}

module.exports = {
  bulkUpsertVideoDecisions,
  deleteReviewChannels,
  deleteReviewVideos,
  upsertVideoDecision,
  upsertChannelDecision
};
