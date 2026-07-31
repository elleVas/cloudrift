# Releasing `@cloudrift/cli`

> 🇮🇹 [Versione italiana](../it/rilascio.md)

This document describes how the npm package is built and published. It is for maintainers — users only need the [README](../../README.md#quick-start).

## What gets published

The CLI is published to npm as **`@cloudrift/cli`** (the installed command is `cloudrift`). The package is **bundled**: esbuild inlines the workspace libraries (`shared-kernel`, `cloud-cost-*`) into a single `main.js`, while third-party packages (AWS SDK, pdfkit, chalk, commander, cli-table3) stay external. The published tarball therefore contains only:

```
main.js          # the bundled, executable CLI (with the #!/usr/bin/env node shebang)
package.json     # generated: declares only the third-party runtime deps
README.md
LICENSE.md
```

`apps/cli/package.json` is the **development** manifest (workspace deps, nx targets, npm metadata). The **published** manifest is generated into `apps/cli/dist/package.json` by `apps/cli/scripts/make-dist-package.mjs`, which reads the actual external `require()`s from the bundle — so it self-maintains when new SDKs are added.

## One-time setup

1. Create the **`@cloudrift` org** on npm (the scope must exist and you must own it).
2. Generate an npm **automation token** and add it to the GitHub repository as the secret **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).

The release workflow uses `--provenance`, which requires `id-token: write` (already set in [`release.yml`](../../.github/workflows/release.yml)) and a public repository.

## Cutting a release

1. Bump the version in `apps/cli/package.json` — `apps/cli/src/cli-version.ts` re-exports it at build time (`require('../package.json').version`), so `main.ts`'s `--version` output always matches without a second edit.
2. Merge to `main`.
3. Tag and push:

   ```sh
   git tag v0.3.0          # must equal the @cloudrift/cli version
   git push origin v0.3.0
   ```

The [release workflow](../../.github/workflows/release.yml) then, on the `v*` tag:

