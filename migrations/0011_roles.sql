-- уровни доступа members.role: owner | admin | member | viewer; свои роли — только название и цвет поверх уровня
CREATE TABLE IF NOT EXISTS workspace_roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wroles_ws ON workspace_roles(workspace_id);
ALTER TABLE members ADD COLUMN role_id TEXT REFERENCES workspace_roles(id) ON DELETE SET NULL;
