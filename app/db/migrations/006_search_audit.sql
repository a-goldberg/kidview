ALTER TABLE search_events ADD COLUMN source_mode TEXT;
ALTER TABLE search_events ADD COLUMN source_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN hard_blocked_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN sent_to_review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN allowed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN allow_limited_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN unknown_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN blocked_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN shown_to_child_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_events ADD COLUMN audit_summary_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS search_event_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_event_id INTEGER NOT NULL,
  household_id INTEGER NOT NULL,
  child_profile_id INTEGER,
  video_id INTEGER,
  channel_id INTEGER,
  source_rank INTEGER,
  title TEXT NOT NULL,
  channel_title TEXT,
  final_decision TEXT NOT NULL CHECK (final_decision IN ('allow', 'allow_limited', 'review', 'block', 'unknown')),
  shown_to_child INTEGER NOT NULL DEFAULT 0 CHECK (shown_to_child IN (0, 1)),
  visibility_reason TEXT NOT NULL,
  hard_block_reason TEXT,
  content_tags_json TEXT NOT NULL DEFAULT '[]',
  risk_tags_json TEXT NOT NULL DEFAULT '[]',
  quality_tags_json TEXT NOT NULL DEFAULT '[]',
  moderation_source TEXT,
  parent_decision_source TEXT,
  parent_decision_affected INTEGER NOT NULL DEFAULT 0 CHECK (parent_decision_affected IN (0, 1)),
  review_queue_state TEXT,
  review_queue_reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (search_event_id) REFERENCES search_events(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (child_profile_id) REFERENCES child_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_search_event_candidates_search_event_id
ON search_event_candidates(search_event_id);

CREATE INDEX IF NOT EXISTS idx_search_event_candidates_household_id
ON search_event_candidates(household_id);
