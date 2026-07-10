# ADR-0057: Unknown price keys in config produce a non-blocking warning

- **Status:** Accepted (2026-07-10)

## Context

The config schema accepts `prices` as `Record<string, Record<string, number>>` with no validation against known keys. A typo (`ebs-gp2` vs `ebs_gp2`) silently produces a price override that's never applied — nobody is told, the correct-looking config entry just does nothing.

## Decision

`warnOnUnknownPriceKeys()` in `apps/cli/src/commands/pricing.factory.ts` (`buildPricing`, the sole place `config.prices` is consumed): compares every key in `config.prices[region]` against the union of keys already present in the price table **as built so far** — static table plus `--live-pricing` additions if enabled, before the user's override is merged in. This ordering matters: checking against `prices.json` alone would false-flag a key that only exists because live pricing introduced it. Warns via `ctx.info` (already routed to stderr in non-table mode, consistent with the rest of the command), one warning per unknown key, non-blocking — the override is still applied, since a typo in one key shouldn't prevent the other correct keys in the same file from working.

## Alternatives Considered

- **Reject the config file outright on any unknown key.** Rejected: too strict for a case that's clearly a DX papercut, not a correctness hazard — the tool should tell the user and move on, not block the whole run over one bad key.
- **Validate only against the static `prices.json` keys.** Rejected: would produce false positives for `--live-pricing` users, whose price table includes keys the static file doesn't have.

## Consequences

New `pricing.factory.spec.ts` (previously absent): 4 tests — warning on an unknown key, no warning on a known key, no warning when `config.prices` is absent, and confirmation the override still applies despite the warning. 64/64 cli tests passed at the time. See `docs/code-review-2026-07-10.md` §7.
