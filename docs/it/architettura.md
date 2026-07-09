# Architettura di cloudrift

> 🇬🇧 [English version](../en/architecture.md)

## Panoramica

cloudrift adotta un'architettura a strati ispirata al **Domain-Driven Design (DDD)** e all'**Architettura Esagonale** (Ports & Adapters), organizzata attorno a un **modello a plugin**: il concetto centrale del dominio è la _risorsa sprecata_ (`WastedResource`), e ogni tipo di risorsa AWS è un plugin (`WasteScannerPort`) che il coordinatore esegue in modo generico.

Questa scelta compra due cose, e vale la pena essere espliciti su quali:

1. **Testabilità senza AWS** — domain e application si testano con scanner finti in-memory, senza SDK né credenziali.
2. **Aggiunta di nuovi tipi di risorsa a costo costante** — un nuovo tipo non tocca il coordinatore, il summary né il DTO del report (vedi [aggiungere-risorsa.md](./aggiungere-risorsa.md)).

Ciò che **non** compra da sola è il multi-cloud: vedi la sezione [Verso il multi-cloud](#verso-il-multi-cloud) per il percorso onesto.

---

## Struttura dei layer

```
┌──────────────────────────────────────────────────────────┐
│                        apps/cli                          │
│   (entry point Commander.js, presenter, composition root)│
└───────────────────────────┬──────────────────────────────┘
                            │ dipende da
┌───────────────────────────▼──────────────────────────────┐
│              libs/cloud-cost/application                 │
│   (AnalyzeCloudWasteUseCase generico, WasteReportDto)    │
└──────┬──────────────────────────────────────┬────────────┘
       │ dipende da                           │ dipende da
┌──────▼──────────────────┐   ┌──────────────▼────────────┐
│  libs/cloud-cost/domain │   │  libs/shared/kernel       │
│  (WastedResource, entità│   │  (Entity, ValueObject,    │
│   waste policies, ports)│   │   Result, DomainError)    │
└──────▲──────────────────┘   └───────────────────────────┘
       │ implementa WasteScannerPort (×29)
┌──────┴──────────────────────────────────────────────────┐
│        libs/cloud-cost/infrastructure/aws-adapter       │
│   (scanner AWS SDK v3, pricing, STS account resolver)   │
└─────────────────────────────────────────────────────────┘
```

**Regola fondamentale:** le dipendenze puntano sempre verso l'interno (verso il domain). Il domain non sa nulla di AWS SDK, Commander.js o pdfkit.

---

## Perché DDD e Architettura Esagonale?

### Testabilità

Il domain e il use case si testano **senza nessuna dipendenza AWS**: le policy sono funzioni pure su entità con date deterministiche, e il coordinatore si testa con scanner finti in-memory (`{ kind, scan: async () => Result.ok([...]) }`). Niente framework di mock, test veloci e deterministici. È il beneficio principale e quello che da solo giustifica le porte.

### Il dominio è il prodotto

La definizione di "spreco" — periodi di grazia, tag di esclusione, snapshot non cancellabili perché legati ad AMI, finestre di traffico — è la vera proprietà intellettuale del tool, e cambia più spesso del codice AWS. Tenerla in policy di dominio esplicite, separate dai dettagli SDK, significa poterla evolvere e testare senza toccare l'infrastruttura. Se queste regole vivessero nei filtri delle chiamate API (com'era in origine), ogni ritocco a una soglia richiederebbe di ragionare su paginazione e client AWS.

### Estensibilità a costo costante

L'esagonale qui prende la forma di un modello a plugin: ogni tipo di risorsa è una `WasteScannerPort`. Aggiungere un tipo non tocca il coordinatore, il summary, il DTO né i formatter (vedi [aggiungere-risorsa.md](./aggiungere-risorsa.md)) — il punto di modifica rimasto è la union `ResourceKind`, una riga che il compilatore usa per guidarti sui punti da completare.

### Sostituibilità — nei limiti onesti

Le porte rendono sostituibile la **tecnologia**, non il **dominio**: si può cambiare la sorgente dei prezzi (statico → AWS Pricing API) o aggiungere un entry point (CLI → HTTP) senza toccare il core. Il multi-cloud invece non è "gratis" — richiede nuove entità, policy e listini — ma l'architettura garantisce che il core non si tocchi: il percorso è descritto in [Verso il multi-cloud](#verso-il-multi-cloud).

