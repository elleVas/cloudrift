# Test

> 🇬🇧 [English version](../en/testing.md)

Questo documento descrive la piramide dei test di cloudrift: cosa copre ciascun livello, dove trovare esempi concreti, come lanciare l'harness e2e su LocalStack e come verificare manualmente gli scanner contro un account AWS sandbox reale.

## La piramide

```
        ┌─────────────────────────┐
        │   CLI e2e (apps/cli)    │   a livello comando: formato, exit code, artefatti
        ├─────────────────────────┤
        │  Infra (scanner spec)   │   SDK AWS mockato: forma della query, paginazione, errori
        ├─────────────────────────┤
        │  Dominio (entity/policy)│   logica pura: regole di spreco, boundary, niente I/O
        └─────────────────────────┘
        ┌─────────────────────────┐
        │  e2e LocalStack (free)  │   scripts/e2e-localstack.mjs (questo doc), 13/18 scanner
        ├─────────────────────────┤
        │  Verifica manuale AWS   │   scripts/verify-against-aws.mjs (questo doc)
        └─────────────────────────┘
```

### Dominio — entità e policy

Unit test puri, senza mock. Uno spec per entità, che verifica i campi esposti, il valore calcolato specifico dell'entità, `kind`, `wasteReason` e `costEstimate`:

