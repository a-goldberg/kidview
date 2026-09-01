const db = require('../db/database');

function parseLabels(labelsJson) {
  try {
    const labels = JSON.parse(labelsJson || '[]');
    return Array.isArray(labels) ? labels : [];
  } catch (error) {
    return [];
  }
}

function getParentDashboard(householdId) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  const children = db
    .prepare(
      `SELECT
        child_profiles.*,
        policy_profiles.name AS policy_profile_name
       FROM child_profiles
       LEFT JOIN policy_profiles
        ON policy_profiles.id = child_profiles.policy_profile_id
        AND policy_profiles.household_id = child_profiles.household_id
       WHERE child_profiles.household_id = ?
       ORDER BY child_profiles.display_name, child_profiles.id`
    )
    .all(householdId);
  const recentSearches = db
    .prepare(
      `SELECT
        search_events.original_query AS query,
        search_events.result_count,
        search_events.created_at,
        child_profiles.display_name AS child_profile_name
       FROM search_events
       LEFT JOIN child_profiles
        ON child_profiles.id = search_events.child_profile_id
        AND child_profiles.household_id = search_events.household_id
       WHERE search_events.household_id = ?
       ORDER BY search_events.created_at DESC, search_events.id DESC
       LIMIT 5`
    )
    .all(householdId);
  const pendingReviewCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM household_review_items
       JOIN videos ON videos.id = household_review_items.video_id
       LEFT JOIN moderation_reviews
        ON moderation_reviews.household_id = household_review_items.household_id
        AND moderation_reviews.video_id = household_review_items.video_id
       LEFT JOIN household_video_decisions
        ON household_video_decisions.household_id = household_review_items.household_id
        AND household_video_decisions.video_id = household_review_items.video_id
       LEFT JOIN household_channel_decisions
        ON household_channel_decisions.household_id = household_review_items.household_id
        AND household_channel_decisions.channel_id = videos.channel_id
       WHERE household_review_items.household_id = ?
        AND household_review_items.status = 'pending'
        AND household_video_decisions.id IS NULL
        AND (household_channel_decisions.decision IS NULL OR household_channel_decisions.decision != 'blocked')
        AND videos.is_short = 0
        AND videos.live_status NOT IN ('live', 'upcoming')
        AND COALESCE(moderation_reviews.decision, moderation_reviews.status, household_review_items.reason_code) IN ('allow_limited', 'review', 'unknown')`
    )
    .get(householdId).count;

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
  if (['allow_limited', 'review', 'unknown'].includes(video.review_status)) {
    return video.review_status;
  }

  return video.review_item_reason_code || 'review';
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
        videos.external_id,
        videos.title,
        videos.description,
        videos.duration_seconds,
        videos.primary_category,
        videos.icon_key,
        videos.labels_json,
        videos.confidence_score,
        videos.view_count,
        videos.published_at,
        videos.created_at AS video_created_at,
        household_review_items.created_at,
        videos.parent_explanation,
        videos.is_short,
        videos.is_livestream,
        videos.live_status,
        household_review_items.id AS review_item_id,
        household_review_items.reason_code AS review_item_reason_code,
        channels.id AS channel_id,
        channels.title AS channel_title,
        moderation_reviews.status AS review_status,
        moderation_reviews.parent_facing_reason AS review_reason,
        moderation_reviews.parent_explanation AS moderation_explanation,
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
       JOIN household_review_items
        ON household_review_items.video_id = videos.id
        AND household_review_items.household_id = ?
        AND household_review_items.status = 'pending'
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
        AND (household_channel_decisions.decision IS NULL OR household_channel_decisions.decision != 'blocked')
        AND videos.is_short = 0
        AND videos.live_status NOT IN ('live', 'upcoming')
        AND COALESCE(moderation_reviews.decision, moderation_reviews.status, household_review_items.reason_code) IN ('allow_limited', 'review', 'unknown')
       ORDER BY
        videos.is_short ASC,
        CASE videos.live_status
          WHEN 'none' THEN 0
          WHEN 'completed_live' THEN 1
          ELSE 2
        END ASC,
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
    .all(householdId, householdId, householdId, householdId);

  const requestingProfilesByVideoId = getReviewRequestingProfiles(householdId, videos);
  const requestingProfilesByChannelId = new Map();

  videos = videos
    .map((video) => ({
      ...video,
      labels: parseLabels(video.labels_json),
      content_tags: parseLabels(video.content_tags_json),
      risk_tags: parseLabels(video.risk_tags_json),
      quality_tags: parseLabels(video.quality_tags_json),
      queue_status: reviewStatusFor(video),
      request_count: requestCounts.get(video.id) || 0,
      requesting_child_profile_names: requestingProfilesByVideoId.get(video.id) || []
    }))
    .map((video) => {
      const names = requestingProfilesByChannelId.get(video.channel_id) || new Set();
      video.requesting_child_profile_names.forEach((name) => names.add(name));
      requestingProfilesByChannelId.set(video.channel_id, names);
      return video;
    });

  if (search) {
    videos = videos.filter((video) => {
      const haystack = [
        video.title,
        video.description,
        video.channel_title,
        video.parent_explanation,
        video.review_reason,
        video.moderation_explanation,
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
        channels.external_id,
        COUNT(household_review_items.id) AS pending_video_count,
        household_channel_decisions.decision,
        household_channel_decisions.parent_facing_reason
       FROM channels
       JOIN videos ON videos.channel_id = channels.id
       JOIN household_review_items
        ON household_review_items.video_id = videos.id
        AND household_review_items.household_id = ?
        AND household_review_items.status = 'pending'
       LEFT JOIN household_channel_decisions
        ON household_channel_decisions.channel_id = channels.id
        AND household_channel_decisions.household_id = ?
       LEFT JOIN household_video_decisions
        ON household_video_decisions.video_id = videos.id
        AND household_video_decisions.household_id = ?
       LEFT JOIN moderation_reviews
        ON moderation_reviews.video_id = videos.id
        AND moderation_reviews.household_id = ?
       WHERE household_video_decisions.id IS NULL
        AND (household_channel_decisions.decision IS NULL OR household_channel_decisions.decision != 'blocked')
        AND videos.is_short = 0
        AND videos.live_status NOT IN ('live', 'upcoming')
        AND COALESCE(moderation_reviews.decision, moderation_reviews.status, household_review_items.reason_code) IN ('allow_limited', 'review', 'unknown')
       GROUP BY channels.id
       ORDER BY channels.title`
    )
    .all(householdId, householdId, householdId, householdId)
    .map((channel) => ({
      ...channel,
      requesting_child_profile_names: [
        ...(requestingProfilesByChannelId.get(channel.id) || new Set())
      ].sort((a, b) => a.localeCompare(b))
    }));

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

