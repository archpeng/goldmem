ALTER TABLE elder_profiles
  ADD COLUMN IF NOT EXISTS wake_time text,
  ADD COLUMN IF NOT EXISTS sleep_time text,
  ADD COLUMN IF NOT EXISTS medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS places jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS elder_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE elder_profiles
SET elder_id = COALESCE(NULLIF(user_id, ''), id)
WHERE elder_id IS NULL;

ALTER TABLE elder_profiles ALTER COLUMN elder_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS elder_profiles_tenant_elder_unique
  ON elder_profiles (tenant_id, elder_id);
