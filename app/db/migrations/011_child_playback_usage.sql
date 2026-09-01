CREATE TABLE IF NOT EXISTS child_daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  child_profile_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  video_watch_count INTEGER NOT NULL DEFAULT 0 CHECK (video_watch_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (child_profile_id) REFERENCES child_profiles(id) ON DELETE CASCADE,
  UNIQUE (household_id, child_profile_id, usage_date)
);

CREATE TABLE IF NOT EXISTS child_video_playbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  child_profile_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_progress_at TEXT,
  max_progress_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_progress_seconds >= 0),
  completed_at TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (child_profile_id) REFERENCES child_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  UNIQUE (household_id, child_profile_id, video_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_child_video_playbacks_active_child
ON child_video_playbacks(household_id, child_profile_id, usage_date);
