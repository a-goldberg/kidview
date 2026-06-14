ALTER TABLE child_profiles
ADD COLUMN allow_limited_policy TEXT NOT NULL DEFAULT 'block'
CHECK (allow_limited_policy IN ('block', 'review', 'allow', 'limited_frequency'));

ALTER TABLE child_profiles
ADD COLUMN allow_limited_min_confidence REAL NOT NULL DEFAULT 0.70
CHECK (allow_limited_min_confidence >= 0 AND allow_limited_min_confidence <= 1);

ALTER TABLE search_event_candidates
ADD COLUMN visibility_reason_code TEXT;
