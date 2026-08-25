-- ═══════════════════════════════════════════════════════════════════
-- Migration: Email & SMS Notification System
-- Configurable per-user preferences + notification log
-- ═══════════════════════════════════════════════════════════════════

-- NOTIFICATION PREFERENCES: Per-user opt-in/out per channel per event
CREATE TABLE IF NOT EXISTS notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id);

-- NOTIFICATION LOG: Track every notification sent
CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  event_type VARCHAR(50) NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK(channel IN ('EMAIL','SMS')),
  recipient VARCHAR(200) NOT NULL,
  subject VARCHAR(300),
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SENT' CHECK(status IN ('SENT','FAILED','PENDING')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_user ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_type ON notification_log(event_type);
CREATE INDEX IF NOT EXISTS idx_notif_log_created ON notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_status ON notification_log(status);

-- Default notification preferences for all existing users
-- Low stock alerts: email ON, SMS OFF
INSERT INTO notification_preferences (user_id, event_type, email_enabled, sms_enabled)
SELECT u.id, 'LOW_STOCK', TRUE, FALSE FROM users u WHERE u.is_active = TRUE
ON CONFLICT (user_id, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, event_type, email_enabled, sms_enabled)
SELECT u.id, 'OUT_OF_STOCK', TRUE, FALSE FROM users u WHERE u.is_active = TRUE
ON CONFLICT (user_id, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, event_type, email_enabled, sms_enabled)
SELECT u.id, 'EXPIRING_SOON', TRUE, FALSE FROM users u WHERE u.is_active = TRUE
ON CONFLICT (user_id, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, event_type, email_enabled, sms_enabled)
SELECT u.id, 'DAILY_REPORT', TRUE, FALSE FROM users u WHERE u.role IN ('ADMIN','MANAGER') AND u.is_active = TRUE
ON CONFLICT (user_id, event_type) DO NOTHING;

INSERT INTO notification_preferences (user_id, event_type, email_enabled, sms_enabled)
SELECT u.id, 'SALE_MILESTONE', TRUE, FALSE FROM users u WHERE u.role IN ('ADMIN','MANAGER') AND u.is_active = TRUE
ON CONFLICT (user_id, event_type) DO NOTHING;
