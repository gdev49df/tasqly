-- существующие аккаунты остаются на «Команде» (grandfathered), новые регистрируются на «Старте»
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'team';
