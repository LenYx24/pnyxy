-- Full-text search across chat message content.
--
-- The sidebar could only filter conversation titles, so "where did I discuss
-- X?" meant opening threads one by one. This adds the index and one RPC that
-- answers that question: matching messages, grouped into the conversation
-- they belong to, newest first, with a highlighted snippet.
--
-- Config is 'simple' on purpose: the app is used in Hungarian and English
-- (often in the same conversation), and 'simple' indexes every word as-is
-- rather than stemming one language and mangling the other. The cost is no
-- stemming, so a single-word query is turned into a prefix match instead,
-- which is what keeps "neuron" finding "neuronok" while typing.
--
-- SECURITY INVOKER (the default): RLS on chat_messages already limits reads
-- to the caller's own conversations, so the function needs no privileges of
-- its own. Column names are prefixed to avoid the RETURNS TABLE / bare
-- column ambiguity that bites plpgsql functions (42702).

CREATE INDEX IF NOT EXISTS chat_messages_content_fts_idx
  ON public.chat_messages
  USING gin (to_tsvector('simple', content));

CREATE OR REPLACE FUNCTION public.search_chat_messages(
  p_query text,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  out_conversation_id uuid,
  out_match_count bigint,
  out_snippet text,
  out_last_match_at timestamptz
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_query tsquery;
  v_trimmed text := btrim(coalesce(p_query, ''));
BEGIN
  IF v_trimmed = '' THEN
    RETURN;
  END IF;

  -- One bare word is almost always a half-typed one, so match it as a
  -- prefix (quote_literal keeps the operator characters out of to_tsquery).
  -- Anything richer goes through websearch_to_tsquery, which handles
  -- quoted phrases, OR and leading - the way a search box should.
  IF v_trimmed ~ '^[[:alnum:]_]+$' THEN
    v_query := to_tsquery('simple', quote_literal(v_trimmed) || ':*');
  ELSE
    v_query := websearch_to_tsquery('simple', v_trimmed);
  END IF;
  IF v_query IS NULL OR v_query = ''::tsquery THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.conversation_id AS out_conversation_id,
    count(*) AS out_match_count,
    -- snippet from the most recent matching message in the conversation
    (
      SELECT ts_headline(
               'simple',
               m2.content,
               v_query,
               'StartSel=<<,StopSel=>>,MaxWords=18,MinWords=6,MaxFragments=1'
             )
      FROM public.chat_messages m2
      WHERE m2.conversation_id = m.conversation_id
        AND to_tsvector('simple', m2.content) @@ v_query
      ORDER BY m2.created_at DESC
      LIMIT 1
    ) AS out_snippet,
    max(m.created_at) AS out_last_match_at
  FROM public.chat_messages m
  WHERE to_tsvector('simple', m.content) @@ v_query
  GROUP BY m.conversation_id
  ORDER BY max(m.created_at) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_chat_messages(text, integer) TO authenticated;
