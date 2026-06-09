# Come aggiungere un nuovo tipo di risorsa AWS

Questa guida descrive passo per passo come estendere cloudrift per rilevare un nuovo tipo di risorsa AWS sprecata. Segui i passi nell'ordine indicato.

Come esempio pratico, useremo il caso ipotetico di **CloudWatch Log Groups senza retention policy** (gruppi di log che crescono all'infinito perché non hanno mai un `retentionInDays` configurato).

---

## Passo 1 — Entità nel domain

Crea il file `libs/cloud-cost/domain/src/entities/<nome-risorsa>.entity.ts`.

```typescript
// libs/cloud-cost/domain/src/entities/log-group.entity.ts

import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object.js';
import { CostEstimate } from '../value-objects/cost-estimate.value-object.js';

export interface LogGroupProps {
  logGroupName: string;
  region: AwsRegion;
  accountId: string;    // OBBLIGATORIO: ID account AWS
  storedBytes: number;
  creationTime: Date;
  detectedAt: Date;     // OBBLIGATORIO: quando l'adapter ha rilevato lo spreco
  tags: Record<string, string>;
  monthlyCostUsd: number; // OBBLIGATORIO: calcolato dall'adapter via PricingPort
}

export class LogGroup extends Entity<string> {
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

  get costEstimate(): CostEstimate {
    const storedGb = (this.props.storedBytes / (1024 ** 3)).toFixed(2);
    return CostEstimate.of(this.props.monthlyCostUsd, `${storedGb} GB CW logs (no retention)`);
  }
}
```

**Regole:**
- L'ID dell'entità è il campo che AWS usa come identificativo univoco
- Le props vengono congelate (`Object.freeze`) per garantire l'immutabilità
- I tre campi `accountId`, `detectedAt`, `monthlyCostUsd` sono **obbligatori** in tutte le entità
- Il `costEstimate` usa `CostEstimate.of(monthlyCostUsd, description)` — il prezzo viene dall'adapter, non dall'entità

---

## Passo 2 — Pricing: aggiorna `PricingPort` e `prices.json`

**a) Aggiungi il metodo a `PricingPort`** (`libs/cloud-cost/domain/src/ports/outbound/pricing.port.ts`):

```typescript
export interface PricingPort {
  // ... metodi esistenti ...
  getLogGroupPricePerGbMonth(region: AwsRegion): number;
}
```

**b) Aggiungi i prezzi a `prices.json`** (`libs/cloud-cost/infrastructure/aws-adapter/src/pricing/prices.json`):

```json
{
  "default": {
    "...",
    "cw-logs": 0.03
  },
  "eu-west-1": {
    "...",
    "cw-logs": 0.033
  }
}
```

**c) Implementa il metodo in `StaticPriceTableAdapter`** (`static-price-table.adapter.ts`):

```typescript
getLogGroupPricePerGbMonth(region: AwsRegion): number {
  return this.lookup(region, 'cw-logs');
}
```

> **Nota:** il pricing non vive nel domain — `CostEstimate.of()` è l'unico factory method e non conosce prezzi. I prezzi si trovano solo in `prices.json` nell'infrastruttura.

---

## Passo 3 — Port outbound repository

Crea `libs/cloud-cost/domain/src/ports/outbound/<nome>-repository.port.ts`:

```typescript
// libs/cloud-cost/domain/src/ports/outbound/log-group-repository.port.ts

import type { Result } from 'shared-kernel';
import type { LogGroup } from '../../entities/log-group.entity.js';
import type { AwsRegion } from '../../value-objects/aws-region.value-object.js';

export interface LogGroupRepositoryPort {
  findGroupsWithoutRetention(region: AwsRegion): Promise<Result<LogGroup[]>>;
}

export const LOG_GROUP_REPOSITORY_PORT = Symbol('LogGroupRepositoryPort');
```

---

## Passo 4 — Aggiorna `WastedResourcesSummary`

Apri `libs/cloud-cost/domain/src/ports/inbound/find-wasted-resources.use-case.port.ts` e aggiungi il nuovo campo:

