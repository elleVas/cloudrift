# ADR-0024: `module: ESNext` + `moduleResolution: bundler`, no extensions in relative imports

- **Status:** Accepted

## Context

Cross-package imports and a bundled CLI executable both needed to work without forcing `.js` extensions on every relative import throughout the codebase.

## Decision

`"module": "ESNext"` and `"moduleResolution": "bundler"` in `tsconfig.base.json`, allowing extension-less relative imports (`'./entity.base'`, never `'./entity.base.js'`). Cross-package imports use the package name, resolved during development via the custom `@cloudrift/source` condition in each package's `exports` field. The CLI is built with esbuild (`bundle: true`, `thirdParty: false`): workspace library code is inlined (esbuild resolves extension-less imports), while npm packages (AWS SDK, pdfkit, chalk, commander) remain external `require()`s. Tests use a separate `tsconfig.spec.json` with `"module": "CommonJS"` / `"moduleResolution": "Node"` because jest runs in CJS.

## Alternatives Considered

- **`moduleResolution: NodeNext` with mandatory `.js` extensions on relative imports.** Rejected: noisier imports throughout the codebase for no real benefit, since the CLI is bundled anyway and never consumes the raw `tsc` output directly.
- **Ship libraries' raw `tsc` output and run it directly with Node.** Rejected: extension-less imports from `tsc` output aren't loadable by Node's pure ESM resolver — would require either emitting extensions everywhere or adding a dedicated build step, for no benefit over the esbuild-bundling approach already in place.

## Consequences

`node apps/cli/dist/main.js` works with zero extra steps after build. If the libraries ever need to be consumed directly as ESM by Node outside a bundler, extensions will have to be emitted or a dedicated build step added — not needed today.
</content>
