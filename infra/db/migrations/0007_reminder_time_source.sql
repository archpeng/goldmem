ALTER TABLE reminders ADD COLUMN IF NOT EXISTS time_text text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS time_confidence real;
