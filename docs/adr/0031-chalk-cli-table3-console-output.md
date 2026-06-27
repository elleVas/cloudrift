# ADR-0031: chalk + cli-table3 for console output

- **Status:** Accepted

## Context

Terminal output needs colors and aligned tables, plus a clean machine-readable mode for piping.

## Decision

`chalk` for colors (automatic color-support detection), `cli-table3` for aligned, readable tables. `--format json` (not `--json`, which is a file artifact — see [analyze-waste.command.ts](../../apps/cli/src/commands/analyze-waste.command.ts)) suppresses table output entirely to keep stdout clean for piping.

## Alternatives Considered

- **A custom ANSI/table formatter.** Rejected: chalk and cli-table3 already handle color-support detection and column alignment correctly across terminals; reimplementing this buys nothing.

## Consequences

`--format json` to stdout is safely pipeable into other tools. The file-output flags (`--json`/`--pdf`) are independent of `--format` and by default coexist with a printed table view; `--silent` (added later) suppresses that printed view for file-only runs.
