# ADR-0009: Three pricing layers, in priority order

- **Status:** Accepted

## Context

Cost estimates need to come from somewhere more accurate than a single static table, without losing the ability to run offline/in CI for free.

## Decision

Resolve a price for `(region, key)` from, in priority order: (1) the user's `prices` overrides in the config file (negotiated/company rates — highest priority), (2) the AWS Pricing API (`--live-pricing`, via `AwsPricingApiAdapter.warmUp`), (3) the built-in `prices.json` static fallback (always present). All three share the same `PriceTable` shape and compose via a plain `mergePriceTables`.

## Alternatives Considered

- **Always call the live Pricing API.** Rejected: requires an extra IAM permission and network calls on every run, breaks offline/CI use, and live responses aren't always unambiguous (see [ADR-0010](0010-live-price-unambiguous-match-only.md)).
- **Drop the static fallback now that live pricing exists.** Rejected: live pricing is opt-in; without a fallback, the default run path would have no prices at all.

## Consequences

Price getters stay synchronous (the live adapter warms up before the scan starts). Swapping or adding a pricing source never touches scanners or domain code — this is the payoff of the `PricingPort` abstraction.
</content>
