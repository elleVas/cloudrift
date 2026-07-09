# How to add a new AWS resource type

> 🇮🇹 [Versione italiana](../it/aggiungere-risorsa.md)

This guide describes how to extend cloudrift to detect a new type of wasted resource. Thanks to the plugin model (`WasteScannerPort`), **the coordinator, the summary and the report DTO are not touched**: you add the new pieces and the compiler points out the spots to complete.

As an example we will use the hypothetical case of **CloudWatch Log Groups without a retention policy** (logs growing forever because `retentionInDays` was never configured).

## Glossary

- **kind** — the discriminant string identifying a resource type (e.g. `'nat-gateway'`); drives the `ResourceKind` union and every registry derived from it (`RESOURCE_KIND_META`, `ResourceKindMap`, presenters).
- **category** (`'waste'` | `'optimization'`) — `waste` is a certain, eliminable cost that counts toward `totalWasteMonthlyUsd` and the CI gate; `optimization` is a savings opportunity that keeps the resource (e.g. gp2→gp3).
- **estimated** — marks a finding as a heuristic figure needing human verification (currently only `ec2-underutilized`/`rds-underutilized`), as opposed to a directly-measured cost.
- **policy** — a `WastePolicy<T>` subclass: pure judgment logic (`judge()`) deciding if a resource is waste, given grace period and exclusion tags from config. No AWS calls.
- **scanner** — a `WasteScannerPort` implementation: calls the AWS SDK, builds entities, applies the policy, returns only the findings that are waste.

**Overview of the steps (6):**

1. Add the kind to the `ResourceKind` union
2. Create the entity (implements `WastedResource`)
3. Create the waste policy
4. Add pricing (a new key in `prices.json`, no interface to touch)
5. Implement the AWS scanner
6. Add the CLI presenter and register the scanner in the scanner registry

After step 1, `pnpm nx run-many -t typecheck` lists exactly the remaining spots: the union is the compiler-controlled extension point.

---

## Step 1 — The kind in `ResourceKind`

`libs/cloud-cost/domain/src/wasted-resource.ts`:

```typescript
export const RESOURCE_KINDS = [
  // … existing …
  'log-group',                                   // ← added
] as const;

export const RESOURCE_KIND_META: Record<ResourceKind, ResourceKindMeta> = {
  // … existing …
  'log-group': { label: 'CloudWatch Log Groups', category: 'waste', estimated: false }, // ← added
};
```

`category` is `'waste'` (eliminable cost, counts in `totalWasteMonthlyUsd` and the CI gate) or `'optimization'` (a saving that keeps the resource, e.g. gp2→gp3 — see [architecture.md](./architecture.md#waste-vs-optimization--findingcategory)). `estimated: true` marks a heuristic figure that needs verification (only `ec2-underutilized` today). `RESOURCE_KIND_LABELS` is derived automatically from `RESOURCE_KIND_META` — do not add a separate entry there.

Also add the row in `ResourceKindMap` (`group-by-kind.ts`):

```typescript
export interface ResourceKindMap {
  // … existing …
  'log-group': LogGroup;
}
```

From this moment the typecheck fails on `resource-presenters.ts` (CLI) until you complete step 6 — that is intentional.

---

## Step 2 — Entity in the domain

`libs/cloud-cost/domain/src/entities/log-group.entity.ts`:

```typescript
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface LogGroupProps {
  logGroupName: string;
  region: AwsRegion;
  accountId: string;
  storedBytes: number;
  retentionInDays?: number;   // the "fact" the policy decides on
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class LogGroup extends Entity<string> implements WastedResource {
  private readonly props: Readonly<LogGroupProps>;

  constructor(props: LogGroupProps) {
    super(props.logGroupName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get storedBytes(): number { return this.props.storedBytes; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'log-group' { return 'log-group'; }
  get wasteReason(): string { return 'no retention policy'; }

  hasRetentionPolicy(): boolean {
    return this.props.retentionInDays !== undefined;
  }

  get costEstimate(): CostEstimate {
    const storedGb = (this.props.storedBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(this.props.monthlyCostUsd, `${storedGb} GB CW logs (no retention)`);
  }
}
```

**Rules:**
- The entity ID is the unique AWS identifier
- Props are frozen (`Object.freeze`)
- The entity carries the **facts** (here `retentionInDays`); the **decision** belongs to the policy
- Export entity and props from `domain/src/index.ts`

---

## Step 3 — Waste policy

`libs/cloud-cost/domain/src/policies/resource-waste-policies.ts`:

```typescript
export class LogGroupWastePolicy extends WastePolicy<LogGroup> {
  protected judge(group: LogGroup, now: Date): WasteVerdict {
    if (group.hasRetentionPolicy()) return notWaste('retention policy configured');
    if (this.isWithinGracePeriod(group.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no retention policy');
  }
}
```

Exclusion tag and grace period come for free from the base class. Add the tests in `resource-waste-policies.spec.ts` (waste case, grace-period case, tag case) and export the policy from the domain's `index.ts`.

---

## Step 4 — Pricing

`PricingPort` is a single generic lookup — `getPrice(region: AwsRegion, key: string): number` — so a new resource type needs **no interface or adapter change**. Just pick a price key (here `cw-logs`) and:

**a)** Add it to `prices.json` (a `cw-logs` key in `default` and in regions with specific pricing). If the price table was re-verified, also update `pricesAsOf`.

**b)** Call it from the scanner: `this.pricing.getPrice(region, 'cw-logs')`.