### Separazione delle responsabilità

- Il **domain** SA cosa è "sprecato" (entità + waste policies)
- L'**application** SA come coordinare la scansione e proiettare il report
- L'**infrastruttura** SA come parlare con AWS (paginazione, client, rate limit)
- La **CLI** SA come mostrarlo (presenter, tabella, PDF, JSON)

**Il trade-off, dichiarato:** per un tool di questa taglia l'architettura è più struttura del minimo indispensabile — un singolo script farebbe la stessa scansione. Ripaga perché il dominio (le policy) è destinato a crescere, perché i tipi di risorsa aumentano nel tempo, e perché le presentazioni si moltiplicano (terminale, PDF, JSON, domani un frontend). Se nessuna di queste tre direttrici fosse vera, questa architettura sarebbe sovradimensionata.

---

## I layer in dettaglio

### 1. `shared/kernel` — Nucleo condiviso

- **`Entity<TId>`**: classe base per oggetti con identità.
- **`ValueObject<T>`**: oggetti immutabili con uguaglianza strutturale (`AwsRegion`, `CostEstimate`), confrontati con un `deepEqual` ricorsivo — vedi [ADR-0046](../adr/0046-valueobject-deepequal.md).
- **`Result<T, E>`**: successo/fallimento come valore, senza eccezioni attraverso i layer.
- **`DomainError`**: errori tipizzati con `code` esplicito, per il layer di dominio.
- **`InfrastructureError`**: gerarchia sorella di `DomainError`, stessa forma, per i fallimenti del layer infrastrutturale (es. `AwsAdapterError`) — tenuta separata perché i tipi di errore del domain non devono implicare una conoscenza di AWS che non hanno ([ADR-0049](../adr/0049-infrastructureerror-not-domainerror.md)).
- **`createLogger(namespace)`**: logger di debug senza dipendenze, attivato dalla variabile d'ambiente `DEBUG`, scrive su stderr ([ADR-0047](../adr/0047-minimal-namespaced-debug-logger.md)).

### 2. `cloud-cost/domain` — Il cuore del sistema

#### Il modello unificante: `WastedResource` e `ResourceKind`

```typescript
export const RESOURCE_KINDS = [
  'ebs-volume',
  'elastic-ip',
  'rds-instance',
  'load-balancer',
  'ec2-instance',
  'ebs-snapshot',
  'nat-gateway',
  'ebs-gp2-upgrade',
  'ebs-idle',
  'ec2-underutilized',
  'rds-underutilized',
  'log-group',
  'eni-orphaned',
  's3-no-lifecycle',
  'lambda-underutilized',
  'efs-unused',
  'dynamodb-overprovisioned',
  'elasticache-idle',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
// Estratto illustrativo — oggi esistono 29 kind; la union e RESOURCE_KIND_META
// in wasted-resource.ts sono la fonte di verità, non questo documento.

export interface WastedResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly region: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  readonly costEstimate: CostEstimate;
  readonly wasteReason: string;
}
```

`WastedResource` è **l'unico tipo che attraversa il confine inbound**: coordinatore, summary, formatter e DTO dipendono da questa interfaccia, mai dalle entità concrete. La union `ResourceKind` è il singolo punto di estensione controllato dal compilatore: aggiungere un kind fa fallire il typecheck finché ogni consumer (presenter CLI, ecc.) non viene aggiornato. È OCP pragmatico: un punto di modifica esiste, ma è una riga ed è il compilatore a indicare tutti i punti da completare.

#### Spreco vs. ottimizzazione — `FindingCategory`

Non ogni finding è "cancella e smetti di pagare": `RESOURCE_KIND_META` (`wasted-resource.ts`) associa a ogni kind una `FindingCategory` (`'waste' | 'optimization'`) e un flag `estimated`:

```typescript
export const RESOURCE_KIND_META: Record<ResourceKind, ResourceKindMeta> = {
  'ebs-volume': { label: 'EBS Volumes', category: 'waste', estimated: false },
  // …
  'ebs-gp2-upgrade': { label: 'EBS gp2→gp3 Upgrades', category: 'optimization', estimated: false },
  'ec2-underutilized': { label: 'EC2 Instances (underutilized)', category: 'optimization', estimated: true },
  'rds-underutilized': { label: 'RDS Instances (underutilized)', category: 'optimization', estimated: true },
};
```

