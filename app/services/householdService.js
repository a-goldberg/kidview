const db = require('../db/database');

function parseLabels(labelsJson) {
  try {
    const labels = JSON.parse(labelsJson || '[]');
    return Array.isArray(labels) ? labels : [];
  } catch (error) {
    return [];
  }
}

function getFirstChildProfile() {
  return db
    .prepare(
      `SELECT
        child_profiles.id,
        child_profiles.household_id AS householdId,
        child_profiles.display_name AS displayName,
        policy_profiles.max_results AS maxResults
       FROM child_profiles
       LEFT JOIN policy_profiles ON policy_profiles.id = child_profiles.policy_profile_id
       ORDER BY child_profiles.id
       LIMIT 1`
    )
    .get();
}

function getParentDashboard(householdId) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  const children = db
    .prepare('SELECT * FROM child_profiles WHERE household_id = ? ORDER BY display_name')
    .all(householdId);
  const recentSearches = db
    .prepare(
      `SELECT original_query AS query, result_count, created_at
       FROM search_events
       WHERE household_id = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(householdId);
  const pendingReviewCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM videos
       JOIN channels ON channels.id = videos.channel_id
       LEFT JOIN moderation_reviews
        ON moderation_reviews.video_id = videos.id
        AND moderation_reviews.household_id = ?
       LEFT JOIN household_video_decisions
        ON household_video_decisions.video_id = videos.id
        AND household_video_decisions.household_id = ?
       LEFT JOIN household_channel_decisions
        ON household_channel_decisions.channel_id = videos.channel_id
        AND household_channel_decisions.household_id = ?
       WHERE videos.is_short = 0
        AND videos.is_livestream = 0
        AND household_video_decisions.id IS NULL
        AND (
          moderation_reviews.status IN ('pending', 'review', 'unknown', 'allow_limited', 'block')
          OR (moderation_reviews.id IS NULL AND household_channel_decisions.id IS NULL)
        )`
    )
    .get(householdId, householdId, householdId).count;

  return {
    household,
    children,
    recentSearches,
    pendingReviewCount
  };
}

function getReviewQueue(householdId, filters = {}) {
  return getReviewQueueWithFilters(householdId, filters);
}

function reviewStatusFor(video) {
  if (video.is_short) return 'short';
  if (video.is_livestream) return 'livestream';
  if (video.channel_decision === 'blocked') return 'channel_blocked';
  if (video.channel_decision === 'review_first') return 'channel_review_first';
  if (video.review_status) return video.review_status;
  return 'undecided';
}