If the price key depends on a runtime value with unknown variants (e.g. an EBS volume type your policy hasn't seen before), chain a fallback to a known-good key: `pricing.getPrice(region, \`ebs-${volumeType}\`) || pricing.getPrice(region, 'ebs-gp3')` — see `AwsEbsVolumeScanner` for a real example. `getPrice` returns `0` for a totally unpriced key, never `undefined`.

> Also update the shared `mockPricing` in the scanner tests (`src/testing/mock-pricing.ts`) with the new key: the typecheck won't catch a missing key the way it did for a missing method, so check it by hand.

---

## Step 5 — AWS scanner

> **If your resource needs a CloudWatch metric** (most idle/underutilized checks do), extend `CloudWatchIdleScanner` (`scanners/cloudwatch-idle.scanner.ts`) instead of writing `scan()` from scratch — see [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md) and any of the 18 scanners that already extend it (e.g. `aws-nat-gateway.scanner.ts` for the simplest case, `aws-ec2-underutilized.scanner.ts` for one with a `resolvePrices` override). Log Groups don't need a metric (`storedBytes` comes straight from `DescribeLogGroups`), so this example stays standalone — the shape below is what every non-CloudWatch scanner (11 of them) looks like.

`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/aws-log-group.scanner.ts`:

```typescript
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { LogGroup, LogGroupWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

// The AWS SDK types mark almost every response field optional. Read the
// resource's own primary identifier through a type-narrowing filter, not a
// bare `!` — see ADR-0051.
type LogGroupWithName = AwsLogGroup & { logGroupName: string };

export class AwsLogGroupScanner implements WasteScannerPort {
  readonly kind = 'log-group' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new LogGroupWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CloudWatchLogsClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
    try {
      const rawGroups = await paginate<AwsLogGroup>(async (cursor) => {
        const r = await client.send(new DescribeLogGroupsCommand({ nextToken: cursor }));
        return { items: r.logGroups ?? [], cursor: r.nextToken };
      });

      const validGroups = rawGroups.filter((lg): lg is LogGroupWithName => !!lg.logGroupName);
      if (validGroups.length !== rawGroups.length) {
        logger.debug(`${this.kind}: skipped ${rawGroups.length - validGroups.length} entries missing logGroupName`);
      }

      const pricePerGb = this.pricing.getPrice(region, 'cw-logs');
      const now = new Date();

      const groups = validGroups
        .map((lg) => {
          const storedBytes = lg.storedBytes ?? 0;
          return new LogGroup({
            logGroupName: lg.logGroupName,
            region,
            accountId: this.accountId,
            storedBytes,
            retentionInDays: lg.retentionInDays,
            creationTime: lg.creationTime ? new Date(lg.creationTime) : new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +((storedBytes / 1024 ** 3) * pricePerGb).toFixed(4),
          });
        })
        .filter((group) => this.policy.evaluate(group, now).isWaste);

      return Result.ok(groups);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err as Error));
    } finally {
      client.destroy();
    }
  }
}
```

**Rules:**
- `{ ...AWS_CLIENT_DEFAULTS, region: region.code }` on every SDK client (enables retry/backoff on throttling — see `utils/client-config.ts`)
- `paginate()` for every list call
- Any internal fan-out (one call per item) → `mapWithConcurrency` with a cap
- Every required field read off an AWS response goes through a type-narrowing `.filter()`, never a bare `!` — see [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md)
- The policy is **always** applied before returning
- Export the scanner from `aws-adapter/src/index.ts` and add `@aws-sdk/client-cloudwatch-logs` to the root `package.json`

---

## Step 6 — CLI: presenter + registration

**a)** Presenter in `apps/cli/src/formatters/resource-presenters.ts` (the typecheck fails until it exists):

