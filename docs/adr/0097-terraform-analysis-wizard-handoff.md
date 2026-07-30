# ADR-0097: Wizard mode delegating to the separate `cloudrift-iac-detector` Pro package

- **Status:** Accepted (2026-07-30)

## Context

`cloudrift-iac-detector` is a separate, proprietary repository (Terraform-source waste analysis, drift/zombie detection — a paid Pro add-on) with no code-sharing relationship to this repo: this repo is public/Apache-2.0, that one is entirely private/commercially licensed. It ships as its own npm package/binary and, as of its own ADR-0031, has just grown a bare-invocation wizard mirroring this repo's (ADR-0071/0041).

The ask: give this wizard's mode picker a dedicated entry for Terraform source analysis, so a user discovering it here doesn't need to already know the separate product exists. Three shapes were discussed with the user and **full delegation** was chosen:

1. **Full delegation (chosen):** detect the `cloudrift-iac-detector` binary on `PATH`; if present, hand off the terminal to it entirely (its own wizard takes over). Zero coupling — every command that package adds later works here automatically, no matching PR ever needed in this repo.
2. Flag forwarding: this wizard asks Terraform-specific questions itself and calls the other CLI with specific flags. Rejected — would make this public repo's wizard know the private CLI's exact flag surface, needing a PR here for every future command over there.
3. Informational entry only, no execution. Rejected — too weak on its own; the user wants a working handoff, not just a pointer.

Neither package can import the other's code: this repo can never depend on proprietary code (nothing here can require a private package to build), and the Pro package can't be embedded here without ceasing to be separately licensed. Process-level delegation (detect-on-PATH, then spawn with inherited stdio) is the same seam `git` (`git-<subcommand>` executables), `docker` (CLI plugins), and `kubectl` (plugins) use at an identical OSS/commercial-extension boundary.

## Decision

New `WizardMode` value `'terraform'` in `mode-picker.wizard.ts`: *"Terraform source analysis"*, hinted `Pro — separate cloudrift-iac-detector package: orphans, duplicates, dead code, auto-fix"` right in the option, so the boundary is visible before it's picked (same convention as the existing Cost Explorer hints on `cost`/`trend`).

New `terraform-handoff.wizard.ts`:

- **`resolveCloudriftIacDetectorBinary()`** — resolves the binary on `PATH` the same way a shell would: walks `process.env.PATH`'s directories, checking for `cloudrift-iac-detector` (plus `.cmd`/`.exe`/`.bat` on Windows via `PATHEXT`-equivalent extensions). No registry/package-manager lookup — presence-on-PATH is the only signal this repo can ever have about the other product's installation state.
- **`playHandoffTransition()`** — a short (~2.2s) retro loading-bar animation (`█`/`░` blocks, cycling colors via the existing `chalk` dependency, `\r` in-place redraw) between picking the mode and the actual handoff. Purely cosmetic: makes an otherwise-instant process handoff read as an intentional transition between two products rather than a stall or a glitch.
- **`delegateToCloudriftIacDetector(binaryPath)`** — `child_process.spawn(binaryPath, [], { stdio: 'inherit' })`, resolving with the child's real exit code once it closes. Inherited stdio means the Pro CLI's own wizard (or any output) takes over the terminal exactly as if the user had run it directly — this repo does not parse or reformat anything it prints.

`entry.wizard.ts`: `mode === 'terraform'` resolves the binary; if missing, prints a short message pointing at the user's Pro license for installation instructions (no invented URL — this repo has no visibility into how that package is actually distributed) and returns to a clean exit, same "no partial action" discipline as every other cancel path. If found, plays the transition, delegates, and propagates the child's exit code as `process.exitCode` — a failure inside the Pro CLI surfaces the same way any other command failure here would.

Verified end-to-end with a fake `cloudrift-iac-detector` script on `PATH` (temporary, not committed): confirmed `resolveCloudriftIacDetectorBinary()` finds it and returns `undefined` when absent, and `delegateToCloudriftIacDetector()` correctly propagates a non-zero exit code from the spawned process. `playHandoffTransition()` (pure animation, no logic) and the `entry.wizard.ts`/`mode-picker.wizard.ts` wiring are left untested, consistent with this repo's standing choice not to unit-test `wizard/*.wizard.ts` files (thin prompt-orchestration UI, no branching logic of its own beyond what's already covered by the functions it calls).

## Alternatives Considered

- **Publish a shared "wizard extension" plugin protocol** (e.g. scan `node_modules` for packages matching a naming convention, like ESLint/Babel plugin discovery) instead of hardcoding one `PATH` check. Rejected for now — over-engineered for a single known integration; nothing today needs a second Pro package to plug into this wizard, and a real plugin contract is easy to extract later from this concrete instance if that need appears (YAGNI).
- **A private npm registry dependency** (this repo installs `cloudrift-iac-detector` as an npm dependency, auth-gated). Rejected — every free/OSS user would need registry credentials just to `npm install` this repo, or the dependency would need to be optional with awkward fallback handling; process delegation avoids that entirely.

## Consequences

This repo's wizard now has one mode (`terraform`) whose successful path never touches this repo's own command functions or AWS/Cost-Explorer code at all — it's a pure handoff. Any future second Pro/commercial extension would follow the exact same `resolve → transition → delegate` shape; if a second one actually materializes, that's the trigger to reconsider the plugin-discovery alternative above rather than hand-writing a third near-identical `*-handoff.wizard.ts`.

Adding this sixth mode pushed `runEntryWizard()`'s original single-function if-chain (one branch per mode, ADR-0071) past the point of being easy to scan in one pass. Refactored in the same PR into a flat `switch (mode)` dispatcher plus one `run<Mode>Mode()` function per branch (`runWasteMode`, `runDeadResourcesMode`, `runResourceSecurityMode`, `runTerraformMode`, `runCostTrendMode`) — same behavior, verified against the same end-to-end pty smoke test used above, just no longer one function growing a branch per mode indefinitely.