- **`waste`** — denaro speso ora, eliminabile cancellando/staccando la risorsa. Contribuisce a `totalWasteMonthlyUsd`, il numero principale e il gate CI (`costAlertThresholdUsd`).
- **`optimization`** — un'opportunità di risparmio che mantiene la risorsa (gp2→gp3, rightsizing EC2/RDS). Mostrata a parte come `totalOptimizationMonthlyUsd`, mai nel totale waste. `ec2-underutilized` e `rds-underutilized` sono inoltre `estimated: true`: una CPU bassa da sola non dimostra che anche RAM/rete (EC2) o storage I/O/connessioni (RDS) siano altrettanto inutilizzati, quindi la cifra è una stima euristica da verificare prima di agire, non un numero certo.

`RESOURCE_KIND_LABELS` è derivato da `RESOURCE_KIND_META` (unica fonte di verità) invece di essere mantenuto separatamente.

#### Entità

Le 18 entità (`EbsVolume`, `ElasticIp`, `RdsInstance`, `LoadBalancer`, `Ec2Instance`, `EbsSnapshot`, `NatGateway`, `Gp2Volume`, `IdleEbsVolume`, `UnderutilizedEc2Instance`, `RdsUnderutilizedInstance`, `LogGroup`, `OrphanedEni`, `S3Bucket`, `UnderutilizedLambdaFunction`, `EfsFileSystem`, `OverprovisionedDynamoDbTable`, `IdleElastiCacheCluster`) implementano `WastedResource` e portano i **fatti** osservati necessari alle decisioni: `LoadBalancer.registeredTargetCount`, `NatGateway.bytesOutLastWindow`, `EbsSnapshot.sourceVolumeExists` / `boundToAmiId`, `Ec2Instance.stoppedSince`, la somma di `VolumeReadOps`/`VolumeWriteOps` di `IdleEbsVolume`, `UnderutilizedEc2Instance.maxCpuPercent`, `RdsUnderutilizedInstance.maxCpuPercent`, `LogGroup.hasRetentionPolicy()`, `OrphanedEni.isOrphaned()` (`Status === 'available'`), `S3Bucket.hasLifecyclePolicy()`, `UnderutilizedLambdaFunction.invocationsLastWindow`, `EfsFileSystem.numberOfMountTargets` / `ioBytesLastWindow`, `OverprovisionedDynamoDbTable.avgReadUtilizationPercent` / `avgWriteUtilizationPercent`, `IdleElastiCacheCluster.connectionsLastWindow`. `Gp2Volume`, `UnderutilizedEc2Instance`, `RdsUnderutilizedInstance`, `S3Bucket`, `UnderutilizedLambdaFunction` e `OverprovisionedDynamoDbTable` sono opportunità di risparmio più che spreco da cancellare: il loro `costEstimate` porta il *risparmio* mensile stimato (o, per la segnalazione di igiene Lambda, un flat $0), non un costo effettivamente pagato.

#### Waste Policies — dove vive la conoscenza di business

La definizione di "spreco" **non** sta negli adapter né nei filtri delle API AWS: sta nelle policy di dominio (`libs/cloud-cost/domain/src/policies/`). La classe base `WastePolicy<T>` applica due regole trasversali:

- **Tag di esclusione** (`cloudrift:ignore`, configurabile): la risorsa è esclusa esplicitamente dall'utente.
- **Periodo di grazia** (`minAgeDays`, default 7): una risorsa troppo giovane non è spreco — un volume appena staccato, un LB appena creato o un NAT senza traffico da poche ore sono quasi sempre lavori in corso, non sprechi.

Ogni policy concreta aggiunge il criterio specifico del tipo:

