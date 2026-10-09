-- Apply only to an isolated, reviewed, free-plan D1 database.
-- No automatic migrations, no production write, no dashboard modification.
CREATE TABLE IF NOT EXISTS public_inference_reservations (
  nonce TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  project TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare','groq')),
  day_utc TEXT NOT NULL,
  minute_utc TEXT NOT NULL,
  max_tokens INTEGER NOT NULL CHECK (max_tokens BETWEEN 1 AND 256)
);
CREATE INDEX IF NOT EXISTS idx_pi_day ON public_inference_reservations(day_utc);
CREATE INDEX IF NOT EXISTS idx_pi_user_day ON public_inference_reservations(day_utc, subject);
CREATE INDEX IF NOT EXISTS idx_pi_minute ON public_inference_reservations(minute_utc);
