# ADR-0061: `pdfkit` loaded via lazy dynamic import; publish-manifest generator scans for dynamic imports too

- **Status:** Accepted (2026-07-10)

## Context

`pdfkit` (~2MB with its bundled fonts) was a static top-level import in `waste-report.pdf-formatter.ts`, paying its module-init cost (font loading/registration) on every CLI invocation even though only runs passing `--pdf` need it — roughly 1% of real usage.

While fixing this, a real pre-existing bug surfaced: `apps/cli/scripts/make-dist-package.mjs` (generates the npm publish manifest) derives the CLI's external runtime dependencies by scanning the built bundle for literal `require(...)` calls only. `@clack/prompts` has been loaded via dynamic `import()` since [ADR-0041](0041-interactive-scanner-selection-wizard.md) (2026-07-07) specifically to keep it out of Jest's static module graph — but a dynamic `import()` never produces a `require(...)` call in the bundle, so it was never detected. `@clack/prompts` has been **silently missing** from the generated publish manifest's `dependencies` since ADR-0041 landed. Confirmed via `npm view @cloudrift/cli` (404 — never published) that no real user has been affected yet, but the next `pdfkit` dynamic import would have repeated the exact same gap, and the package would ship broken (`Cannot find module`) for both the wizard and PDF generation the first time it's actually published.

## Decision

`generateWasteReportPdf` (`apps/cli/src/formatters/waste-report.pdf-formatter.ts`) is now `async` and does `const { default: PDFDocument } = await import('pdfkit')` internally, mirroring the existing `@clack/prompts` pattern. `PDFKit.PDFDocument` — the *type*, used throughout the file for function signatures — needed no changes: it's an ambient global namespace declared by `@types/pdfkit`, independent of the value import.

`make-dist-package.mjs`'s external-detection regex changed from `/require\(["']([^"']+)["']\)/g` to `/\b(?:require|import)\(["']([^"']+)["']\)/g`, so a package reachable only via dynamic import is now also captured. Regenerated `dist/package.json` and confirmed both `@clack/prompts` and `pdfkit` now appear among the 28 declared runtime dependencies (was 26, silently missing both this whole time for `@clack/prompts`).

## Alternatives Considered

- **Leave `pdfkit` as a static import, since `apps/cli` already treats it as an external `require()` regardless (`thirdParty: false` — it was never inlined into bundle size to begin with).** Rejected: the review's "bundle size" framing was inaccurate (corrected in `docs/code-review-2026-07-10.md`), but the *init-time* cost (font loading on every invocation) is real and independent of bundle size — lazy loading still has a genuine, if smaller, benefit.
- **Manually add `@clack/prompts` and `pdfkit` to `make-dist-package.mjs`'s output as a hardcoded exception list.** Rejected: fixes the two known cases but not the underlying gap — any future dynamic import would repeat the same silent failure. Fixing the detection regex is the same amount of work and closes the class of bug, not just the two known instances.

## Consequences

No test harness exists for `make-dist-package.mjs` (there wasn't one before this fix either); verified manually by re-running it and inspecting the generated `dependencies`. `waste-report.pdf-formatter.spec.ts` (ADR-0055) already exercises `generateWasteReportPdf` end-to-end against the real (non-mocked) `pdfkit`, so its async conversion is covered by existing tests: 65/65 cli tests pass, typecheck/lint clean, `nx run cli:build` succeeds. See `docs/code-review-2026-07-10.md`, "Cose minori ma fastidiose."
