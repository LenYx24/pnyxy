-- Pilot telemetry: feature-usage events and session length for the
-- thesis. Write-only from the client (no select policy for users);
-- analysis reads with the service role. No message/document content is
-- ever stored, only event names and small structured props.
CREATE TABLE IF NOT EXISTS telemetry_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event      text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY telemetry_insert_own ON telemetry_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS telemetry_events_user_time
  ON telemetry_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS telemetry_events_event_time
  ON telemetry_events (event, created_at);
