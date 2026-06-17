# Releasing `@cloudrift/cli`

> 🇮🇹 [Versione italiana](../it/rilascio.md)

This document describes how the npm package is built and published. It is for maintainers — users only need the [README](../../README.md#install).

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

1. Bump the version in `apps/cli/package.json` **and** the `.version(...)` string in `apps/cli/src/main.ts` (they must match; the workflow fails otherwise).
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
4. `npm publish --provenance` from `apps/cli/dist` (using `NPM_TOKEN`),
5. creates a GitHub Release with auto-generated notes.

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

The package targets **Node 18+** (`engines`). The bundle is CommonJS, so every external dependency must be `require()`-able: this is why `chalk` is pinned to **v4** (v5 is ESM-only and would throw `ERR_REQUIRE_ESM` on Node < 22).
