-- Heal a schema drift: the send-feedback edge function inserts an `ip_hash`
-- (salted IP hash for anonymous senders), but the live `feedback` table was
-- created from an earlier version of 00086 that predated that column, and
-- 00086 was already marked applied on the remote, so the later edit that added
-- `ip_hash` to the file never ran there. The insert then failed with
-- PGRST204 "Could not find the 'ip_hash' column", surfacing as a 500 on
-- /feedback. Add it idempotently so both fresh and drifted databases converge.
alter table public.feedback add column if not exists ip_hash text;