function getReviewQueueWithFilters(householdId, filters = {}) {
  const search = String(filters.search || '').trim();
  const status = String(filters.status || 'all');
  const sort = String(filters.sort || 'status');
  const likeSearch = search.toLowerCase();
  const requestCounts = getShownVideoRequestCounts(householdId);

  let videos = db
    .prepare(
      `SELECT
        videos.id,
        videos.title,
        videos.description,
        videos.duration_seconds,
        videos.primary_category,
        videos.icon_key,
        videos.labels_json,
        videos.confidence_score,
        videos.view_count,
        videos.published_at,
        videos.created_at,
        videos.parent_explanation,
        videos.is_short,
        videos.is_livestream,
        channels.id AS channel_id,
        channels.title AS channel_title,
        moderation_reviews.status AS review_status,
        moderation_reviews.parent_facing_reason AS review_reason,
        moderation_reviews.confidence_score AS review_confidence_score,
        moderation_reviews.content_tags_json AS content_tags_json,
        moderation_reviews.risk_tags_json AS risk_tags_json,
        moderation_reviews.quality_tags_json AS quality_tags_json,
        moderation_reviews.model_name AS model_name,
        household_video_decisions.decision AS video_decision,
        household_video_decisions.parent_facing_reason AS video_decision_reason,
        household_channel_decisions.decision AS channel_decision,
        household_channel_decisions.parent_facing_reason AS channel_decision_reason
       FROM videos
       JOIN channels ON channels.id = videos.channel_id
       LEFT JOIN moderation_reviews
        ON moderation_reviews.video_id = videos.id
        AND moderation_reviews.household_id = ?
       LEFT JOIN household_video_decisions
        ON household_video_decisions.video_id = videos.id
        AND household_video_decisions.household_id = ?
       LEFT JOIN household_channel_decisions
        ON household_channel_decisions.channel_id = videos.channel_id
        AND household_channel_decisions.household_id = ?
       WHERE household_video_decisions.id IS NULL
        AND (
          moderation_reviews.id IS NULL
          OR moderation_reviews.status != 'allow'
        )
       ORDER BY
        videos.is_short ASC,
        videos.is_livestream ASC,
        CASE moderation_reviews.status
          WHEN 'pending' THEN 0
          WHEN 'review' THEN 1
          WHEN 'unknown' THEN 2
          WHEN 'allow_limited' THEN 3
          WHEN 'block' THEN 4
          ELSE 3
        END,
        videos.confidence_score DESC,
        videos.id ASC`
    )
    .all(householdId, householdId, householdId)
    .map((video) => ({
      ...video,
      labels: parseLabels(video.labels_json),
      content_tags: parseLabels(video.content_tags_json),
      risk_tags: parseLabels(video.risk_tags_json),
      quality_tags: parseLabels(video.quality_tags_json),
      queue_status: reviewStatusFor(video),
      request_count: requestCounts.get(video.id) || 0
    }));

  if (search) {
    videos = videos.filter((video) => {
      const haystack = [
        video.title,
        video.description,
        video.channel_title,
        video.parent_explanation,
        video.review_reason,
        video.channel_decision,
        video.queue_status,
        ...video.labels,
        ...video.content_tags,
        ...video.risk_tags,
        ...video.quality_tags
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(likeSearch);
    });
  }

  if (status !== 'all') {
    videos = videos.filter((video) => video.queue_status === status);
  }

  videos = sortReviewVideos(videos, sort);

  let channels = db
    .prepare(
      `SELECT
        channels.id,
        channels.title,
        household_channel_decisions.decision,
        household_channel_decisions.parent_facing_reason
       FROM channels
       LEFT JOIN household_channel_decisions
        ON household_channel_decisions.channel_id = channels.id
        AND household_channel_decisions.household_id = ?
       ORDER BY channels.title`
    )
    .all(householdId);

  if (search) {
    channels = channels.filter((channel) => {
      const haystack = [
        channel.title,
        channel.external_id,
        channel.decision,
        channel.parent_facing_reason
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(likeSearch);
    });
  }

  return {
    filters: {
      search,
      status,
      sort
    },
    bulkMessage: String(filters.bulkMessage || ''),
    videos,
    channels
  };
}

function getShownVideoRequestCounts(householdId) {
  const counts = new Map();
  const rows = db
    .prepare(
      `SELECT shown_video_ids_json
       FROM search_events
       WHERE household_id = ?`
    )
    .all(householdId);

  rows.forEach((row) => {
    parseLabels(row.shown_video_ids_json).forEach((videoId) => {
      const id = Number(videoId);
      counts.set(id, (counts.get(id) || 0) + 1);
    });
  });

  return counts;
}

function sortReviewVideos(videos, sort) {
  const sorted = [...videos];
  const statusRank = {
    pending: 0,
    review: 1,
    unknown: 2,
    allow_limited: 3,
    block: 4,
    undecided: 5
  };

  sorted.sort((a, b) => {
    if (sort === 'date_oldest') {
      return String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id - b.id;
    }

    if (sort === 'requests') {
      return b.request_count - a.request_count || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    }

    if (sort === 'confidence_low') {
      const aConfidence = a.review_confidence_score || a.confidence_score || 0;
      const bConfidence = b.review_confidence_score || b.confidence_score || 0;
      return aConfidence - bConfidence || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    }

    if (sort === 'risk') {
      return b.risk_tags.length - a.risk_tags.length || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    }

    if (sort === 'date_newest') {
      return String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id - a.id;
    }

    return (
      (statusRank[a.queue_status] ?? 9) - (statusRank[b.queue_status] ?? 9) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
      a.id - b.id
    );
  });

  return sorted;
}

function getDecisionHistory(householdId, filters = {}) {
  const search = String(filters.search || '').trim();
  const kind = filters.kind === 'channel' ? 'channel' : filters.kind === 'video' ? 'video' : 'all';
  const sort = String(filters.sort || 'updated_newest');
  const likeSearch = `%${search}%`;
  const requestCounts = getShownVideoRequestCounts(householdId);
  const params = {
    householdId,
    search: likeSearch
  };

  const videos =
    kind === 'channel'
      ? []
      : db
          .prepare(
            `SELECT
              household_video_decisions.id,
              household_video_decisions.video_id,
              household_video_decisions.decision,
              household_video_decisions.parent_facing_reason,
              household_video_decisions.updated_at,
              videos.title,
              videos.duration_seconds,
              videos.primary_category,
              videos.labels_json,
              channels.title AS channel_title
            FROM household_video_decisions
            JOIN videos ON videos.id = household_video_decisions.video_id
            LEFT JOIN channels ON channels.id = videos.channel_id
            WHERE household_video_decisions.household_id = @householdId
              AND (
                @search = '%%'
                OR videos.title LIKE @search
                OR videos.description LIKE @search
                OR channels.title LIKE @search
                OR household_video_decisions.decision LIKE @search
                OR household_video_decisions.parent_facing_reason LIKE @search
              )
            ORDER BY household_video_decisions.updated_at DESC, household_video_decisions.id DESC`
          )
          .all(params)
          .map((video) => ({
            ...video,
            labels: parseLabels(video.labels_json),
            request_count: requestCounts.get(video.video_id) || 0
          }));

  const channels =
    kind === 'video'
      ? []
      : db
          .prepare(
            `SELECT
              household_channel_decisions.id,
              household_channel_decisions.channel_id,
              household_channel_decisions.decision,
              household_channel_decisions.parent_facing_reason,
              household_channel_decisions.updated_at,
              channels.title,
              channels.source,
              channels.external_id
            FROM household_channel_decisions
            JOIN channels ON channels.id = household_channel_decisions.channel_id
            WHERE household_channel_decisions.household_id = @householdId
              AND (
                @search = '%%'
                OR channels.title LIKE @search
                OR channels.external_id LIKE @search
                OR household_channel_decisions.decision LIKE @search
                OR household_channel_decisions.parent_facing_reason LIKE @search
              )
            ORDER BY household_channel_decisions.updated_at DESC, household_channel_decisions.id DESC`
          )
          .all(params);

  const sortedVideos = sortDecisionRows(videos, sort);
  const sortedChannels = sortDecisionRows(channels, sort);

  return {
    filters: {
      search,
      kind,
      sort
    },
    videos: sortedVideos,
    channels: sortedChannels
  };
}

function sortDecisionRows(rows, sort) {
  const sorted = [...rows];

  sorted.sort((a, b) => {
    if (sort === 'updated_oldest') {
      return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
    }

    if (sort === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''));
    }

    if (sort === 'requests') {
      return (b.request_count || 0) - (a.request_count || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    }

    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });

  return sorted;
}

module.exports = {
  getFirstChildProfile,
  getParentDashboard,
  getReviewQueue,
  getDecisionHistory
};