```typescript
import type { LogGroup } from '../../entities/log-group.entity.js';

export interface WastedResourcesSummary {
  ebsVolumes: EbsVolume[];
  elasticIps: ElasticIp[];
  rdsInstances: RdsInstance[];
  loadBalancers: LoadBalancer[];
  stoppedEc2Instances: Ec2Instance[];
  orphanSnapshots: EbsSnapshot[];
  idleNatGateways: NatGateway[];
  logGroupsWithoutRetention: LogGroup[];  // ← aggiunto
  totalMonthlyCostUsd: number;
}
```

---

## Passo 5 — Aggiorna `index.ts` del domain

Apri `libs/cloud-cost/domain/src/index.ts` e aggiungi gli export:

```typescript
// Entities
export { LogGroup } from './entities/log-group.entity.js';
export type { LogGroupProps } from './entities/log-group.entity.js';

// Outbound Ports
export type { LogGroupRepositoryPort } from './ports/outbound/log-group-repository.port.js';
export { LOG_GROUP_REPOSITORY_PORT } from './ports/outbound/log-group-repository.port.js';
```

---

## Passo 6 — Use Case nell'application layer

Crea `libs/cloud-cost/application/src/use-cases/find-log-groups-without-retention.use-case.ts`:

```typescript
import { Result } from 'shared-kernel';
import type { LogGroup, LogGroupRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindLogGroupsWithoutRetentionUseCase {
  constructor(private readonly logGroupRepository: LogGroupRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<LogGroup[]>> {
    const allGroups: LogGroup[] = [];

    for (const region of regions) {
      const result = await this.logGroupRepository.findGroupsWithoutRetention(region);
      if (!result.ok) return result;
      allGroups.push(...result.value);
    }

    return Result.ok(allGroups);
  }
}
```

---

## Passo 7 — Aggiorna `AnalyzeCloudWasteUseCase`

Aggiungi il nuovo use case al coordinatore (`analyze-cloud-waste.use-case.ts`):

```typescript
// Nel tipo AnalyzeCloudWasteDependencies
export interface AnalyzeCloudWasteDependencies {
  // ... repository esistenti
  logGroupRepository: LogGroupRepositoryPort; // ← aggiunto
}

// Nel costruttore
constructor(deps: AnalyzeCloudWasteDependencies) {
  // ...
  this.findLogGroups = new FindLogGroupsWithoutRetentionUseCase(deps.logGroupRepository);
}

// In execute() — aggiungi al Promise.all esistente
const [..., logGroupResult] = await Promise.all([
  // ... use case esistenti
  this.findLogGroups.execute(request.regions), // ← aggiunto
]);

// Usa collect() per il partial-result (non fail-fast)
const logGroupsWithoutRetention = collect(logGroupResult, 'Log Groups', scanErrors);

// Aggiungi al totalMonthlyCostUsd e al summary return
```

**Importante:** usa sempre `collect()` (non `if (!result.ok) return result`): permette al coordinatore di continuare anche se questo tipo di risorsa fallisce.

---

## Passo 8 — Adapter AWS

Crea `libs/cloud-cost/infrastructure/aws-adapter/src/repositories/aws-log-group.repository.adapter.ts`:

```typescript
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { Result } from 'shared-kernel';
import type { LogGroupRepositoryPort, AwsRegion, PricingPort } from 'cloud-cost-domain';
import { LogGroup } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error.js';
import { paginate } from '../utils/paginate.js';

export class AwsLogGroupRepositoryAdapter implements LogGroupRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId: string = 'unknown',
  ) {}

  async findGroupsWithoutRetention(
    region: AwsRegion,
  ): ReturnType<LogGroupRepositoryPort['findGroupsWithoutRetention']> {
    const client = new CloudWatchLogsClient({ region: region.code });
    try {
      // Usa paginate() per raccogliere tutti i log group
      const allGroups = await paginate<AwsLogGroup>(async (cursor) => {
        const r = await client.send(new DescribeLogGroupsCommand({ nextToken: cursor }));
        return { items: r.logGroups ?? [], cursor: r.nextToken };
      });

      const pricePerGb = this.pricing.getLogGroupPricePerGbMonth(region);

      const groups = allGroups
        .filter((lg) => lg.retentionInDays === undefined || lg.retentionInDays === null)
        .map((lg) => {
          const storedBytes = lg.storedBytes ?? 0;
          const storedGb = storedBytes / (1024 ** 3);
          return new LogGroup({
            logGroupName: lg.logGroupName!,
            region,
            accountId: this.accountId,
            storedBytes,
            creationTime: lg.creationTime ? new Date(lg.creationTime) : new Date(0),
            detectedAt: new Date(),
            tags: {},
            monthlyCostUsd: +(pricePerGb * storedGb).toFixed(4),
          });
        });

      return Result.ok(groups);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err as Error));
    } finally {
      client.destroy();
    }
  }
}
```

