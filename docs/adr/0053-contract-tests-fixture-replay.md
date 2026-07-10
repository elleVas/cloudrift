# ADR-0053: Contract tests replay real response fixtures through every scanner

- **Status:** Accepted (2026-07-10)

## Context

Every scanner spec mocks `jest.mock('@aws-sdk/client-*')` and hand-builds a minimal response object with just the fields the test cares about (`{ NatGatewayId: 'nat-1', VpcId: 'vpc-1', CreateTime: OLD_DATE }`). That verifies the *query* (right filters, right pagination cursor field, right CloudWatch `Namespace`/`Dimensions`) but never the *response*: nothing in CI checks that a scanner's mapping code actually survives contact with the full shape AWS sends back — extra fields, nested optional structures (`ClusterConfig.InstanceType`, `WorkspaceProperties.RunningMode`), real pagination tokens, `$metadata`. REVIEW.md #10 flagged this as the gap between "the mock says this works" and "AWS's real response shape says this works." The existing LocalStack e2e harness (`scripts/e2e-localstack.mjs`) partially closes it, but only for 16 of 29 kinds, and only end-to-end through the CLI (no per-scanner findings assertion), not in a way that runs on every `nx test`.

## Decision

A single parametric spec, [`scanner-contract.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/scanner-contract.spec.ts), replays one JSON fixture per `ResourceKind` (29 total, in `src/testing/contract-fixtures/`) through each scanner's real `scan()`:

```typescript
const clientBase = Object.getPrototypeOf(EC2Client); // shared by every @aws-sdk/client-* class
clientBase.prototype.send = async function (command) {
  const page = pages[command.constructor.name][index++]; // serve captured/transcribed pages in order
  return page;
};

const result = await scanner.scan(region);
expect(result.value.map(toIdAndCost)).toEqual(fixture.expected.findings);
```

Each fixture is a full raw response (or page sequence, for pagination) keyed by SDK Command class name, plus the findings a live run against that response actually produced. Two provenance paths, both stored the same shape and both readable in the fixture's own `source` field:

- **Captured** (14 kinds): [`scripts/capture-contract-fixtures.mjs`](../../scripts/capture-contract-fixtures.mjs) boots LocalStack, seeds it (`scripts/seed-localstack.mjs`, already existed for the e2e harness), patches the same shared-`Client.prototype.send` seam to *record* instead of replay, runs each scanner for real, and writes what it saw.
- **Transcribed** (15 kinds): hand-written from the AWS API reference, for kinds LocalStack Community can't host at all — `elbv2`/RDS/EFS/FSx (rejected by license/"not implemented"), and the 10 `--live-pricing`-gated scanners (the AWS Pricing API is a real signed endpoint, unreachable with LocalStack's fake credentials regardless of whether the underlying service is mockable). `ebs-snapshot` is transcribed rather than captured for a different reason: LocalStack's moto backend pre-seeds the account with over a thousand canned public snapshots, so a real capture produced an 616KB fixture with 1160 findings — noise, not a contract. The transcribed `ebs-snapshot` fixture is also the pagination contract: its one expected finding sits on page 2 of `DescribeSnapshotsCommand`, reachable only if the scanner actually follows `NextToken`.

A coverage test (`RESOURCE_KINDS` vs. the fixture directory) fails the build if any kind ever ships without a fixture.

## Alternatives Considered

- **Run the contract tests against LocalStack directly in CI** (spin up the container as part of `nx test`). Rejected: requires Docker in every CI run and every contributor's local loop, adds real wall-clock time, and still wouldn't cover the 13 kinds LocalStack can't host — the fixture approach covers all 29 and runs in under 2 seconds as a normal Jest suite.
- **One `it.each` fixture bundling everything into a single giant JSON file.** Rejected in favor of one file per kind: smaller diffs when one scanner's query changes, and `capture-contract-fixtures.mjs` can regenerate a subset without touching the transcribed ones.
- **Snapshot testing (`toMatchSnapshot()`) instead of an explicit `expected` block in each fixture.** Rejected: a snapshot would silently accept any change to the findings (including a regression) on the next `--updateSnapshot`; an explicit expected id/cost list requires a human to consciously edit the fixture when behavior legitimately changes.

## Consequences

29/29 scanners now have a response-shape-to-findings contract test, closing REVIEW.md #10 for every kind — not just the 16 covered by the LocalStack e2e harness. The Command classes are real in every test (only `send` is stubbed), so a change to the SDK version that alters a Command's constructor or response type surfaces here even without a live LocalStack run. Fixture staleness is a real residual risk (a fixture only reflects AWS's shape as of the day it was captured/transcribed); `capture-contract-fixtures.mjs` exists specifically to be rerun after an SDK bump. Not wired into `lint`/`build` — it's a normal Jest spec picked up by `nx test` like any other, no opt-in step required (unlike the LocalStack e2e harness, which needs Docker and a token).
