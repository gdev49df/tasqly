-- рост: приглашения друзей и источник регистрации
ALTER TABLE users ADD COLUMN ref_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN ref_rewarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN signup_source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