Aggiorna `libs/cloud-cost/infrastructure/aws-adapter/src/index.ts`:

```typescript
export { AwsLogGroupRepositoryAdapter } from './repositories/aws-log-group.repository.adapter.js';
```

> **Nota:** `@aws-sdk/client-cloudwatch-logs` deve essere aggiunto come dipendenza nel `package.json` root prima di installare.

---

## Passo 9 — Aggiorna la CLI

**`analyze-waste.command.ts`:** aggiungi l'adapter al costruttore del use case.

**`waste-report.table-formatter.ts`:** aggiungi la sezione di output:

```typescript
if (summary.idleNatGateways.length > 0) {
  lines.push(chalk.bold.yellow('\n  NAT Gateways — Idle (0 traffico nelle ultime 48h)'));
  const table = new Table({
    head: ['NAT Gateway ID', 'Region', 'VPC', 'Created', 'Est. Cost'],
    style: { head: ['cyan'] },
  });
  for (const gw of summary.idleNatGateways) {
    table.push([gw.id, gw.region.code, gw.vpcId,
      gw.createTime.toISOString().split('T')[0], chalk.red(gw.costEstimate.format())]);
  }
  lines.push(table.toString());
}
```

Aggiorna anche la condizione "nessuna risorsa trovata" per includere `idleNatGateways.length === 0`.

---

## Passo 10 — Aggiungi i test

Segui la struttura dei test esistenti:

- `libs/cloud-cost/domain/src/entities/log-group.entity.spec.ts`
- `libs/cloud-cost/application/src/use-cases/find-log-groups-without-retention.use-case.spec.ts`
- `libs/cloud-cost/infrastructure/aws-adapter/src/repositories/aws-log-group.repository.adapter.spec.ts`

Verifica che tutto passi:
```sh
pnpm nx run-many -t test
```

---

## Permessi IAM necessari

Aggiorna la policy IAM nel README principale con i nuovi permessi richiesti. Per NAT Gateway:

```json
"logs:DescribeLogGroups"
```

---

## Checklist riepilogativa

- [ ] Entità in `domain/src/entities/` — con `accountId`, `detectedAt`, `monthlyCostUsd` obbligatori
- [ ] Metodo aggiunto a `PricingPort` in `domain/src/ports/outbound/pricing.port.ts`
- [ ] Prezzi aggiunti a `prices.json` per ogni regione supportata
- [ ] Metodo implementato in `StaticPriceTableAdapter`
- [ ] Port outbound repository in `domain/src/ports/outbound/`
- [ ] `WastedResourcesSummary` aggiornato con il nuovo campo
- [ ] `domain/src/index.ts` aggiornato
- [ ] Use case in `application/src/use-cases/`
- [ ] `AnalyzeCloudWasteUseCase` aggiornato — usa `collect()` per partial results
- [ ] `application/src/index.ts` aggiornato
- [ ] Adapter AWS in `infrastructure/aws-adapter/src/repositories/` — usa `paginate()`, imposta `accountId` e `detectedAt`
- [ ] `aws-adapter/src/index.ts` aggiornato
- [ ] CLI `analyze-waste.command.ts` aggiornato con il nuovo adapter
- [ ] Formatter aggiornato
- [ ] Test per entità, use case e adapter
- [ ] README aggiornato con permessi IAM e tabella prezzi
