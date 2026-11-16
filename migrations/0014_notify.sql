-- письма-уведомления: настройки пользователя и учёт уже отправленных напоминаний о сроке
ALTER TABLE users ADD COLUMN notify_assigned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_mentioned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_due INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS due_notices (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id, due_date)
);
