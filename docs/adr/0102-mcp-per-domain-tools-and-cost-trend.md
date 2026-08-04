# ADR-0102: Per-domain MCP tools + `get_cost_trend`, and a shared `resolveMcpScope()`

- **Status:** Accepted (2026-08-04)

## Context

The MCP server ([ADR-0082](0082-mcp-server-second-input-adapter.md) — original rollout) exposed a single AWS-calling
tool, `analyze_cloudrift`, aggregating all four domains (cloud-cost waste, dead resources, resource security,
cost trend) into one report. That's the right default for "give me everything," but an MCP client that only
cares about one domain — e.g. an agent doing a security sweep, not a cost review — still pays for a full
four-domain scan: every scanner across every domain runs, even though only one domain's findings are used.

Cost trend (Cost Explorer) was folded into `analyze_cloudrift`'s aggregate report but had no standalone tool
of its own, unlike the CLI's own `trend` command.

## Decision

Four new MCP tools, alongside the existing `analyze_cloudrift`:

- `analyze_cloud_waste`, `analyze_dead_resources`, `analyze_resource_security` — one domain each, same options
  as that domain's slice of `analyze_cloudrift` (minus the knobs that don't apply, e.g. no `minAgeDays` for
  resource-security, no `livePricing` for dead-resources/resource-security).
- `get_cost_trend` — mirrors the CLI's `trend` command, skipping its interactive
  `confirmCostExplorerCharge` prompt (no terminal to confirm against over MCP), same reasoning already applied
  to `costTrend` inside `analyze_cloudrift`.

**Alternatives considered:**

- **A `domains` filter param on `analyze_cloudrift` instead of separate tools** (e.g.
  `analyze_cloudrift({ domains: ['resourceSecurity'] })`). Rejected: MCP tool descriptions are the only signal
  a client has to decide what to call before invoking it — a filter param buried inside one generic tool's
  schema is far less discoverable than four tools whose names and descriptions each state their scope and cost
  up front. Four dedicated tools also keep each one's Zod schema honest (no shared params that only apply to
  some domains).

Each per-domain composition function (`defaultRunCloudWaste`, `defaultRunDeadResources`,
`defaultRunResourceSecurity`) duplicated the same four-line preamble already in `defaultRunAggregateAnalysis`:
load config, parse/validate regions, resolve the AWS account ID via STS. Factored out once into
`resolveMcpScope()` (`mcp.composition.ts`) — a plain `{ config, regions, accountId }` resolver every
analysis tool composes on top of before building its own domain-specific `policyOptions`.

## Consequences

Server now exposes 7 tools total (3 static/original + `analyze_cloudrift` + the 4 new ones). All AWS-calling
tools — `analyze_cloudrift`, the three per-domain `analyze_*` tools, and `get_cost_trend` — share one IAM
policy via `get_required_iam_permissions` (none needs a narrower one of its own), and are deliberately left
out of every client config's `autoApprove` example in `docs/en/mcp-server.md`/`docs/it/server-mcp.md`.

`resolveMcpScope()` removed a 4x-duplicated config/region/account preamble across `defaultRunAggregateAnalysis`
and the three new per-domain functions.

Verified: typecheck, lint, and the full CLI test suite (307 tests) green. Docs updated everywhere
(`mcp-server.md`/`server-mcp.md`, `usage.md`/`utilizzo.md`, `architecture.md`/`architettura.md`, `README.md`,
`leggimi.md`, `e2e-localstack-mcp.mjs`). Manually verified live against real AWS via Kiro (2026-08-04), same
gate the original MCP rollout went through before merging.
