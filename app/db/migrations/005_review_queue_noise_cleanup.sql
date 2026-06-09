UPDATE household_review_items
SET
  status = 'expired',
  reason_code = 'queue_noise_cleanup',
  resolved_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM videos
    LEFT JOIN moderation_reviews
      ON moderation_reviews.household_id = household_review_items.household_id
      AND moderation_reviews.video_id = household_review_items.video_id
    LEFT JOIN household_video_decisions
      ON household_video_decisions.household_id = household_review_items.household_id
      AND household_video_decisions.video_id = household_review_items.video_id
    LEFT JOIN household_channel_decisions
      ON household_channel_decisions.household_id = household_review_items.household_id
      AND household_channel_decisions.channel_id = videos.channel_id
    WHERE videos.id = household_review_items.video_id
      AND (
        household_video_decisions.id IS NOT NULL
        OR household_channel_decisions.decision = 'blocked'
        OR videos.is_short = 1
        OR videos.live_status IN ('live', 'upcoming')
        OR COALESCE(moderation_reviews.decision, moderation_reviews.status, household_review_items.reason_code) NOT IN ('allow_limited', 'review', 'unknown')
      )
  );
