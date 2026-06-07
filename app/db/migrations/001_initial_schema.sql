CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parent_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS policy_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  max_results INTEGER NOT NULL DEFAULT 3 CHECK (max_results BETWEEN 1 AND 3),
  allow_shorts INTEGER NOT NULL DEFAULT 0 CHECK (allow_shorts IN (0, 1)),
  allow_livestreams INTEGER NOT NULL DEFAULT 0 CHECK (allow_livestreams IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  policy_profile_id INTEGER,
  display_name TEXT NOT NULL,
  birth_year INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_profile_id) REFERENCES policy_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'youtube',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER,
  source TEXT NOT NULL DEFAULT 'youtube',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_seconds INTEGER,
  category_key TEXT NOT NULL DEFAULT 'general',
  is_short INTEGER NOT NULL DEFAULT 0 CHECK (is_short IN (0, 1)),
  is_livestream INTEGER NOT NULL DEFAULT 0 CHECK (is_livestream IN (0, 1)),
  transcript_stored INTEGER NOT NULL DEFAULT 0 CHECK (transcript_stored IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS moderation_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'blocked')),
  parent_facing_reason TEXT,
  reviewed_by_parent_user_id INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_parent_user_id) REFERENCES parent_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS household_video_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'block')),
  parent_facing_reason TEXT,
  decided_by_parent_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by_parent_user_id) REFERENCES parent_users(id) ON DELETE SET NULL,
  UNIQUE (household_id, video_id)
);

CREATE TABLE IF NOT EXISTS household_channel_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'block')),
  parent_facing_reason TEXT,
  decided_by_parent_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by_parent_user_id) REFERENCES parent_users(id) ON DELETE SET NULL,
  UNIQUE (household_id, channel_id)
);

CREATE TABLE IF NOT EXISTS search_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  child_profile_id INTEGER,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count BETWEEN 0 AND 3),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (child_profile_id) REFERENCES child_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_parent_users_household_id ON parent_users(household_id);
CREATE INDEX IF NOT EXISTS idx_child_profiles_household_id ON child_profiles(household_id);
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_search_events_household_id ON search_events(household_id);
