// SPDX-License-Identifier: Apache-2.0
/**
 * A plain `require` call, not an `import`: a static JSON `import` makes
 * TypeScript's project-reference resolver add package.json to this
 * project's file list, which trips the esbuild executor's embedded
 * type-check (TS6307) under this workspace's `composite: true` setup —
 * `tsc --build` alone accepts it, but Nx's esbuild wrapper always forces
 * that check on for composite projects, so the build fails regardless. A
 * `require` call isn't tracked as a module dependency by the type checker,
 * so it sidesteps that check, while esbuild still resolves and inlines it
 * as a build-time literal (same as it would a JSON `import`).
 */
const packageJson = require('../package.json') as { version: string };

export const cliVersion = packageJson.version;
