-- 0005: пробный период «Команды» (5 дней для новых аккаунтов). выполнять один раз.
ALTER TABLE users ADD COLUMN trial_ends_at INTEGER;