| Policy                    | Criterio                                  | Guardia anti-falso-positivo                                                    |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `EbsVolumeWastePolicy`    | `state === 'available'`                   | grace su `createTime` (AWS non espone la data di detach)                       |
| `ElasticIpWastePolicy`    | nessuna association                       | — (gli EIP non hanno data di creazione)                                        |
| `RdsInstanceWastePolicy`  | `status === 'stopped'`                    | — (AWS riavvia da solo dopo 7 giorni: se è stopped, è recente per definizione) |
| `LoadBalancerWastePolicy` | zero target registrati                    | grace su `createdTime`                                                         |
| `Ec2InstanceWastePolicy`  | `state === 'stopped'`                     | grace su `stoppedSince` (da `StateTransitionReason`), fallback `launchTime`    |
| `EbsSnapshotWastePolicy`  | volume sorgente cancellato                | esclusi snapshot referenziati da AMI (non cancellabili); grace su `startTime`  |
| `NatGatewayWastePolicy`   | zero bytes in uscita nella finestra (48h) | grace su `createTime` (ambienti appena creati)                                 |
| `EbsIdlePolicy`           | volume attaccato (`in-use`), operazioni I/O totali ≤ `ebsIdleMaxOps` (default 0) nella finestra | grace su `createTime` (nessun I/O ancora ≠ idle) |
| `Ec2UnderutilizedPolicy`  | istanza running, CPU massima ≤ `ec2CpuPercent` (default 5) nella finestra | grace su `launchTime`; registrata solo con `--live-pricing` attivo (serve un prezzo per instance type) |
| `RdsUnderutilizedPolicy`  | istanza available, CPU massima ≤ `rdsCpuPercent` (default 5) nella finestra | grace su `instanceCreateTime`; registrata solo con `--live-pricing` attivo (serve un prezzo per instance class) |
| `Gp2UpgradePolicy`        | volume gp2 in uso (risparmio, non spreco) | solo `status=in-use` (i gp2 staccati restano a `ebs-volume`); grace su `createTime` |
| `LogGroupWastePolicy`     | nessuna retention policy configurata      | grace su `creationTime`                                                          |
| `OrphanedEniWastePolicy`  | `Status === 'available'` (non attaccata)  | — (le ENI non hanno data di creazione); costo $0 — igiene, non risparmio          |
| `S3NoLifecyclePolicy`     | nessuna lifecycle configuration           | grace su `creationDate`; risparmio stimato (`estimated: true`)                   |
| `LambdaUnderutilizedPolicy` | invocazioni ≤ `lambdaInvocationsMin` (default 0) nella finestra | grace su `lastModified`; costo $0 — Lambda pay-per-use non ha costo diretto se inattiva |
| `EfsUnusedPolicy`         | nessun mount target, oppure montato con I/O ≤ `efsIoBytesMin` (default 0) nella finestra | grace su `creationTime`                                |
| `DynamoDbOverprovisionedPolicy` | utilizzo read **e** write < `dynamoCapacityUtilizationPercent` (default 10%) nella finestra | grace su `creationDateTime`; risparmio stimato (`estimated: true`) |
| `ElastiCacheIdlePolicy`   | zero connessioni nella finestra           | grace su `createTime`; registrata solo con `--live-pricing` attivo (serve un prezzo per node type) |

`EbsIdlePolicy`, `Ec2UnderutilizedPolicy`, `RdsUnderutilizedPolicy`, `LambdaUnderutilizedPolicy`, `EfsUnusedPolicy` e `DynamoDbOverprovisionedPolicy` ricevono le soglie come parametri del costruttore (`ebsIdleMaxOps`, `ec2CpuPercent`, `rdsCpuPercent`, `lambdaInvocationsMin`, `efsIoBytesMin`, `dynamoCapacityUtilizationPercent`), configurabili via `config.thresholds`.

Le policy sono pura logica di dominio: si testano senza AWS, e i loro parametri arrivano dalla CLI (`--min-age-days`, `--ignore-tag`).

#### Ports

- **Outbound `WasteScannerPort`** — la porta unica della detection:
  ```typescript
  export interface WasteScannerPort {
    readonly kind: ResourceKind;
    scan(region: AwsRegion): Promise<Result<WastedResource[]>>;
  }
  ```
  Il contratto richiede che lo scanner restituisca solo risorse **già confermate** dalla relativa policy.