- [`libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts)

Le policy vivono in un unico file, [`libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts`](../../libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts), che copre per ogni policy: waste vs non-waste, il periodo di grazia, l'`ignoreTag`, `excludeTagValues`, e il boundary esatto di ogni soglia (età `===` `minAgeDays`, CPU `===` soglia, ops `===` `maxOps`) — i boundary contano perché periodo di grazia e confronti CPU/ops usano operatori con stretta opposta (`<` contro `>=`/`>`), quindi un errore di uno cambia silenziosamente quali risorse vengono segnalate.

### Infra — scanner

Uno spec per scanner in [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), con il client SDK AWS mockato. Ognuno copre: il filtro dei candidati (es. `DescribeVolumes` con `Filters=[status=available]`), paginazione, concorrenza, errori dell'SDK e `destroy()` sul client. Nove scanner sono basati su CloudWatch (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`) e asseriscono in più l'esatto `Namespace`, `Period`, `Statistics` e `Dimensions` inviati a `GetMetricStatistics` — è il contratto su cui si appoggia lo script di verifica manuale descritto sotto per i quattro che copre attualmente (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`); gli altri cinque non sono ancora cablati in quello script.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) pilota il comando con un `AnalyzeDeps` fake (niente AWS), verificando la scelta del formato (table/json/markdown), gli exit code (0/1/2), gli artefatti `--json <file>` e `--pdf <file>`, e che uno scan parziale (`summary.scanErrors` non vuoto) non faccia crashare il comando — l'exit code resta dettato solo dalla soglia di costo, mai dagli errori di scan, e la nota di scan incompleto (prodotta dai formatter, vedi [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) arriva fino a stdout. `analyze-waste.composition.ts` — l'implementazione `defaultAnalyzeDeps` che il fake sostituisce — non ha un suo spec per scelta: si limita a cablare insieme gli adapter AWS reali (stesso pattern di `aws-account-id.resolver.ts`), ed è esattamente quel cablaggio che il fake serve a bypassare nei test unitari.

## Harness e2e su LocalStack

Gli spec sopra mockano l'SDK AWS, quindi verificano la *forma* di una query ma non lanciano mai davvero il binario CLI buildato contro qualcosa. [`scripts/e2e-localstack.mjs`](../../scripts/e2e-localstack.mjs) chiude questo gap senza costi né credenziali AWS reali: avvia un container [LocalStack](https://www.localstack.cloud/) (`docker-compose.localstack.yml`), semina una risorsa sprecata/ottimizzabile per ogni kind (`scripts/seed-localstack.mjs`), lancia `cloudrift analyze` buildato contro quel container, verifica che ogni kind atteso produca un finding, e smonta il container — anche in caso di fallimento.

Lo scope è 13 dei 18 scanner (vedi [ADR-0002](../adr/0002-localstack-e2e-scope.md) e [ADR-0036](../adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md)): `rds-instance`, `rds-underutilized`, `elasticache-idle`, `efs-unused` (il piano Hobby gratuito di LocalStack non emula RDS/ElastiCache/EFS) ed `ec2-underutilized` (il match con la Pricing API di cui ha bisogno non è affidabile sul piano Hobby) sono esclusi e restano coperti solo dallo script di verifica manuale AWS più sotto. `load-balancer` è nella lista dei kind attesi ma trattato come soft-missing: il piano Hobby di LocalStack rifiuta del tutto le chiamate `elbv2`, quindi un finding mancante lì è un warning, non un fallimento.

**Setup (una tantum):** registra un account gratuito su [app.localstack.cloud](https://app.localstack.cloud) e prendi il tuo Auth Token dalla dashboard — anche il piano Hobby gratuito ne richiede uno, il container si rifiuta di partire senza.

```sh
export LOCALSTACK_AUTH_TOKEN=<il-tuo-token>
pnpm nx run cli:build
pnpm nx run cli:e2e-localstack   # oppure: pnpm e2e:localstack
```

Richiede Docker. Non è cablato in `lint`/`test`/`build`/`typecheck` — è un target Nx opt-in con un suo job CI dedicato (`e2e-localstack` in `.github/workflows/ci.yml`), che legge il token dal secret di repository `LOCALSTACK_AUTH_TOKEN`.

## Verifica manuale contro un account AWS reale

Le chiamate SDK mockate verificano la *forma* di una query; non possono verificare che quella forma corrisponda davvero a ciò che AWS restituisce per risorse reali. [`scripts/verify-against-aws.mjs`](../../scripts/verify-against-aws.mjs) chiude questo gap: esegue 11 dei 18 scanner — tutto ciò che è stato pubblicato prima della v0.4.0 — contro un account AWS reale e stampa cosa trovano, accanto al descrittore statico della query già asserito in CI dallo spec dello scanner corrispondente. I 7 scanner aggiunti nella v0.4.0 (`log-group`, `eni-orphaned`, `s3-no-lifecycle`, `lambda-underutilized`, `efs-unused`, `dynamodb-overprovisioned`, `elasticache-idle`) non sono ancora cablati in questo script.

**Non** viene eseguito da `pnpm test` né dalla CI — chiama API AWS reali e va lanciato a mano contro un account **sandbox**.

### Checklist di seeding

Crea questi elementi nell'account sandbox prima di lanciare lo script (qualsiasi regione, default `us-east-1`):

| Risorsa | Cosa creare | Finding atteso |
| --- | --- | --- |
| Volume EBS | un volume **non attaccato**, più vecchio di 7 giorni | `ebs-volume` |
| Elastic IP | un EIP **non associato** | `elastic-ip` |
| NAT Gateway | un gateway con **zero traffico** per 48h | `nat-gateway` |
| Istanza EC2 | un'istanza **ferma** da più di 7 giorni | `ec2-instance` |
| Istanza EC2 | un'istanza **running** con CPU bassa per 14+ giorni | `ec2-underutilized` |
| Volume EBS (gp2) | un volume gp2 **attaccato** | `ebs-gp2-upgrade` |
| Volume EBS | un volume **attaccato** con zero I/O per 48h | `ebs-idle` |
| Snapshot EBS | uno snapshot il cui volume sorgente è stato cancellato | `ebs-snapshot` |
| Istanza RDS | un'istanza **ferma** | `rds-instance` |
| Istanza RDS | un'istanza **available** con CPU bassa per 14+ giorni | `rds-underutilized` |
| Load balancer | un ALB/NLB senza target registrati | `load-balancer` |

### Lanciarlo

```sh
pnpm nx run-many -t build
CLOUDRIFT_VERIFY_AWS_SANDBOX=1 pnpm verify:aws -- --region us-east-1
```

Lo script si rifiuta di partire senza `CLOUDRIFT_VERIFY_AWS_SANDBOX=1` (per evitare un run accidentale contro un profilo default/produzione) e senza credenziali AWS risolvibili (verificate via STS `GetCallerIdentity`).

Per ogni scanner stampa: il kind, il numero di finding, il costo mensile stimato totale, i primi 5 finding (id + motivo + costo) ed eventuali errori. Da controllare a occhio: `region`, `monthlyCostUsd`, `wasteReason`.

### Quando va eseguito

Una volta all'atterraggio della fase 3 (la piramide dei test completa), poi solo quando cambiano i parametri dei filtri CloudWatch (`Namespace`, `Dimensions`, `Period`, `Statistics`) o le query di pricing — sono le parti che nessun mock può validare contro il comportamento reale di AWS.
