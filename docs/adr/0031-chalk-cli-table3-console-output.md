# ADR-0031: chalk + cli-table3 for console output

- **Status:** Accepted

## Context

Terminal output needs colors and aligned tables, plus a clean machine-readable mode for piping.

## Decision

`chalk` for colors (automatic color-support detection), `cli-table3` for aligned, readable tables. With `--json` and no output filename, table output is suppressed entirely to keep stdout clean for piping.

## Alternatives Considered

- **A custom ANSI/table formatter.** Rejected: chalk and cli-table3 already handle color-support detection and column alignment correctly across terminals; reimplementing this buys nothing.

## Consequences

`--json` to stdout is safely pipeable into other tools. Only the file-output path (`--json --output report.json`) coexists with a printed table view.
</content>