- **Outbound `PricingPort`** — un unico `getPrice(region: AwsRegion, key: string): number` generico (la stessa chiave usata in `prices.json` e negli override `prices` del config), più `getPricesAsOf()` (la data di verifica del listino, mostrata in ogni report). Ridotto da 16 metodi tipizzati nominalmente a questo unico metodo: aggiungere un tipo di risorsa a costo fisso ora tocca solo `prices.json`, mai la porta o i suoi adapter ([ADR-0045](../adr/0045-pricingport-single-getprice-method.md)).
- **Inbound `FindWastedResourcesUseCasePort`** — definisce `WastedResourcesSummary { findings, totalWasteMonthlyUsd, totalOptimizationMonthlyUsd, scanErrors }` e `ResourceScanError { kind, region, error }`. I due totali sono divisi per `FindingCategory` (vedi [sopra](#spreco-vs-ottimizzazione--findingcategory)): solo `totalWasteMonthlyUsd` alimenta il gate CI.

### 3. `cloud-cost/application` — Use case generico e DTO

`AnalyzeCloudWasteUseCase` riceve un **array di `WasteScannerPort`** e non sa quanti o quali siano:

```typescript
constructor(private readonly scanners: readonly WasteScannerPort[]) {}
```

Esegue gli scanner **in parallelo tra loro** e **in sequenza sulle regioni** (per non concentrare chiamate sulle stesse API regionali). Gli errori sono raccolti per coppia _(scanner, regione)_: il fallimento di una regione non scarta i risultati delle altre regioni né degli altri scanner. Il summary viene sempre restituito con i dati parziali e gli errori in `scanErrors`.

`toWasteReportDto()` proietta il summary in **`WasteReportDto`**, una struttura JSON-safe (solo primitivi e stringhe ISO): è il contratto dati per qualunque presentazione, presente e futura (vedi [Frontend-readiness](#frontend-readiness)).

### 4. `cloud-cost/infrastructure/aws-adapter` — Scanner concreti

Ogni scanner implementa `WasteScannerPort` con **AWS SDK v3**: crea il client per la regione (con `AWS_CLIENT_DEFAULTS`, `maxAttempts: 3` — il retry/backoff nativo dell'SDK per throttling ed errori transitori, [ADR-0050](../adr/0050-aws-client-retry-backoff.md)), usa `paginate()` per seguire i cursori, mappa le risposte alle entità (calcolando i costi via `PricingPort`), applica la waste policy e distrugge il client nel `finally`. Gli errori SDK sono wrappati in `AwsAdapterError`.

18 dei 29 scanner recuperano in più una metrica CloudWatch per risorsa (e, per 9 di essi, risolvono un prezzo live per-tipo). Questi estendono il template method astratto `CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity>` (`scanners/cloudwatch-idle.scanner.ts`), che possiede il lifecycle del client, il fan-out concorrente delle metriche e il wrapping in `Result` — ogni scanner concreto implementa solo gli hook specifici della risorsa (`listResources`, `fetchMetric`, `toEntity`, e opzionalmente `resolvePrices`). Vedi [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md).

I campi richiesti letti da una risposta AWS (l'identificatore primario della risorsa — `VolumeId`, `InstanceId`, …) sono validati con un `.filter()` a restringimento di tipo subito dopo il fetch, non con una non-null assertion: una entry malformata viene esclusa e loggata (`DEBUG=cloudrift:*`) invece di propagare silenziosamente un campo `undefined` in un finding. Vedi [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md).

Gli adapter pre-filtrano lato server dove possibile (es. `status=available` per gli EBS) come **ottimizzazione**: il filtro API produce un sovrainsieme dei candidati, la decisione finale è sempre della policy di dominio.

Particolarità:

- **`AwsNatGatewayScanner`**: le chiamate CloudWatch sono limitate a 5 concorrenti (`mapWithConcurrency`) per evitare throttling su account con molti gateway.
- **`AwsEbsSnapshotScanner`**: interroga anche `DescribeImages` per escludere gli snapshot legati ad AMI registrate.
- **`resolveAwsAccountId()`**: risolve l'account ID via `sts:GetCallerIdentity`, eliminando l'inserimento manuale (resta l'override `--account-id`).

### 5. `apps/cli` — Entry point e composition root

`analyze-waste.command.ts` carica il file di config, risolve le opzioni CLI (regioni, min-age, account ID) e orchestra l'esecuzione; delega l'istanziazione effettiva delle implementazioni concrete a `analyze-waste.composition.ts` tramite il seam iniettabile `AnalyzeDeps.createAnalysis` (lo stesso seam che `analyze-waste.command.spec.ts` finge per testare senza AWS). Prima di questo, risolve anche **quali scanner eseguire**: `--all-services` o `--scanners <kinds...>` saltano direttamente a un elenco risolto; altrimenti, in un vero terminale fuori da CI (e senza `--silent`), un wizard interattivo `@clack/prompts` (`apps/cli/src/wizard/scanner-selection.wizard.ts`, vedi [ADR-0041](../adr/0041-interactive-scanner-selection-wizard.md)) lascia scegliere all'utente — ogni kind pre-selezionato, così anche solo Invio scansiona comunque tutto; non-TTY/CI/`--silent` saltano il wizard ed eseguono ogni scanner, invariato rispetto a prima di questa funzionalità.

`analyze-waste.composition.ts` è l'unico punto in cui le implementazioni concrete vengono istanziate. È un registry dichiarativo, non una lista scritta a mano: `ALWAYS_ON_SCANNERS` e `LIVE_PRICING_SCANNERS` sono ciascuno un array di entry `{ kind, create(ctx) }`, e `buildScanners()` è un `map`/`filter` su entrambi (il secondo solo se è disponibile un adapter di live pricing), filtrato poi ancora secondo la selezione scanner risolta (`AnalysisContext.scannerKinds`, undefined = nessun filtro). `assertRegistryMatchesResourceKinds()` gira al module load e lancia un errore se un `ResourceKind` manca da entrambi i registry, o è duplicato tra i due — un errore di wiring fallisce all'avvio, non silenziosamente durante la scansione. Vedi [ADR-0043](../adr/0043-declarative-scanner-registry.md). Le entry di `LIVE_PRICING_SCANNERS` (`AwsEc2UnderutilizedScanner`, `AwsRdsUnderutilizedScanner`, `AwsElastiCacheIdleScanner` e gli equivalenti Redshift/OpenSearch/MSK/DocumentDB/Neptune/MQ/WorkSpaces) vengono costruite solo se `--live-pricing` è attivo: la loro stima di costo richiede un prezzo per instance type/classe/node type che il listino statico non contiene (troppi tipi distinti da mantenere), quindi senza prezzi live non c'è nulla di affidabile da riportare e gli scanner vengono esclusi piuttosto che registrati con una stima a zero.

Tornati in `analyze-waste.command.ts`, il risultato passa ai formatter. I quattro formatter (tabella console, PDF, JSON, Markdown) condividono il registry `resource-presenters.ts`, tipizzato `Record<ResourceKind, ResourcePresenter<…>>`: dimenticare il presenter di un nuovo kind è un errore di compilazione. Il formato di output si sceglie con `--format` (`table` | `json` | `markdown`); `markdown` è pensato per CI / commenti PR.

---

## Gestione degli errori

Il progetto usa `Result<T, E>` per gli errori attesi, **senza eccezioni attraverso i confini dei layer** — incluso l'input utente: `AwsRegion.parse()` restituisce `Result<AwsRegion, InvalidAwsRegionError>` e la CLI lo gestisce stampando un messaggio pulito ed uscendo con codice 1 (esiste anche `AwsRegion.create()` throwing, riservato a codici noti a compile time, es. fixture di test).

```
Scanner AWS ──Result.ok(findings)───▶ Use Case ──Result.ok(summary)──▶ CLI
            ──Result.fail(err)──────▶ Use Case ──scanErrors[{kind, region, error}]──▶ CLI (warning)
```

La granularità degli errori è **per (scanner, regione)**: un permesso mancante in una regione produce un warning per quella coppia e non tocca nient'altro.

---

## Verso il multi-cloud

Oggi il dominio del prodotto **è** lo spreco AWS: `EbsVolume`, `NatGateway` ed `ElasticIp` fanno legittimamente parte dell'ubiquitous language, e fingere il contrario produrrebbe astrazioni vuote. Detto questo, il refactoring verso `WastedResource` ha reso il percorso multi-cloud concreto e incrementale. Ecco come avverrebbe, in tre fasi:

### Fase 1 — Generalizzare il confine inbound (piccola)

L'unico tipo AWS-specifico che attraversa il confine inbound è `AwsRegion`. Si introduce un VO `CloudLocation { provider: 'aws' | 'gcp' | 'azure'; code: string }` (o si aggiunge `provider` a `WastedResource`), e `ResourceScanError.region` diventa una stringa qualificata. Coordinatore, summary, DTO e formatter **non cambiano**: dipendono già solo da `WastedResource`.

### Fase 2 — Nuovo bounded context o nuovi kind (la decisione vera)

Due opzioni, da scegliere quando esisterà il requisito reale:

- **Kind aggiuntivi nello stesso contesto** — `'gcp-persistent-disk'`, `'gcp-static-ip'`, … entrano nella union `ResourceKind` con le loro entità (`PersistentDisk`, non un finto `EbsVolume`), policy e scanner (`libs/cloud-cost/infrastructure/gcp-adapter`). Adatta se il prodotto resta "un report di spreco unificato". Il `Promise.all` del coordinatore scala da 18 a N scanner senza modifiche.
- **Bounded context separato** — `libs/gcp-cost/` con il proprio domain, se le semantiche divergono troppo. Condivide solo `shared/kernel`. La struttura `libs/<context>/` lo prevede già.

La prima opzione è quella raccomandata finché il report resta unificato: il costo marginale di un kind GCP è identico a quello di un kind AWS (entità + policy + scanner + presenter).

### Fase 3 — Composition root multi-provider

La CLI registra gli scanner di entrambi i provider nello stesso array:

```typescript
const scanners: WasteScannerPort[] = [
  ...buildAwsScanners(awsPricing, awsAccountId, policyOptions),
  ...buildGcpScanners(gcpPricing, gcpProjectId, policyOptions),
];
```

Il use case, il summary, il DTO e i formatter restano invariati — è questa la proprietà che l'architettura attuale garantisce davvero, ed è verificabile: nessuno di quei file menziona un servizio AWS.

**Cosa NON promettere:** che "basta scrivere un adapter". Servono entità GCP, policy GCP (le semantiche di spreco sono diverse: un Persistent Disk non ha lo stato `available` di EBS), un listino GCP e i presenter. L'architettura garantisce che il _core_ non si tocca, non che il lavoro sia gratis.

---

## Frontend-readiness

Oggi le presentazioni sono terminale e PDF; domani potrebbe esserci un frontend web. Il design lo prevede così:

```
                        ┌────────────► table-formatter ──► terminale
WastedResourcesSummary ─┼────────────► pdf-formatter ────► report.pdf
  (entità di dominio)   │
                        └─ toWasteReportDto() ─► WasteReportDto (JSON-safe)
                                                   │
                                                   ├─► json-formatter ──► stdout / file (--json)
                                                   └─► [futuro] HTTP adapter ──► frontend SPA
```

I punti che rendono il passaggio a un frontend un'aggiunta e non un refactoring:

1. **`WasteReportDto` è il contratto API già esistente.** È serializzabile (niente classi, niente `Date`, solo ISO string), versionabile e già esercitato in produzione dal flag `--json`. Un endpoint HTTP (`GET /api/waste-report`) restituirebbe esattamente questo DTO: il frontend non dipenderebbe mai dalle entità di dominio.
2. **Il use case è già headless.** `AnalyzeCloudWasteUseCase` non sa di essere dentro una CLI: un nuovo entry point (`apps/api` con Fastify/Hono, o una Lambda) è solo un altro composition root che istanzia gli stessi scanner e chiama lo stesso `execute()`.
3. **Niente logica nei formatter.** Tabelle, PDF e JSON sono proiezioni pure del summary/DTO; il frontend sarebbe la quarta proiezione, costruita su `breakdown`, `findings` e `scanErrors` del DTO (che contengono già label, reason e costi pronti per il rendering).

Passi concreti quando servirà: creare `apps/api` (nuovo progetto Nx) con un endpoint che esegue il use case e restituisce il DTO; aggiungere autenticazione/caching nell'adapter HTTP (non nel core); il frontend (React/Vue in `apps/web`) consuma il DTO tipizzato importando `WasteReportDto` da `cloud-cost-application` — il tipo è già esportato.

---

## Bounded Context

Al momento esiste un solo bounded context: **cloud-cost**. La struttura `libs/<context>/{domain,application,infrastructure}` consente di aggiungerne altri (es. `gcp-cost`, o contesti non di costo come `security-posture`) condividendo solo `shared/kernel`.
