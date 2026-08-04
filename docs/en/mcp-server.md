# Using cloudrift as an MCP server

> 🇮🇹 [Versione italiana](../it/server-mcp.md)

cloudrift can run as a local [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server, so an AI coding agent — Claude Code, Kiro, VS Code Copilot Chat (Agent mode), or any other MCP-compatible client — can call cloudrift's scanners directly as tools, instead of you running the CLI by hand and pasting output back in.

This page only covers **connecting a client**. For the `cloudrift mcp` command itself (how to start it, the `CLOUDRIFT_DISABLE_MCP` kill switch), see [usage.md](usage.md#mcp--run-cloudrift-as-a-local-mcp-server).

## Tools exposed

| Tool | Makes AWS calls? | What it returns |
| --- | --- | --- |
| `analyze_cloudrift` | **Yes** — real, credentialed calls | One aggregated JSON report across all four domains (cloud-cost waste, dead resources, resource security, cost trend). Accepts `regions`, `livePricing`, `minAgeDays`, `ignoreTag`, `configPath` — the same knobs as `cloudrift.config.json`. |
| `analyze_cloud_waste` | **Yes** — real, credentialed calls | Cloud-cost waste only — a narrower, cheaper alternative to `analyze_cloudrift` when you don't need the other three domains. Same options as that domain's slice of `analyze_cloudrift`. |
| `analyze_dead_resources` | **Yes** — real, credentialed calls | Dead/unused resources only. Accepts `regions`, `minAgeDays`, `ignoreTag`, `configPath`. |
| `analyze_resource_security` | **Yes** — real, credentialed calls | Insecurely-configured resources only. Accepts `regions`, `ignoreTag`, `configPath` (no `minAgeDays` — resource-security checks don't take a grace period). |
| `get_cost_trend` | **Yes** — real, credentialed calls (Cost Explorer, a paid API) | Monthly AWS spend over the last N calendar months, optionally filtered to specific services. Accepts `months`, `services`, `accountId`, `refreshCache`. |
| `get_resource_types` | No — static | The full catalog of resource kinds cloudrift can detect, with labels. |
| `get_required_iam_permissions` | No — static | The read-only IAM policy the AWS principal needs for every AWS-calling tool above (they all share one policy — none needs a narrower one of its own). |

`analyze_cloudrift`, the three per-domain `analyze_*` tools, and `get_cost_trend` all inherit the **same AWS credentials** as every other `cloudrift` command — an agent with access to this server can see everything those credentials can see, not just waste/dead-resource/security findings. Keep that in mind when deciding whether to auto-approve any of them (see each client's section below).

## Connecting a client

Kiro, VS Code, and Claude Code each use a **different config format** — a file copied 1:1 from one to another will not work.

### Kiro IDE

`.kiro/settings/mcp.json` (workspace) or `~/.kiro/settings/mcp.json` (global), root key `mcpServers`:

```json
{
  "mcpServers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"],
      "disabled": false,
      "autoApprove": ["get_resource_types", "get_required_iam_permissions"]
    }
  }
}
```

`analyze_cloudrift`, `analyze_cloud_waste`, `analyze_dead_resources`, `analyze_resource_security`, and `get_cost_trend` are deliberately left out of `autoApprove` above: they're the five tools that make real, credentialed AWS calls — the other two are static. Add them yourself once you're comfortable with that.

### VS Code (GitHub Copilot Chat, Agent mode)

`.vscode/mcp.json` (workspace) or via `MCP: Open User Configuration`, root key `servers` (not `mcpServers`):

```json
{
  "servers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"]
    }
  }
}
```

MCP tools are only usable in Copilot Chat's **Agent mode** — not Ask/Edit mode.

### Claude Code

Claude Code has three config scopes, chosen with `--scope` on `claude mcp add` (default is `local`):

| Scope | Stored in | Who sees it |
| --- | --- | --- |
| `local` (default) | `~/.claude.json`, under this project only | Just you, just this project |
| `project` | `.mcp.json` at the repo root | Anyone who clones the repo (commit this file if you want that) |
| `user` | `~/.claude.json`, top-level | Just you, every project |

Quickest way — let the CLI write the config for you:

```sh
claude mcp add cloudrift -- npx @cloudrift/cli@latest mcp
```

Add `--scope project` instead if you want `.mcp.json` checked into the repo and shared with the rest of the team (a project-scoped server needs a one-time trust approval the first time each teammate opens the project). Equivalent, hand-written `.mcp.json`:

```json
{
  "mcpServers": {
    "cloudrift": {
      "type": "stdio",
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"]
    }
  }
}
```

Useful commands: `claude mcp list` (status of every configured server), `claude mcp get cloudrift` (details for this one), and `/mcp` inside a session (approval/reconnection panel). Unlike Claude Desktop, Claude Code does **not** read `claude_desktop_config.json` — the two formats are incompatible (a one-way `claude mcp add-from-claude-desktop` importer exists if you already have a Claude Desktop config).

There is no `autoApprove` equivalent here — Claude Code prompts for approval on a tool's first call in a session, per its own permission system; `analyze_cloudrift` making real AWS calls is exactly the kind of thing worth reviewing on that first prompt rather than pre-approving.

## Using a non-default AWS environment

An MCP client spawns `cloudrift mcp` with a curated, minimal environment — **not** a copy of your shell's. If you normally rely on `AWS_PROFILE`, a region override, or anything else set in your shell profile, it will **not** reach the server unless you add it explicitly under `env` in the client config:

```json
{
  "mcpServers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"],
      "env": { "AWS_PROFILE": "my-profile", "AWS_REGION": "eu-west-1" }
    }
  }
}
```

(Same `env` key under VS Code's `servers.cloudrift`; for Claude Code, add `"type": "stdio"` alongside it, or pass `--env AWS_PROFILE=my-profile --env AWS_REGION=eu-west-1` to `claude mcp add`.)

A silent symptom of missing this: every tool call succeeds, but `analyze_cloudrift` returns an empty report — no error, because a per-region scan failure is caught and surfaced as `scanErrors`/`domainErrors`, not a crash. If findings look emptier than expected, check `env` before anything else.
