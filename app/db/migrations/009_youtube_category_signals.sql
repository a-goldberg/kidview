ALTER TABLE videos ADD COLUMN youtube_category_id TEXT;
ALTER TABLE videos ADD COLUMN made_for_kids INTEGER NOT NULL DEFAULT 0 CHECK (made_for_kids IN (0, 1));
