-- Existing households keep their oldest parent as administrator. New accounts
-- default to the less privileged role; do not infer demo status from a name.
ALTER TABLE households ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
CREATE UNIQUE INDEX idx_single_demo_household ON households(is_demo) WHERE is_demo = 1;
ALTER TABLE parent_users ADD COLUMN role TEXT NOT NULL DEFAULT 'parent' CHECK (role IN ('admin', 'parent'));
ALTER TABLE parent_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE parent_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
UPDATE parent_users SET role = 'admin'
WHERE id IN (SELECT MIN(id) FROM parent_users GROUP BY household_id);
-- Fail safely if legacy accounts have ambiguous case-insensitive logins.
CREATE UNIQUE INDEX idx_parent_email_normalized ON parent_users(lower(email));