```typescript
'log-group': {
  title: 'CloudWatch Log Groups — No retention policy',
  head: ['Log Group', 'Region', 'Stored', 'Created'],
  colWidths: [190, 70, 70, 84, 85],   // the last one is the cost column
  row: (lg) => [
    lg.id, lg.region.code,
    `${(lg.storedBytes / 1024 ** 3).toFixed(1)} GB`,
    lg.creationTime.toISOString().split('T')[0],
  ],
  recommend: (lg) =>
    `Set a retention policy on log group ${lg.id} in ${lg.region.code}`,
},
```

Console table, PDF and JSON DTO update themselves: they consume the registry and `RESOURCE_KIND_LABELS`. The interactive scanner picker (see [how-it-works.md](./how-it-works.md#scanner-selection-the-wizard-and-its-escape-hatches)) also updates itself: it lists every `RESOURCE_KINDS` entry with its `RESOURCE_KIND_META` label, so a new kind appears in the checkbox list with no wizard-specific code to touch.

**b)** Registration in `analyze-waste.composition.ts`: one entry in `ALWAYS_ON_SCANNERS` (or `LIVE_PRICING_SCANNERS` if the resource type needs `--live-pricing`) — not a loose `new Scanner(...)` call:

```typescript
{
  kind: 'log-group',
  create: (ctx) => new AwsLogGroupScanner(ctx.pricing, ctx.accountId, new LogGroupWastePolicy(ctx.policyOptions)),
},
```

`assertRegistryMatchesResourceKinds()` throws at module load if you add a kind to `ResourceKind` and forget to register it here (or the reverse) — a missing/duplicated entry fails immediately, not silently at scan time.

---

## Tests

- `domain`: entity spec + policy cases in `resource-waste-policies.spec.ts`
- `aws-adapter`: scanner spec (mocked SDK) — mapping, pagination, policy applied, errors, `destroy()`
- The coordinator needs **no** new tests: it is generic

```sh
pnpm nx run-many -t typecheck test lint
```

---

## IAM permissions

Add the permission the new scanner requires to the README. For log groups:

```json
"logs:DescribeLogGroups"
```

---

## Summary checklist

- [ ] `ResourceKind` + `RESOURCE_KIND_META` (label, category, estimated) + `ResourceKindMap` updated
- [ ] Entity in `domain/src/entities/` implementing `WastedResource` (facts, not decisions)
- [ ] Waste policy in `domain/src/policies/` + tests
- [ ] `domain/src/index.ts` updated (entity + policy)
- [ ] New price key in `prices.json` (+ `pricesAsOf` if re-verified) + `mockPricing`
- [ ] Scanner in `aws-adapter/src/scanners/` (extends `CloudWatchIdleScanner` if it needs a metric) with required fields filtered via type-narrowing (not `!`), the policy applied, + tests
- [ ] `aws-adapter/src/index.ts` updated; SDK dependency in the root `package.json`
- [ ] Presenter in `resource-presenters.ts`
- [ ] Scanner registered in `analyze-waste.composition.ts` (`ALWAYS_ON_SCANNERS` or `LIVE_PRICING_SCANNERS`)
- [ ] README updated (resource table + IAM permissions)

**What must NOT be touched** (if you find yourself modifying these, something went wrong): `AnalyzeCloudWasteUseCase`, `WastedResourcesSummary`, `WasteReportDto`, the three formatters.
