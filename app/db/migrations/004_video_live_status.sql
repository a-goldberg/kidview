ALTER TABLE videos ADD COLUMN live_status TEXT NOT NULL DEFAULT 'none' CHECK (live_status IN ('none', 'upcoming', 'live', 'completed_live'));

UPDATE videos
SET live_status = CASE
  WHEN is_livestream = 1 THEN 'completed_live'
  ELSE 'none'
END;
