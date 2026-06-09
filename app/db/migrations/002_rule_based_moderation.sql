ALTER TABLE videos ADD COLUMN published_at TEXT;
ALTER TABLE videos ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE moderation_reviews ADD COLUMN decision TEXT CHECK (decision IN ('allow', 'allow_limited', 'review', 'block', 'unknown'));
ALTER TABLE moderation_reviews ADD COLUMN confidence_score REAL NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1);
ALTER TABLE moderation_reviews ADD COLUMN primary_category TEXT NOT NULL DEFAULT 'General';
ALTER TABLE moderation_reviews ADD COLUMN content_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE moderation_reviews ADD COLUMN risk_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE moderation_reviews ADD COLUMN quality_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE moderation_reviews ADD COLUMN child_explanation TEXT;
ALTER TABLE moderation_reviews ADD COLUMN parent_explanation TEXT;
ALTER TABLE moderation_reviews ADD COLUMN model_name TEXT NOT NULL DEFAULT 'rule-based-v1';
ALTER TABLE moderation_reviews ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'rules-v1';
ALTER TABLE moderation_reviews ADD COLUMN transcript_used INTEGER NOT NULL DEFAULT 0 CHECK (transcript_used IN (0, 1));