1. verifies the tag matches the package version,
2. runs lint + test across the workspace,
3. `pnpm nx package cli` (build + generate `dist/package.json`),
4. generates a CycloneDX and an SPDX SBOM via `npm sbom` (run from `apps/cli/dist`, so it reflects only the published tarball's runtime deps, not the monorepo's `nx`/`eslint`/etc. — `npm sbom` reads the installed dependency tree, not just `package.json`, so this step runs a plain `npm install` in `apps/cli/dist` first; harmless, since `npm publish` never includes `node_modules` regardless of what's on disk),
5. `npm publish --provenance` from `apps/cli/dist` (using `NPM_TOKEN`),
6. creates a GitHub Release with auto-generated notes and attaches both SBOM files to it.

## Verify locally before tagging

```sh
pnpm nx package cli                      # builds + generates apps/cli/dist/package.json
cd apps/cli/dist && npm pack --dry-run   # inspect the exact tarball contents
```

To smoke-test the published artifact end-to-end:

```sh
cd apps/cli/dist
npm pack                                 # produces cloudrift-cli-<version>.tgz
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install /absolute/path/to/cloudrift-cli-<version>.tgz
npx cloudrift --version                  # must print the new version
```

## Node compatibility

The package targets **Node 20+** (`engines`). The bundle is CommonJS, so every external dependency must be `require()`-able: this is why `chalk` is pinned to **v4** (v5 is ESM-only and would throw `ERR_REQUIRE_ESM` on Node < 22). CI only ever builds/publishes on Node 24.x — the `>=20` floor is a stated minimum, not one exercised by a dedicated CI job; bump it (or add a Node 20 test job) if that gap ever matters.

## GitHub Action

[`action.yml`](../../action.yml) at the repo root is a composite action that installs `@cloudrift/cli` from npm and runs `cloudrift analyze`, so `uses: elleVas/cloudrift@v<version>` only works once the referenced version is actually published to npm (same gate as everything else in this document). After a release, sanity-check it with a `workflow_dispatch` run in a scratch workflow before pointing real consumers at the new tag — nothing in CI exercises `action.yml` today.

## Homebrew

The tap lives in a **separate** repository, `elleVas/homebrew-cloudrift` (Homebrew's naming convention — a formula cannot live in this repo and be installable via `brew install elleVas/cloudrift/cloudrift`). The formula uses Homebrew's `Language::Node` npm-install pattern: `depends_on "node"`, `def install; system "npm", "install", *std_npm_args; bin.install_symlink Dir["#{libexec}/bin/*"]; end` (the symlink step is required — `std_npm_args` alone installs into `libexec` but doesn't link the binary into `bin`), `url` pointing at the published npm tarball (`https://registry.npmjs.org/@cloudrift/cli/-/cli-<version>.tgz`) with its `sha256`. On top of that the formula carries a `bottle do ... end` block (see below), so a plain `brew install cloudrift` downloads a precompiled bottle instead of running `npm install`/needing Xcode Command Line Tools on the user's machine.

**The tap is bumped automatically, in three stages, all inside `release.yml`:**

1. **`publish` job** — after `npm publish`, runs `scripts/bump-homebrew-formula.mjs`, which downloads the npm tarball just published (retrying for a few minutes if the registry hasn't propagated it yet — see the note below), computes its `sha256`, and writes a "bare" `Formula/cloudrift.rb` (url/sha256/version, no bottle block yet) as a build artifact. If the bare formula is identical to what's already on the tap's `main` (e.g. a re-run of the same tag), the pipeline stops here — no bottles get built for nothing.
2. **`build-bottles` job** — a matrix of `macos-14` (arm64) and `ubuntu-latest` (Linux/Linuxbrew), one per bottle platform. Deliberately **no Intel (`macos-13`) leg**: cloudrift has no native/compiled dependencies (pure Node, `node:sqlite` for the trend store), so an Intel Mac with no bottle just falls back to Homebrew's normal source-install path — the same `npm install` the formula already runs, just done locally. `macos-13` runners are the scarcest GitHub-hosted pool and have been observed queuing for a long time; there's no upside to a bottle build for a fallback that already works. Each leg's shared steps live in `.github/actions/build-homebrew-bottle` (a composite action) and: taps the bare formula locally (`brew tap elleVas/cloudrift "$PWD"` + `brew trust ellevas/cloudrift` — Linux runners get Homebrew installed first, since only the macOS images ship it), runs `brew install --formula --build-bottle cloudrift`, then `brew bottle --json --root-url=.../releases/download/cloudrift-<version> cloudrift` and uploads the resulting `.bottle.tar.gz`/`.bottle.json`.
3. **`publish-bottles` job** — downloads both bottle artifacts, runs `brew bottle --merge --write --no-commit *.bottle.json` to fold both platforms' `sha256` lines into one `bottle do` block, publishes the tarballs as assets on a `cloudrift-<version>` GitHub Release **in the tap repo** (the bottle block's `root_url`), then pushes the fully-bottled formula to a branch, opens a PR, and enables auto-merge.

**Two non-obvious steps exist only to work around how `brew tap` behaves against a local path** — skipping either silently ships a broken or stale bottle:
- **Commit the overwritten formula locally before tapping** (never pushed — just a local `git commit`). `brew tap NAME "$PWD"` performs a real `git clone` of the checkout, which only ever sees *committed* history. Without this, both `build-bottles` and `publish-bottles` would silently clone the tap's *previous* release formula instead of the one being published — confirmed in production: a bottle built this way reported `pkg_version` one release behind the tag it claimed to be.
- **Copy the bottled formula back from brew's own tap clone.** `brew bottle --merge --write` edits the formula inside `$(brew --repository elleVas/cloudrift)` — a separate directory under Homebrew's `Library/Taps`, not the job's own checkout. Without copying it back into the checkout before `git add`/commit/push, the PR only ever carries the bare (bottle-less) formula. This is exactly what happened on the very first real run (v0.8.0): the merged tap formula shipped with **no bottle block at all**, silently, despite the pipeline reporting success.

The tap repo's own CI (`.github/workflows/test-formula.yml`) then runs `brew audit --strict --online` + `brew install --build-from-source` + `brew test` on the PR (deliberately still a from-source install — it's a formula-correctness check, not a test of the bottle path); branch protection on the tap's `main` requires that check to pass before the PR can merge. So one `git push --tags` here ends up publishing to npm and to Homebrew (bottled for arm64 + Linux), with the Homebrew side gated on both a real `brew install` from source **and** both bottle builds succeeding.

**Not yet verified against a real release** — the two fixes above (2026-07-31) were validated by reproducing the `brew tap`/clone behavior locally against a synthetic tap, not by an actual tag push. The first real tagged release after this is the true test: confirm the tap PR carries a genuine `bottle do` block, and that the bottle's own `pkg_version`/`tap_git_revision` metadata matches the tag, not the prior release — a green workflow run alone doesn't prove that (see the [Homebrew tap automation] project notes).

### One-time setup (already done for the current tap, kept here for reference)

- The tap repo itself: `gh repo create elleVas/homebrew-cloudrift --public`, `Formula/cloudrift.rb` + `test-formula.yml` scaffolded, `allow_auto_merge` enabled, branch protection on `main` requiring the `audit` check.
- **`HOMEBREW_TAP_TOKEN`**: a fine-grained GitHub PAT scoped to `elleVas/homebrew-cloudrift` only, with **Contents: Read & write** and **Pull requests: Read & write** permissions, added as a secret named `HOMEBREW_TAP_TOKEN` on **this** repo (`elleVas/cloudrift` → Settings → Secrets and variables → Actions). Without it, the "Generate bare Homebrew formula" step logs a warning and skips — it never fails the npm release. The same permissions also cover creating the bottle Release and pushing the final PR branch, no extra scopes needed.

### Registry propagation

npm can take a few minutes to make a freshly published tarball fetchable (up to ~6 minutes was observed on the first public release) — `bump-homebrew-formula.mjs` retries every 30s for up to ~10 minutes before giving up, so this is normally invisible.
