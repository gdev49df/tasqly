-- tasqly: схема базы Cloudflare D1

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER, -- конец пробных 5 дней «Команды», пусто пока не включён
  plan TEXT NOT NULL DEFAULT 'start' -- start, team, business
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- owner | member
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'basic', -- basic, advanced, it
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_ws ON projects(workspace_id);

-- колонки доски: у каждого проекта свои, названия и порядок настраиваются
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  is_done INTEGER NOT NULL DEFAULT 0, -- 1 = задачи в этой колонке считаются выполненными
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0, -- 0 нет, 1 низкий, 2 средний, 3 высокий
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT, -- YYYY-MM-DD
  task_type TEXT NOT NULL DEFAULT 'task', -- task, bug, feature, debt (для it-проектов)
  estimate_min INTEGER, -- оценка в минутах
  repeat TEXT NOT NULL DEFAULT 'none', -- none, daily, weekly, monthly
  position REAL NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id, position);

-- метки: общие для пространства
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

-- подзадачи и чек-листы внутри задачи
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id, position);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS mentions (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id);

-- время, заметки, чат, файлы
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  seconds INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_time_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, started_at);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_ws ON notes(workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ws ON messages(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_ws ON files(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS file_blobs (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

-- суточный лимит запросов к ai
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
