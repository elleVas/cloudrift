# Come aggiungere un nuovo tipo di risorsa AWS

> 🇬🇧 [English version](../en/adding-a-resource.md)

Questa guida descrive come estendere cloudrift per rilevare un nuovo tipo di risorsa sprecata. Grazie al modello a plugin (`WasteScannerPort`), **il coordinatore, il summary e il DTO del report non si toccano**: si aggiungono i pezzi nuovi e il compilatore segnala i punti da completare.

Come esempio useremo il caso ipotetico di **CloudWatch Log Groups senza retention policy** (log che crescono all'infinito perché `retentionInDays` non è mai stato configurato).

**Panoramica dei passi (6):**

1. Aggiungi il kind alla union `ResourceKind`
2. Crea l'entità (implementa `WastedResource`)
3. Crea la waste policy
4. Aggiungi il pricing (`PricingPort`, `prices.json`, `StaticPriceTableAdapter`)
5. Implementa lo scanner AWS
6. Aggiungi il presenter CLI e registra lo scanner nel composition root

Dopo il passo 1, `pnpm nx run-many -t typecheck` ti elenca esattamente i punti rimanenti: la union è il punto di estensione controllato dal compilatore.

---

## Passo 1 — Il kind in `ResourceKind`

`libs/cloud-cost/domain/src/wasted-resource.ts`:

```typescript
export const RESOURCE_KINDS = [
  // … esistenti …
  'log-group',                                   // ← aggiunto
] as const;

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  // … esistenti …
  'log-group': 'CloudWatch Log Groups',          // ← aggiunto
};
```

Aggiungi anche la riga in `ResourceKindMap` (`group-by-kind.ts`):

```typescript
export interface ResourceKindMap {
  // … esistenti …
  'log-group': LogGroup;
}
```

Da questo momento il typecheck fallisce su `resource-presenters.ts` (CLI) finché non completi il passo 6 — è voluto.

---

## Passo 2 — Entità nel domain

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
  retentionInDays?: number;   // il "fatto" su cui decide la policy
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

**Regole:**
- L'ID dell'entità è l'identificativo univoco AWS
- Le props sono congelate (`Object.freeze`)
- L'entità porta i **fatti** (qui `retentionInDays`); la **decisione** sta nella policy
- Esporta entità e props da `domain/src/index.ts`

---

## Passo 3 — Waste policy

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

Tag di esclusione e periodo di grazia arrivano gratis dalla classe base. Aggiungi i test in `resource-waste-policies.spec.ts` (caso waste, caso grace period, caso tag) ed esporta la policy dall'`index.ts` del domain.

---

## Passo 4 — Pricing

**a)** Metodo in `PricingPort` (`domain/src/ports/outbound/pricing.port.ts`):

```typescript
getLogGroupPricePerGbMonth(region: AwsRegion): number;
```

**b)** Prezzi in `prices.json` (chiave `cw-logs` in `default` e nelle regioni con prezzo specifico). Se il listino è stato ri-verificato, aggiorna anche `pricesAsOf`.

**c)** Implementazione in `StaticPriceTableAdapter`:

```typescript
getLogGroupPricePerGbMonth(region: AwsRegion): number {
  return lookup(region, 'cw-logs');
}
```

> Aggiorna anche il `mockPricing` condiviso nei test degli scanner (`src/testing/mock-pricing.ts`): il typecheck te lo ricorderà.

---

## Passo 5 — Scanner AWS

`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/aws-log-group.scanner.ts`:

```typescript
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { LogGroup, LogGroupWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsLogGroupScanner implements WasteScannerPort {
  readonly kind = 'log-group' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new LogGroupWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CloudWatchLogsClient({ region: region.code });
    try {
      const rawGroups = await paginate<AwsLogGroup>(async (cursor) => {
        const r = await client.send(new DescribeLogGroupsCommand({ nextToken: cursor }));
        return { items: r.logGroups ?? [], cursor: r.nextToken };
      });

      const pricePerGb = this.pricing.getLogGroupPricePerGbMonth(region);
      const now = new Date();

      const groups = rawGroups
        .map((lg) => {
          const storedBytes = lg.storedBytes ?? 0;
          return new LogGroup({
            logGroupName: lg.logGroupName!,
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

**Regole:**
- `paginate()` per tutte le chiamate list
- Eventuale fan-out interno (una chiamata per elemento) → `mapWithConcurrency` con limite
- La policy si applica **sempre** prima del return
- Esporta lo scanner da `aws-adapter/src/index.ts` e aggiungi `@aws-sdk/client-cloudwatch-logs` nel `package.json` root

---

## Passo 6 — CLI: presenter + registrazione

**a)** Presenter in `apps/cli/src/formatters/resource-presenters.ts` (il typecheck fallisce finché manca):

```typescript
'log-group': {
  title: 'CloudWatch Log Groups — No retention policy',
  head: ['Log Group', 'Region', 'Stored', 'Created'],
  colWidths: [190, 70, 70, 84, 85],   // l'ultimo è la colonna costo
  row: (lg) => [
    lg.id, lg.region.code,
    `${(lg.storedBytes / 1024 ** 3).toFixed(1)} GB`,
    lg.creationTime.toISOString().split('T')[0],
  ],
  recommend: (lg) =>
    `Set a retention policy on log group ${lg.id} in ${lg.region.code}`,
},
```

Tabella console, PDF e DTO JSON si aggiornano da soli: consumano il registry e `RESOURCE_KIND_LABELS`.

**b)** Registrazione nel composition root (`analyze-waste.command.ts`):

```typescript
const scanners: WasteScannerPort[] = [
  // … esistenti …
  new AwsLogGroupScanner(pricing, accountId, new LogGroupWastePolicy(policyOptions)),
];
```

---

## Test

- `domain`: spec dell'entità + casi della policy in `resource-waste-policies.spec.ts`
- `aws-adapter`: spec dello scanner (mock SDK) — mapping, paginazione, policy applicata, errori, `destroy()`
- Il coordinatore **non** ha bisogno di nuovi test: è generico

```sh
pnpm nx run-many -t typecheck test lint
```

---

## Permessi IAM

Aggiungi al README la permission richiesta dal nuovo scanner. Per i log group:

```json
"logs:DescribeLogGroups"
```

---

## Checklist riepilogativa

- [ ] `ResourceKind` + `RESOURCE_KIND_LABELS` + `ResourceKindMap` aggiornati
- [ ] Entità in `domain/src/entities/` che implementa `WastedResource` (fatti, non decisioni)
- [ ] Waste policy in `domain/src/policies/` + test
- [ ] `domain/src/index.ts` aggiornato (entità + policy)
- [ ] `PricingPort` + `prices.json` (+ `pricesAsOf` se ri-verificato) + `StaticPriceTableAdapter` + `mockPricing`
- [ ] Scanner in `aws-adapter/src/scanners/` con policy applicata + test
- [ ] `aws-adapter/src/index.ts` aggiornato; dipendenza SDK nel `package.json` root
- [ ] Presenter in `resource-presenters.ts`
- [ ] Scanner registrato in `analyze-waste.command.ts`
- [ ] README aggiornato (tabella risorse + permessi IAM)

**Cosa NON va toccato** (se ti ritrovi a modificarli, qualcosa è andato storto): `AnalyzeCloudWasteUseCase`, `WastedResourcesSummary`, `WasteReportDto`, i tre formatter.
