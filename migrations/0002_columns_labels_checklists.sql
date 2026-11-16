-- 0002: колонки, метки и чек-листы. выполнять один раз на базе, созданной по первой версии schema.sql.
-- старая колонка tasks.status остаётся в таблице (SQLite не умеет удалять NOT NULL колонки), но больше не используется.

CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id, position);

INSERT INTO columns (id, project_id, name, position, is_done, created_at)
  SELECT p.id || ':todo', p.id, 'К выполнению', 1000, 0, p.created_at FROM projects p;
INSERT INTO columns (id, project_id, name, position, is_done, created_at)
  SELECT p.id || ':doing', p.id, 'В работе', 2000, 0, p.created_at FROM projects p;
INSERT INTO columns (id, project_id, name, position, is_done, created_at)
  SELECT p.id || ':done', p.id, 'Готово', 3000, 1, p.created_at FROM projects p;

ALTER TABLE tasks ADD COLUMN column_id TEXT REFERENCES columns(id) ON DELETE CASCADE;
UPDATE tasks SET column_id = project_id || ':' || status;
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id, position);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id, position);
