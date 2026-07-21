# Development

> 🇮🇹 [Versione italiana](../it/sviluppo.md)

Watch mode, per-library tests, lint, typecheck.

```sh
# Start CLI in watch mode (auto-rebuild on change)
pnpm nx serve cli

# Run all tests
pnpm nx run-many -t test

# Run a single library's tests
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

Diagnostic logging is opt-in via `DEBUG=cloudrift:*` (e.g. `DEBUG=cloudrift:* cloudrift analyze ...`), off by default. It writes to stderr, separate from the report itself — but its output includes AWS resource IDs (volume IDs, instance IDs, etc.) from your account. Don't paste `DEBUG` output into a public GitHub issue or share it outside your organization without checking it first.
