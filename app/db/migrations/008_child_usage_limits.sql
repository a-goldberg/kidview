ALTER TABLE child_profiles
ADD COLUMN daily_search_limit INTEGER
CHECK (daily_search_limit IS NULL OR daily_search_limit >= 1);

ALTER TABLE child_profiles
ADD COLUMN daily_video_watch_limit INTEGER
CHECK (daily_video_watch_limit IS NULL OR daily_video_watch_limit >= 1);
