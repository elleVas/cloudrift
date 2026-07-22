# ADR-0071: Bare `cloudrift` (no subcommand, real terminal) launches a unified mode-picker wizard

- **Status:** Accepted (2026-07-22)

## Context

Before this, `cloudrift` with no subcommand fell through to Commander's default behavior (print help, exit 1) — same as any misuse. Meanwhile the project had grown three separate entry points (`analyze`, and the new `cost`/`trend`, [ADR-0069](0069-cost-explorer-integration-billed-api-confirmation.md)), each requiring the user to already know which subcommand and which flags they want. With a public npm release imminent, the ask was explicit: a first-time user typing just `cloudrift` should be walked through a choice, not shown a help screen.

## Decision

`process.argv.length === 2 && isInteractiveTty()` (`apps/cli/src/main.ts`) — no subcommand, no flags, a real interactive terminal — hands off to `runEntryWizard()` (`apps/cli/src/wizard/entry.wizard.ts`) instead of Commander's `parseAsync`. Any explicit subcommand, any flag (including bare `-h`/`--version`), CI, or a non-TTY stdout all fall through to normal Commander parsing, completely unaffected — **zero breaking change** for scripted/CI usage, which remains the flag-driven interface.

The wizard is a pure input-gathering layer, never a second implementation of command logic: it calls the exact same `analyzeWasteCommand`/`costCommand`/`trendCommand` functions the CLI flags drive, just with options gathered interactively instead of parsed from `argv`. The flow:

1. `promptMode()` (`mode-picker.wizard.ts`) — a top-level `select`: "Find wasted resources" (free) / "Compare spend vs. last month" / "View monthly spend trend" (last two hinted `Cost Explorer — $0.01/request` right in the option, so the cost is visible before the later confirmation prompt fires). Structured as an open list rather than a fixed if/else specifically so a future fourth mode (the planned dead/unused-resources domain) is just another entry, not a wizard rewrite.
2. For `waste`: region autocomplete ([below](#region-picker-autocompletemultiselect-instead-of-free-text)) → the pre-existing scanner-selection wizard ([ADR-0041](0041-interactive-scanner-selection-wizard.md), reused as-is) → output-format prompt (format + optional PDF/JSON save) → `analyzeWasteCommand(...)`.
3. For `cost`/`trend`: a simpler output-format prompt (format only — no regions, since Cost Explorer is a single global endpoint; see [ADR-0069](0069-cost-explorer-integration-billed-api-confirmation.md)) → the respective command function, which independently re-confirms the Cost Explorer charge itself (the wizard doesn't special-case this — the confirmation lives in the command, protecting every call path uniformly).

Cancelling (Ctrl+C) at any step returns `undefined` up the chain and the wizard exits cleanly with no partial action — no scan starts, no charge is made.

### Region picker: `autocompleteMultiselect` instead of free text

`promptRegions()` (`region-input.wizard.ts`) uses `@clack/prompts`' `autocompleteMultiselect` over the full `AWS_REGION_CODES` list (newly exported from `aws-region.value-object.ts`, previously a private `Set` only `AwsRegion.parse` could see) instead of a free-text field validated after the fact. Typing `us-eas` live-filters to `us-east-1`/`us-east-2`; a typo narrows the list instead of failing validation and forcing the whole wizard to restart.

## Alternatives Considered

- **Free-text region input with post-hoc validation (`AwsRegion.parse`).** Rejected: a typo means restarting the entire wizard from the top, an outsized cost for a picker whose only job is picking from a known, small, static list of valid AWS region codes — a list the domain layer already owns.
- **Duplicate command logic inside the wizard for a more tailored interactive flow.** Rejected: would immediately create two implementations of "run a waste scan" or "compare cost" to keep in sync. Calling the existing command functions directly means every future flag/behavior change to `analyze`/`cost`/`trend` is automatically reflected in the wizard with no wizard-specific update.
- **Opt-in `cloudrift wizard` subcommand instead of a bare-invocation default.** Rejected: the explicit ask was for the interactive experience to be what a first-time user sees by default, with flags as the "power user / CI" channel — matching the same default-on philosophy already established for the scanner-selection wizard ([ADR-0041](0041-interactive-scanner-selection-wizard.md)).

## Consequences

`cloudrift` (no args, real terminal) and `cloudrift analyze`/`cost`/`trend` (with flags) are now two front doors to the same three command functions, kept in sync by construction rather than by discipline. `AWS_REGION_CODES` is a new public export of `cloud-cost-domain` — any future consumer needing the canonical region list (not just this wizard) has one source of truth instead of a private, wizard-local copy.
