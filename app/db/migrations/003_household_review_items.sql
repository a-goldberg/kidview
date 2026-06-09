CREATE TABLE IF NOT EXISTS household_review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  child_profile_id INTEGER,
  video_id INTEGER NOT NULL,
  search_event_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'approved', 'blocked', 'expired')),
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_parent_user_id INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (child_profile_id) REFERENCES child_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (search_event_id) REFERENCES search_events(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by_parent_user_id) REFERENCES parent_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_review_items_one_pending_video
ON household_review_items(household_id, video_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_household_review_items_household_status
ON household_review_items(household_id, status);

INSERT INTO household_review_items (
  household_id,
  video_id,
  status,
  reason_code,
  created_at,
  updated_at
)
SELECT
  moderation_reviews.household_id,
  moderation_reviews.video_id,
  'pending',
  COALESCE(moderation_reviews.decision, moderation_reviews.status, 'unknown'),
  moderation_reviews.created_at,
  moderation_reviews.created_at
FROM moderation_reviews
JOIN videos ON videos.id = moderation_reviews.video_id
LEFT JOIN household_video_decisions
  ON household_video_decisions.household_id = moderation_reviews.household_id
  AND household_video_decisions.video_id = moderation_reviews.video_id
LEFT JOIN household_channel_decisions
  ON household_channel_decisions.household_id = moderation_reviews.household_id
  AND household_channel_decisions.channel_id = videos.channel_id
WHERE household_video_decisions.id IS NULL
  AND (household_channel_decisions.decision IS NULL OR household_channel_decisions.decision != 'blocked')
  AND videos.is_short = 0
  AND videos.is_livestream = 0
  AND COALESCE(moderation_reviews.decision, moderation_reviews.status) IN ('review', 'unknown', 'allow_limited')
ON CONFLICT(household_id, video_id) WHERE status = 'pending' DO NOTHING;
