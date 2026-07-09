# ADR-0049: `AwsAdapterError` extends `InfrastructureError`, not `DomainError`

- **Status:** Accepted (2026-07-09)

## Context

`AwsAdapterError` (thrown/wrapped by every scanner when an AWS SDK call fails) extended `DomainError`, the shared-kernel base class for domain-layer errors. This was a layer violation in the direction the architecture otherwise guards against: the domain is not supposed to know anything about AWS, but the *name* of the error type flowing back through `WasteScannerPort.scan(): Promise<Result<WastedResource[]>>` implied a domain-level classification for a failure that is purely infrastructural (a network call, a permissions error, a throttling response).

## Decision

New `InfrastructureError` in `libs/shared/kernel/src/errors/infrastructure.error.ts` — a sibling hierarchy to `DomainError`, not a subclass of it, with the same shape (`code` + `message`). `AwsAdapterError` now extends `InfrastructureError`.

```typescript
export abstract class InfrastructureError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

## Alternatives Considered

- **Have `AwsAdapterError` implement `Error` directly, no shared base class.** Rejected: would lose the `code` + typed-`message` shape that `DomainError` already established as the project's error convention, forcing `AwsAdapterError` to reinvent it ad hoc instead of following the existing pattern via a sibling class.
- **Keep `AwsAdapterError extends DomainError`, treat it as acceptable pragmatism.** Rejected: `Result<T, E extends Error>` is typed on the bare `Error` class, not `DomainError` — nothing in the codebase actually depended on the `DomainError` parent, so there was no compatibility reason to keep the misclassification, only inertia.

## Consequences

Zero call sites depended on `AwsAdapterError` specifically being a `DomainError` (confirmed by grep before the change — `Result<T, E extends Error>`'s bound is `Error`, not `DomainError`), so the change is purely a reclassification with no behavioral or type-signature ripple elsewhere. New `infrastructure.error.spec.ts`. The domain/infrastructure error hierarchies are now genuinely separate, matching the layering the rest of the architecture (ADR-0013) already enforces.
