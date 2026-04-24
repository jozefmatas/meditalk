-- Prompt-caching instrumentation for Anthropic calls.
--
-- When renderSection / criticPass / etc. use the array-form system prompt
-- with `cache_control: ephemeral` breakpoints, Anthropic returns two
-- additional counters alongside the usual input/output tokens:
--   - cache_creation_input_tokens — tokens written to a new cache entry
--   - cache_read_input_tokens     — tokens served from an existing cache
--
-- Persisting these lets us (a) measure cache hit-rate per template / per
-- visit, and (b) distinguish "cold" first-visit cost from "warm" second+
-- visit cost. Columns are nullable because non-Anthropic rows + rows
-- predating this migration have no such data.

ALTER TABLE public.api_usage
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens int,
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens int;
