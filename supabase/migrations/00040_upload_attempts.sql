-- ── Upload attempt telemetry ─────────────────────────────────
--
-- Tracks every book-upload attempt so we can see what formats
-- users actually try to bring in. The signal we want is:
-- "if 5+ unique users in the last 30 days tried to upload .mobi,
-- it's worth shipping MOBI support". Today the supported set is
-- pdf + epub + txt + md/markdown; everything else is silently
-- ignored, which means we have no data on demand.
--
-- Privacy: we deliberately do NOT store filenames (too
-- identifying — e.g. "Szakdolgozat_v3.docx") or content. Only
-- the extension, MIME type, size, and an outcome status. The
-- user_id link is `on delete set null` so GDPR erasure leaves
-- aggregate counts intact without back-linking to a person.
--
-- RLS: authenticated users can insert their own attempts; only
-- the service role can read. There's no client-side read path,
-- so the data only flows out via Supabase admin tooling.

CREATE TABLE public.upload_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extension       text NOT NULL,                       -- lowercased, leading dot: ".docx" / ".pdf"
  mime_type       text,                                -- file.type from the browser; may be empty
  size_bytes      bigint,                              -- 0 if rejected before any read
  status          text NOT NULL CHECK (status IN (
                    'accepted',                        -- upload pipeline accepted the file
                    'rejected_unsupported_format',     -- known book extension we don't yet handle
                    'rejected_too_large',              -- storage cap pre-check failed
                    'upload_failed',                   -- storage / network error mid-upload
                    'parse_failed'                     -- adapter couldn't parse the file
                  )),
  failure_reason  text,                                -- optional free text from the failure path
  client_platform text,                                -- 'web' | 'tauri-desktop' | 'tauri-android' | 'tauri-ios'
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX upload_attempts_ext_status_idx
  ON public.upload_attempts (extension, status, created_at DESC);

ALTER TABLE public.upload_attempts ENABLE ROW LEVEL SECURITY;

-- Authenticated users can record their own attempts. No update /
-- delete policies — the row is write-once from the client side.
CREATE POLICY "users insert own upload attempts"
  ON public.upload_attempts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
