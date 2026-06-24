# ADR-0032: pdfkit for PDF report generation

- **Status:** Accepted

## Context

`--pdf` needs to produce a real PDF report without bloating install size or adding a native/binary dependency.

## Decision

`pdfkit`, a pure-Node.js library: no headless browser, no binary dependency, stream-based writes to `fs.createWriteStream` without buffering the whole PDF in memory. A custom `drawTable` implements page breaks (closes the segment border, opens a new page, redraws the header) and truncates overly long cells with an ellipsis.

## Alternatives Considered

- **Puppeteer/Playwright + HTML→PDF.** Rejected: drags in a headless Chromium (~300 MB), heavy for what is an optional CLI feature.
- **A native binary (e.g. wkhtmltopdf).** Rejected: adds a binary dependency and installation step, against the "just works after `node main.js`" goal ([ADR-0024](0024-esnext-bundler-resolution.md)).

## Consequences

PDF generation uses a low-level, verbose-but-predictable API (manual layout, page-break logic). Clickable links needed a specific workaround — see [ADR-0034](0034-pdfkit-link-linebreak-bug.md).
