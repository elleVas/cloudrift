# ADR-0041: Interactive scanner-selection wizard, triggered by default

- **Status:** Accepted (2026-07-07)

## Context

`cloudrift analyze` always ran every registered scanner; there was no way to target a subset of services short of editing config thresholds. Backlog item raised 2026-06-27: let the user pick which AWS services to scan.

## Decision

Show an interactive multi-select wizard by default when `analyze` runs in a real terminal (`process.stdout.isTTY`) outside CI (`CI !== 'true'`) and without `--silent`. Every service starts checked, so pressing Enter immediately reproduces the previous scan-everything behavior; the user deselects what they don't want.

Two explicit escape hatches skip the wizard entirely, for scripted/CI use even from a terminal:

- `--scanners <kinds...>` — an explicit list of `ResourceKind`s, validated against `RESOURCE_KINDS` (unknown values fail fast with the full valid list).
- `--all-services` — run every scanner, no prompt.

Outside a TTY, in CI, or under `--silent`, the wizard never appears and every scanner runs — the default is unchanged from before this feature, and automation is never blocked waiting on input.

Library: `@clack/prompts`' `multiselect`, loaded via a dynamic `import()` inside `promptScannerSelection()` (`apps/cli/src/wizard/scanner-selection.wizard.ts`), not a static import — the package is ESM-only and a static import broke `cli:test` (Jest cannot parse it by default without extra config). The wizard's checkbox list is generated from the existing `RESOURCE_KINDS`/`RESOURCE_KIND_META` registries, so it requires no maintenance when a new scanner is added (see [adding-a-resource.md](../en/adding-a-resource.md)).

The resolved kind list flows into `AnalysisContext.scannerKinds` (`analyze-waste.composition.ts`); `defaultCreateAnalysis` filters the built scanner list by `scanner.kind` when present, `undefined` meaning "no filter, run all".

## Alternatives Considered

- **Opt-in `--interactive` flag instead of a default trigger.** Rejected: the ask was for scanner selection to be the normal experience, not something a user has to discover and enable.
- **`inquirer` instead of `@clack/prompts`.** Rejected: heavier, and `@clack/prompts` has a native checkbox multiselect that fits this exact need.
- **Static top-level import of `@clack/prompts`.** Rejected: broke `cli:test` under Jest (ESM-only package). Dynamic `import()` inside the (TTY-only) interactive path avoids the problem entirely and keeps the module load out of every non-interactive invocation.
- **Blocking indefinitely outside a TTY.** Rejected: would break CI and any scripted/piped invocation. Non-TTY/CI always defaults to running everything, matching pre-existing behavior.

## Consequences

`@clack/prompts` becomes a new runtime dependency of `apps/cli` (declared there, not at the workspace root, since `apps/cli`'s esbuild build has `thirdParty: false` and `apps/cli/scripts/make-dist-package.mjs` resolves external package versions from `apps/cli/package.json` first). Any future new `ResourceKind` automatically appears in the wizard's checkbox list with no wizard-specific code to update.