function getReviewRequestingProfiles(householdId, videos) {
  if (!videos.length) {
    return new Map();
  }

  const videoIds = videos.map((video) => video.id);
  const placeholders = videoIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT DISTINCT
        search_event_candidates.video_id,
        child_profiles.display_name AS child_profile_name
       FROM search_event_candidates
       JOIN child_profiles
        ON child_profiles.id = search_event_candidates.child_profile_id
        AND child_profiles.household_id = search_event_candidates.household_id
       WHERE search_event_candidates.household_id = ?
        AND search_event_candidates.video_id IN (${placeholders})
        AND search_event_candidates.review_queue_state IN ('created_pending', 'matched_pending')
       UNION
       SELECT DISTINCT
        household_review_items.video_id,
        child_profiles.display_name AS child_profile_name
       FROM household_review_items
       JOIN child_profiles
        ON child_profiles.id = household_review_items.child_profile_id
        AND child_profiles.household_id = household_review_items.household_id
       WHERE household_review_items.household_id = ?
        AND household_review_items.video_id IN (${placeholders})
       ORDER BY child_profile_name COLLATE NOCASE`
    )
    .all(householdId, ...videoIds, householdId, ...videoIds);

  const profilesByVideoId = new Map();
  rows.forEach((row) => {
    const names = profilesByVideoId.get(row.video_id) || [];
    names.push(row.child_profile_name);
    profilesByVideoId.set(row.video_id, names);
  });

  return profilesByVideoId;
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
              moderation_reviews.parent_explanation AS moderation_explanation,
              moderation_reviews.parent_facing_reason AS moderation_reason,
              channels.title AS channel_title
            FROM household_video_decisions
            JOIN videos ON videos.id = household_video_decisions.video_id
            LEFT JOIN channels ON channels.id = videos.channel_id
            LEFT JOIN moderation_reviews
              ON moderation_reviews.household_id = household_video_decisions.household_id
              AND moderation_reviews.video_id = household_video_decisions.video_id
            WHERE household_video_decisions.household_id = @householdId
              AND (
                @search = '%%'
                OR videos.title LIKE @search
                OR videos.description LIKE @search
                OR channels.title LIKE @search
                OR household_video_decisions.decision LIKE @search
                OR household_video_decisions.parent_facing_reason LIKE @search
                OR moderation_reviews.parent_explanation LIKE @search
                OR moderation_reviews.parent_facing_reason LIKE @search
              )
            ORDER BY household_video_decisions.updated_at DESC, household_video_decisions.id DESC`
          )
          .all(params)
          .map((video) => ({
            ...video,
            labels: parseLabels(video.labels_json),
            system_explanation: video.moderation_explanation || video.moderation_reason || '',
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

function getSearchAuditList(householdId, filters = {}) {
  const search = String(filters.search || '').trim();
  const source = String(filters.source || 'all');
  const requestedSort = String(filters.sort || 'newest');
  const sort = requestedSort === 'oldest' || requestedSort === 'zero_oldest' ? 'oldest' : 'newest';
  const zeroResults = requestedSort === 'zero_newest' || requestedSort === 'zero_oldest';
  const params = {
    householdId,
    search: `%${search}%`,
    source
  };
  const where = [
    'search_events.household_id = @householdId',
    `(@search = '%%' OR search_events.query LIKE @search OR search_events.original_query LIKE @search)`
  ];

  if (source !== 'all') {
    where.push('search_events.source_mode = @source');
  }

  if (zeroResults) {
    where.push('search_events.shown_to_child_count = 0');
  }

  const order = sort === 'oldest'
    ? 'search_events.created_at ASC, search_events.id ASC'
    : 'search_events.created_at DESC, search_events.id DESC';

  const searches = db
    .prepare(
      `SELECT
        search_events.id,
        search_events.query,
        search_events.created_at,
        search_events.source_mode,
        search_events.source_candidate_count,
        search_events.shown_to_child_count,
        search_events.sent_to_review_count,
        search_events.hard_blocked_count,
        search_events.unknown_count,
        search_events.blocked_count,
        child_profiles.display_name AS child_profile_name
       FROM search_events
       LEFT JOIN child_profiles ON child_profiles.id = search_events.child_profile_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}
       LIMIT 100`
    )
    .all(params)
    .map((event) => ({
      ...event,
      source_mode: event.source_mode || 'unknown',
      hidden_count: Math.max(0, Number(event.source_candidate_count || 0) - Number(event.shown_to_child_count || 0))
    }));

  const sources = db
    .prepare(
      `SELECT DISTINCT source_mode
       FROM search_events
       WHERE household_id = ?
        AND source_mode IS NOT NULL
       ORDER BY source_mode`
    )
    .all(householdId)
    .map((row) => row.source_mode);

  return {
    filters: {
      search,
      source,
      sort: requestedSort,
      zeroResults
    },
    sources,
    searches
  };
}

function getSearchAuditDetail(householdId, searchEventId) {
  const event = db
    .prepare(
      `SELECT
        search_events.*,
        child_profiles.display_name AS child_profile_name
       FROM search_events
       LEFT JOIN child_profiles ON child_profiles.id = search_events.child_profile_id
       WHERE search_events.household_id = ?
        AND search_events.id = ?`
    )
    .get(householdId, searchEventId);

  if (!event) {
    return null;
  }

  const candidates = db
    .prepare(
      `SELECT
        search_event_candidates.*,
        videos.duration_seconds,
        videos.primary_category,
        videos.external_id AS video_external_id,
        channels.external_id AS channel_external_id
       FROM search_event_candidates
       LEFT JOIN videos ON videos.id = search_event_candidates.video_id
       LEFT JOIN channels ON channels.id = search_event_candidates.channel_id
       WHERE search_event_candidates.household_id = ?
        AND search_event_candidates.search_event_id = ?
       ORDER BY
        CASE WHEN search_event_candidates.source_rank IS NULL THEN 1 ELSE 0 END,
        search_event_candidates.source_rank ASC,
        search_event_candidates.id ASC`
    )
    .all(householdId, searchEventId)
    .map((candidate) => ({
      ...candidate,
      content_tags: parseLabels(candidate.content_tags_json),
      risk_tags: parseLabels(candidate.risk_tags_json),
      quality_tags: parseLabels(candidate.quality_tags_json),
      review_link: candidate.video_id
        ? `/parent/reviews?search=${encodeURIComponent(candidate.title || '')}`
        : null,
      decision_link: candidate.video_id || candidate.channel_id
        ? `/parent/decisions?search=${encodeURIComponent(candidate.title || candidate.channel_title || '')}`
        : null
    }));

  const groups = groupSearchAuditCandidates(candidates);

  return {
    event: {
      ...event,
      source_mode: event.source_mode || 'unknown',
      hidden_count: Math.max(0, Number(event.source_candidate_count || 0) - Number(event.shown_to_child_count || 0))
    },
    candidates,
    groups
  };
}

function groupSearchAuditCandidates(candidates) {
  const sections = [
    {
      key: 'shown',
      title: 'Shown to child',
      candidates: []
    },
    {
      key: 'review',
      title: 'Pending parent review / parent-actionable',
      candidates: []
    },
    {
      key: 'hard_block',
      title: 'Hidden by hard block',
      candidates: []
    },
    {
      key: 'parent_block',
      title: 'Hidden by parent block decision',
      candidates: []
    },
    {
      key: 'unknown',
      title: 'Hidden because unknown / low confidence / not child-visible',
      candidates: []
    },
    {
      key: 'allow_limited',
      title: 'Hidden because allow_limited',
      candidates: []
    }
  ];
  const sectionByKey = new Map(sections.map((section) => [section.key, section]));

  candidates.forEach((candidate) => {
    sectionByKey.get(searchAuditGroupKey(candidate)).candidates.push(candidate);
  });

  return sections;
}

function searchAuditGroupKey(candidate) {
  if (candidate.shown_to_child) {
    return 'shown';
  }

  if (candidate.parent_decision_affected && candidate.final_decision === 'block') {
    return 'parent_block';
  }

  if (candidate.hard_block_reason) {
    return 'hard_block';
  }

  if (candidate.final_decision === 'allow_limited') {
    return 'allow_limited';
  }

  if (
    candidate.review_queue_state === 'created_pending' ||
    candidate.review_queue_state === 'matched_pending' ||
    candidate.final_decision === 'review'
  ) {
    return 'review';
  }

  return 'unknown';
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
  getParentDashboard,
  getReviewQueue,
  getDecisionHistory,
  getSearchAuditDetail,
  getSearchAuditList
};
