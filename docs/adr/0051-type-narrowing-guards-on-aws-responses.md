# ADR-0051: Type-narrowing filters replace non-null assertions on AWS SDK response fields

- **Status:** Accepted (2026-07-09)

## Context

Scanners read required fields off AWS SDK response objects with a non-null assertion — `v.VolumeId!`, `gw.NatGatewayId!`, `inst.InstanceId!` — because the AWS SDK's generated TypeScript types mark nearly every response field optional (a defensive/forward-compatibility choice in the SDK's own code generation, not a signal that the field is often actually absent). A non-null assertion is compile-time only: if a field the code assumed present were ever actually `undefined` at runtime, `!` does nothing to stop it — the `undefined` would flow into the constructed entity (e.g. `volumeId: undefined`) and from there into the report, silently, or crash downstream the first time something called a method on it. 59 such assertions existed across the 29 scanners.

## Decision

For every required field, a local intersection type plus a type-narrowing `.filter()` applied immediately after the raw AWS fetch, before the field is used anywhere else:

```typescript
type NatGatewayWithId = AwsNatGateway & { NatGatewayId: string };

protected async listResources(client: EC2Client): Promise<NatGatewayWithId[]> {
  const gateways = await paginate<AwsNatGateway>(/* … */);
  const valid = gateways.filter((gw): gw is NatGatewayWithId => !!gw.NatGatewayId);
  if (valid.length !== gateways.length) {
    logger.debug(`${this.kind}: skipped ${gateways.length - valid.length} entries missing NatGatewayId`);
  }
  return valid;
}
```

The narrowed type flows through the scanner's generic type parameter (`TRaw` on `CloudWatchIdleScanner`, ADR-0044) or the local pipeline (for the 11 non-CloudWatch scanners), so every downstream use of the field is a plain, non-null access — the `!` isn't just removed, the compiler now actually enforces the invariant instead of taking it on faith. Where a required-field filter was previously combined with a business-logic filter in the same `.filter()` call (e.g. `dynamodb-overprovisioned`'s `isProvisioned` check, `kinesis-idle`'s `StreamMode === 'PROVISIONED'`, `workspaces-idle`'s `RunningMode === 'ALWAYS_ON'`), the two were split so the debug log only fires on genuinely malformed entries, not on the normal case of a resource being filtered out for a business reason.

The chosen fields are, without exception, a resource's own AWS-assigned primary identifier — never an optional business-data field — so this does not narrow which resources are eligible to be reported as waste: every field required here was *already* being force-unwrapped with `!` in the pre-existing code, meaning the assumption "this is always present" already existed; this decision only changes what happens on the rare/malformed case where that assumption doesn't hold (previously: silently broken or crashing; now: cleanly excluded and logged via ADR-0047's logger).

## Alternatives Considered

- **Runtime guard only, keep the `!`** (`if (!v.VolumeId) continue;` immediately followed by continued use of `v.VolumeId!` downstream). This is what the originating review explicitly suggested as the minimal fix. Considered and rejected in favor of full type narrowing after discussion: a guard-only fix makes the *behavior* safe but leaves the *type* lying to the compiler — the 59 lint warnings (`no-non-null-assertion`) would still all be present, so nothing downstream (linting, code review, a future refactor) could tell the difference between an assertion that's actually guarded upstream and one that isn't.
- **A runtime schema validator** (e.g. `zod`, already a project dependency as of ADR-0048) for full AWS response validation. Rejected as disproportionate: the SDK's TypeScript types are already accurate about which fields are *ever* absent in AWS's documented behavior (they're conservatively optional, not wrong); a full schema layer would revalidate structure the SDK types already describe, for a problem (a genuinely malformed/unexpected response) narrow enough that a `.filter()` at the one place each field is first read is sufficient.

## Consequences

Zero non-null assertions remain in any scanner (verified by grep across `src/`, not only via the lint warning count, which also dropped from 59 to the 2 unrelated/intentional unused-parameter warnings on the base class's no-op `resolvePrices` default). No scanner spec needed changes: the specs mock the SDK response with well-formed fixtures, so the added filters are pass-through in every existing test — confirmed additionally by running the full CLI against LocalStack (`nx run cli:e2e-localstack`) before and after, with identical findings both times and zero "skipped N entries" debug lines logged against real (well-formed) LocalStack API responses.
