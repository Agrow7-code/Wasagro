-- =============================================================================
-- Wasagro — Persistent rate limiter for serverless (Vercel)
--
-- PROBLEM: In-memory Map in src/auth/rateLimiter.ts does not survive cold
-- starts on Vercel. Each lambda instance has its own counter, allowing an
-- attacker to distribute requests across instances to bypass the limit.
--
-- FIX: Atomic upsert in Postgres with TTL semantics. The RPC rate_limit_hit()
-- returns the current count, reset_at, and whether the request is allowed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key  TEXT        PRIMARY KEY,
  count       INTEGER     NOT NULL DEFAULT 0,
  reset_at    TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_reset_at ON rate_limit_buckets(reset_at);

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_service_only ON rate_limit_buckets;
CREATE POLICY rate_limit_service_only ON rate_limit_buckets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Atomic increment with reset-on-expiry semantics.
-- Returns (count, reset_at, allowed) so the caller can populate
-- X-RateLimit-* headers and decide whether to return 429.
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key       TEXT,
  p_window_ms INTEGER,
  p_max       INTEGER
)
RETURNS TABLE(count INTEGER, reset_at TIMESTAMPTZ, allowed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now    TIMESTAMPTZ := NOW();
  v_count  INTEGER;
  v_reset  TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'rate_limit_hit is service_role only';
  END IF;

  INSERT INTO rate_limit_buckets (bucket_key, count, reset_at, updated_at)
  VALUES (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE
          WHEN rate_limit_buckets.reset_at < v_now THEN 1
          ELSE rate_limit_buckets.count + 1
        END,
        reset_at = CASE
          WHEN rate_limit_buckets.reset_at < v_now
            THEN v_now + (p_window_ms || ' milliseconds')::interval
          ELSE rate_limit_buckets.reset_at
        END,
        updated_at = v_now
  RETURNING rate_limit_buckets.count, rate_limit_buckets.reset_at
    INTO v_count, v_reset;

  RETURN QUERY SELECT v_count, v_reset, v_count <= p_max;
END;
$$;

-- Optional housekeeping: periodically purge expired buckets to keep the table
-- small. Can be called from a cron job or pg_cron. Safe to run any time.
CREATE OR REPLACE FUNCTION rate_limit_cleanup() RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'rate_limit_cleanup is service_role only';
  END IF;

  DELETE FROM rate_limit_buckets WHERE reset_at < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
