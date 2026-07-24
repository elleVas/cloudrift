# ADR-0083: Dedicated MCP client-configuration doc, with Claude Code added

- **Status:** Accepted (2026-07-24)

## Context

Following [ADR-0082](0082-mcp-server-second-input-adapter.md), client-connection instructions (Kiro, VS Code Copilot Chat) lived inline as a "Connecting an MCP client" subsection inside `docs/en/usage.md`/`docs/it/utilizzo.md` — a CLI flag-reference doc. Claude Code itself, despite being named alongside Kiro and VS Code in the `mcp` command's own description (`main.ts`) and in `architecture.md`'s prose, had no connection instructions anywhere: no `.mcp.json` example, no `claude mcp add` walkthrough, no mention of its `local`/`project`/`user` config scopes.

On 2026-07-24 the user ran `get_resource_types` and `analyze_cloudrift` live through this MCP server against a real AWS account (region `eu-central-1`) via the connected MCP client, confirming the end-to-end path from ADR-0082 works outside of tests. They then asked for a dedicated doc file covering Kiro, GitHub Copilot Chat, and Claude Code configuration, plus a full documentation pass and this ADR.

## Decision

- New dedicated pages, `docs/en/mcp-server.md` / `docs/it/server-mcp.md`: tool overview table (`analyze_cloudrift`/`get_resource_types`/`get_required_iam_permissions`, which ones call AWS), then one subsection per client — Kiro, VS Code (GitHub Copilot Chat, Agent mode), and the new **Claude Code** subsection (`claude mcp add` syntax, the `local`/`project`/`user` `--scope` table and where each persists, an equivalent hand-written `.mcp.json`, `claude mcp list`/`get`/`/mcp`, and the note that Claude Code's config format is incompatible with Claude Desktop's `claude_desktop_config.json`) — plus the shared "non-default AWS environment" (`env` passthrough) note extended to cover Claude Code's syntax.
- `docs/en/usage.md`/`docs/it/utilizzo.md`'s "Connecting an MCP client" subsection is reduced to one pointer line to the new doc — the command reference (`cloudrift mcp`, `CLOUDRIFT_DISABLE_MCP`) stays there since it's CLI-flag-shaped content, not client-config content.
- `docs/en/architecture.md`/`docs/it/architettura.md`'s MCP section gains a "see also" line to the new doc and to ADR-0082.
- `README.md`/`docs/it/leggimi.md` each gain a short "Use it as an MCP server" section (mirroring the existing per-domain sections like "Security posture") and a row in the documentation table — the root README had no MCP mention at all before this.

## Alternatives Considered

- **Leave client-config content inline in `usage.md`/`utilizzo.md`.** Rejected: that doc's purpose is CLI flag reference; three clients' worth of config formats, scopes, and gotchas is a different kind of content and was already the largest subsection in the file.
- **One file per client** (`kiro.md`, `vscode.md`, `claude-code.md`). Rejected: the three clients share most of the content (tool overview, the `env`-passthrough gotcha, the "formats aren't interchangeable" warning) — splitting them would triplicate that shared material for three sections short enough to coexist in one page.

## Consequences

Two new files (`docs/en/mcp-server.md`, `docs/it/server-mcp.md`). Six files edited: `docs/en/usage.md`, `docs/it/utilizzo.md`, `docs/en/architecture.md`, `docs/it/architettura.md`, `README.md`, `docs/it/leggimi.md`. No code change — this ADR is documentation-only, unlike ADR-0082.
