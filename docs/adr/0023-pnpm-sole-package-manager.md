# ADR-0023: pnpm as the sole package manager

- **Status:** Accepted

## Context

Needed consistent installs across contributors and CI, with explicit workspace membership.

## Decision

pnpm only. A single `pnpm-lock.yaml` is committed. Internal library dependencies use `"cloud-cost-domain": "workspace:*"`, resolved via symlinks. `pnpm-workspace.yaml` explicitly lists which folders are workspace packages.

## Alternatives Considered

- **npm or yarn.** Rejected: pnpm's hard-link store gives faster installs and less disk usage, and explicit workspace membership is preferable to npm/yarn's more implicit workspace inference.

## Consequences

Lockfiles from other package managers (`package-lock.json`, `yarn.lock`) must never be committed. All tooling and CI scripts must invoke pnpm specifically.
</content>
