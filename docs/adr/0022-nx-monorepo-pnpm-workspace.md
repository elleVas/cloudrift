# ADR-0022: Nx monorepo + pnpm workspace

- **Status:** Accepted

## Context

Multiple bounded-context libraries (`shared-kernel`, `cloud-cost/domain`, `cloud-cost/application`, `cloud-cost/infrastructure/aws-adapter`) need to be shared across `apps/cli` without publishing internally to npm.

## Decision

Single Nx repository with a pnpm workspace. Nx targets (`build`, `test`, `typecheck`, `lint`) run only on modified projects via `nx affected`; local (optionally Nx Cloud) caching avoids re-running expensive operations.

## Alternatives Considered

- **Separate npm-published packages per library.** Rejected: publishing overhead for code that only this one CLI consumes — no external consumers exist.
- **Turborepo or Lerna instead of Nx.** Rejected: no concrete advantage found for this project's needs; Nx's affected-graph and generator ecosystem fit a layered DDD structure at least as well.
- **Plain multi-package repo with no task runner.** Rejected: would lose `nx affected` and caching, both already paying off with 18 scanners and four library layers.

## Consequences

Initial Nx configuration complexity is higher than a single project, but pays off once there are more than two libraries to orchestrate — already true here.
