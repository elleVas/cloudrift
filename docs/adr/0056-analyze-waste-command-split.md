# ADR-0056: `analyze-waste.command.ts` split into option-resolution and post-analysis modules

- **Status:** Accepted (2026-07-10)

## Context

`analyze-waste.command.ts` had grown to 317 lines doing option resolution, config loading, wizard invocation, use-case invocation, artifact writing, and cost-gate enforcement — one file doing every step of the command end to end. Each new flag (`--pdf`, `--json`, `--silent`, `--scanners`, the wizard) added roughly 20 lines to the same file with no natural seam, the same "God Function" shape the composition root had before its own split (`docs/REVIEW.md` #1).

## Decision

Extracted two new modules, split by phase (not by concern):

- `apps/cli/src/commands/resolve-options.ts` — `resolveMinAgeDays`, `resolveExplicitScanners`, `resolveRegions`.
- `apps/cli/src/commands/post-analysis.ts` — `writeArtifacts`, `applyCostGate`.

`analyze-waste.command.ts` dropped from 317 to 187 lines: `fail()`, the `AnalyzeWasteOptions` interface, and `analyzeWasteCommand()` as a sequence of calls into the two new modules remain. Zero behavior change — a mechanical move, verified via grep that none of the moved functions were imported anywhere outside this file before moving them. `AnalyzeWasteOptions` stays defined in the command file; the two new files import it via `import type` (a type-only cycle, erased at runtime — the same pattern already accepted for `pricing.factory.ts`).

## Alternatives Considered

Three options were presented to the user before implementing (per this project's rule of surfacing real architectural choices):

- **3-file split by concern** (options / config+wizard / output). Rejected: anticipates growth (e.g. a future `--slack-webhook`) that hasn't arrived yet — no concrete benefit today.
- **Minimal option-resolution-only split**, leaving post-analysis in the command file. Rejected: leaves the file still doing too much; doesn't address the underlying growth trend.
- **2-file split by phase** (chosen). Matches the review's own suggestion and the precedent already set by the composition-root split.

## Consequences

60/60 cli tests passed unchanged at the time (identical behavior, no spec touched), typecheck/lint/build clean. See `docs/code-review-2026-07-10.md` §1.
