# Pricing sources

> 🇮🇹 [Versione italiana](../it/fonti-prezzi.md)

Static table, live AWS Pricing API, and your own overrides.

Costs are resolved from three layers; the most specific wins, per `(region, priceKey)`:

1. **Your `prices` overrides** (config) — your negotiated/company rates. **Highest priority.**
2. **AWS Pricing API** (`--live-pricing`) — current public list prices, fetched at startup.
3. **Built-in static table** (`prices.json`) — always present as the fallback.

Every report shows `prices as of` (the static date, the live fetch date, or `+ custom overrides`).

> **Honest caveat:** even with `--live-pricing`, AWS returns **list** prices, not *your* bill — Savings Plans, Reserved Instances and EDP discounts are not reflected. The `prices` override is the only way to make the report match what you actually pay. Anything the live API can't unambiguously resolve falls back to the static table.
