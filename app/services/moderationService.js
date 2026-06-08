const db = require('../db/database');

const ICON_PATHS = {
  animals: '/icons/animals.svg',
  art: '/icons/art.svg',
  general: '/icons/general.svg',
  science: '/icons/science.svg'
};

function getDecisionMaps(householdId, candidates) {
  const videoIds = candidates.map((candidate) => candidate.videoId);
  const channelIds = [...new Set(candidates.map((candidate) => candidate.channelId))];

  const videoDecisions = new Map();
  const channelDecisions = new Map();
  const reviews = new Map();

  if (videoIds.length) {
    const placeholders = videoIds.map(() => '?').join(',');

    db.prepare(
      `SELECT video_id, decision, parent_facing_reason
       FROM household_video_decisions
       WHERE household_id = ? AND video_id IN (${placeholders})`
    )
      .all(householdId, ...videoIds)
      .forEach((row) => {
        videoDecisions.set(row.video_id, row);
      });

    db.prepare(
      `SELECT video_id, status, parent_facing_reason
       FROM moderation_reviews
       WHERE household_id = ? AND video_id IN (${placeholders})`
    )
      .all(householdId, ...videoIds)
      .forEach((row) => {
        reviews.set(row.video_id, row);
      });
  }

  if (channelIds.length) {
    const placeholders = channelIds.map(() => '?').join(',');

    db.prepare(
      `SELECT channel_id, decision, parent_facing_reason
       FROM household_channel_decisions
       WHERE household_id = ? AND channel_id IN (${placeholders})`
    )
      .all(householdId, ...channelIds)
      .forEach((row) => {
        channelDecisions.set(row.channel_id, row);
      });
  }

  return {
    videoDecisions,
    channelDecisions,
    reviews
  };
}

function parseLabels(labelsJson) {
  try {
    const labels = JSON.parse(labelsJson || '[]');
    return Array.isArray(labels) ? labels : [];
  } catch (error) {
    return [];
  }
}

function resolveDecision(candidate, maps) {
  if (candidate.isShort) {
    return {
      decision: 'block',
      parentExplanation: 'Filtered because Shorts are not allowed for child search.'
    };
  }

  if (candidate.isLivestream) {
    return {
      decision: 'block',
      parentExplanation: 'Filtered because livestreams are not allowed for child search.'
    };
  }

  const videoDecision = maps.videoDecisions.get(candidate.videoId);
  if (videoDecision) {
    const decisionMap = {
      allow: 'allow',
      allow_limited: 'allow_limited',
      review_required: 'review',
      block: 'block'
    };

    return {
      decision: decisionMap[videoDecision.decision] || 'unknown',
      parentExplanation: videoDecision.parent_facing_reason || candidate.parentExplanation
    };
  }

  const channelDecision = maps.channelDecisions.get(candidate.channelId);
  if (channelDecision) {
    const decisionMap = {
      approved: 'allow',
      review_first: 'review',
      blocked: 'block'
    };

    return {
      decision: decisionMap[channelDecision.decision] || 'unknown',
      parentExplanation: channelDecision.parent_facing_reason || candidate.parentExplanation
    };
  }

  const review = maps.reviews.get(candidate.videoId);
  if (review && review.status === 'pending') {
    return {
      decision: 'review',
      parentExplanation: review.parent_facing_reason || candidate.parentExplanation
    };
  }

  if (review) {
    return {
      decision: review.status,
      parentExplanation: review.parent_facing_reason || candidate.parentExplanation
    };
  }

  return {
    decision: 'unknown',
    parentExplanation: candidate.parentExplanation
  };
}

function normalizeCandidate(candidate, decisionResult) {
  const iconKey = candidate.iconKey || 'general';

  return {
    videoId: candidate.videoId,
    title: candidate.title,
    channelTitle: candidate.channelTitle,
    durationSeconds: candidate.durationSeconds,
    primaryCategory: candidate.primaryCategory,
    iconKey,
    iconPath: ICON_PATHS[iconKey] || ICON_PATHS.general,
    labels: parseLabels(candidate.labelsJson),
    decision: decisionResult.decision,
    confidenceScore: candidate.confidenceScore,
    childExplanation: candidate.childExplanation,
    parentExplanation: decisionResult.parentExplanation || candidate.parentExplanation || '',
    watchUrl: `/child/videos/${candidate.videoId}`
  };
}

function moderateCandidates({ householdId, candidates, limit = 3 }) {
  if (!householdId || !candidates.length) {
    return [];
  }

  const maps = getDecisionMaps(householdId, candidates);

  return candidates
    .map((candidate) => normalizeCandidate(candidate, resolveDecision(candidate, maps)))
    .filter((result) => result.decision === 'allow' || result.decision === 'allow_limited')
    .slice(0, limit);
}

function getChildSafeVideo({ householdId, videoId }) {
  const candidate = db
    .prepare(
      `SELECT
        videos.id AS videoId,
        videos.title,
        videos.description,
        videos.duration_seconds AS durationSeconds,
        videos.primary_category AS primaryCategory,
        videos.icon_key AS iconKey,
        videos.labels_json AS labelsJson,
        videos.confidence_score AS confidenceScore,
        videos.child_explanation AS childExplanation,
        videos.parent_explanation AS parentExplanation,
        videos.is_short AS isShort,
        videos.is_livestream AS isLivestream,
        channels.id AS channelId,
        channels.title AS channelTitle
       FROM videos
       JOIN channels ON channels.id = videos.channel_id
       WHERE videos.id = ?`
    )
    .get(videoId);

  if (!candidate) {
    return null;
  }

  const [result] = moderateCandidates({
    householdId,
    candidates: [candidate],
    limit: 1
  });

  return result || null;
}

module.exports = {
  moderateCandidates,
  getChildSafeVideo
};
