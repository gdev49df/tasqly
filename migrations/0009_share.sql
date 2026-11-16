ALTER TABLE projects ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_share ON projects(share_token) WHERE share_token IS NOT NULL;
