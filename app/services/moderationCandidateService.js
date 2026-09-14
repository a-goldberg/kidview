// Keep every database-backed moderation path on the same candidate shape.
const MODERATION_CANDIDATE_SELECT = `SELECT
  videos.id AS videoId,
  videos.external_id AS externalId,
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
  videos.live_status AS liveStatus,
  videos.published_at AS publishedAt,
  videos.view_count AS viewCount,
  videos.youtube_category_id AS youtubeCategoryId,
  videos.youtube_category_title AS youtubeCategoryTitle,
  videos.made_for_kids AS madeForKids,
  channels.id AS channelId,
  channels.title AS channelTitle
 FROM videos
 JOIN channels ON channels.id = videos.channel_id`

module.exports = { MODERATION_CANDIDATE_SELECT }
