# Come funziona il codice

> 🇬🇧 [English version](../en/how-it-works.md)

Questo documento descrive il flusso completo di esecuzione, dall'invocazione CLI fino alla risposta AWS e alla visualizzazione dei risultati.

---

## Flusso di esecuzione end-to-end

```
utente: cloudrift analyze -r us-east-1 eu-west-1 [--format json|markdown] [--pdf] [--live-pricing]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js fa il parse degli argomenti
          │
          ▼
     analyze-waste.command.ts  (orchestra opzioni/config/output)
     1. loadConfig() — cloudrift.config.json / .cloudriftrc / --config
     2. AwsRegion.parse() per regione; config.excludeRegions filtrate via
     3. accountId: --account-id oppure STS GetCallerIdentity
          │
          ▼
     analyze-waste.composition.ts  (composition root: costruisce pricing + scanner)
     4. Pricing: tabella statica ← live API (--live-pricing) ← config.prices (vincono)
     5. Istanzia policy (config + flag) e 15 dei 18 scanner
        (gli altri tre — EC2/RDS underutilized, ElastiCache idle —
         solo con --live-pricing: prezzo per tipo non nel listino statico)
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Esegue gli scanner registrati in parallelo (Promise.all, uno per ResourceKind),
     ogni scanner itera le regioni in sequenza
          │
     ┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
     ▼             ▼             ▼             ▼             ▼             ▼
   EC2 API       RDS API      ELBv2 API     S3+CW API    Lambda+CW     EFS+CW API
  (volumi,      (istanze,     (target       (bucket,     API          (file system,
   istanze,      underutil.*)  group/       lifecycle)   (funzioni,    mount target,
   snapshot,                   health)                    invocazioni)  I/O)
   NAT, ENI,
   underutil.*)
     │
     ▼
  DynamoDB API           CloudWatch Logs API     ElastiCache+CW+Pricing API
  (tabelle, capacità)    (log group, retention)  (cluster, connessioni)*
          │        (* CW=CloudWatch, max 5 concorrenti; scanner con prezzo on-demand
          │         — EC2/RDS underutilized, ElastiCache idle — registrati solo
          │         con --live-pricing, perché il listino statico non ha un prezzo per tipo)
          ▼
     Ogni scanner applica la waste policy di dominio
     (grace period, tag di esclusione, criteri specifici)
          │
          ▼
     WastedResourcesSummary { findings: WastedResource[],
                              totalWasteMonthlyUsd,
                              totalOptimizationMonthlyUsd, scanErrors }
          │
          ▼
     --format sceglie lo stdout: table (default) | json | markdown
     --pdf / --json [file] scrivono artefatti aggiuntivi su disco
     totalWasteMonthlyUsd > config.costAlertThresholdUsd → exit code 2 (gate CI)
     (totalOptimizationMonthlyUsd, essendo stimato/advisory, non fa mai da gate)
```

---

## Dettaglio componente per componente

### `main.ts` — Entry point

```typescript
program
  .command('analyze')
  .option('-r, --regions <regions...>', 'AWS regions to scan', ['us-east-1'])
  .option('--account-id <id>', 'AWS account ID override (auto-detected via STS when omitted)')
  .option('--min-age-days <days>', 'grace period …', '7')
  .option('--ignore-tag <tag>', 'resources carrying this tag are excluded …', 'cloudrift:ignore')
  .option('--pdf [filename]', 'Export a PDF report …')
  .option('--json [filename]', 'Output the report as JSON …')
  .action(analyzeWasteCommand);
```

`--pdf` e `--json` accettano un filename opzionale. `--json` senza filename stampa **solo** il JSON su stdout (l'output tabellare viene soppresso), così il comando è componibile: `cloudrift analyze --json | jq '.totalWasteMonthlyUsd'`.

---

### `analyze-waste.command.ts` — Orchestrazione

Risolve le opzioni CLI in config + regioni + account ID, delega la costruzione di pricing/scanner a `analyze-waste.composition.ts` tramite il seam iniettabile `AnalyzeDeps.createAnalysis` (lo stesso fake usato da `analyze-waste.command.spec.ts` per testare senza AWS), poi renderizza il formato scelto e scrive gli artefatti `--json`/`--pdf`.

### `analyze-waste.composition.ts` — Composition root

L'unico punto dove le implementazioni concrete vengono istanziate e iniettate:

```typescript
const regions: AwsRegion[] = [];
for (const code of options.regions) {
  const parsed = AwsRegion.parse(code);          // Result, niente throw sull'input utente
  if (!parsed.ok) return fail(parsed.error.message);
  regions.push(parsed.value);
}

const accountId = options.accountId ?? (await resolveAwsAccountId()) ?? 'unknown';

const pricing = new StaticPriceTableAdapter();
const policyOptions = { minAgeDays, ignoreTag: options.ignoreTag };

const scanners: WasteScannerPort[] = [
  new AwsEbsVolumeScanner(pricing, accountId, new EbsVolumeWastePolicy(policyOptions)),
  new AwsElasticIpScanner(pricing, accountId, new ElasticIpWastePolicy(policyOptions)),
  // … gli altri 13 scanner sempre registrati (rds, lb, ec2, snapshot, nat, gp2-upgrade,
  // ebs-idle, log-group, eni-orphaned, s3-no-lifecycle, lambda-underutilized, efs-unused,
  // dynamodb-overprovisioned)
];

// EC2/RDS underutilized e ElastiCache idle richiedono un prezzo per tipo (disponibile
// solo live): registrati condizionalmente, non fanno parte dei 15 di base.
if (livePricingAdapter) {
  scanners.push(new AwsEc2UnderutilizedScanner(livePricingAdapter, accountId, new Ec2UnderutilizedPolicy(policyOptions)));
}

const useCase = new AnalyzeCloudWasteUseCase(scanners);
const result = await useCase.execute({ regions });
```

L'account ID viene risolto via `sts:GetCallerIdentity` con le stesse credenziali della scansione; `--account-id` resta come override e `'unknown'` è il fallback se STS non è raggiungibile.

---

### `AnalyzeCloudWasteUseCase` — Coordinatore generico

```typescript
await Promise.all(
  this.scanners.map(async (scanner) => {
    for (const region of request.regions) {        // sequenziale per regione
      const result = await scanner.scan(region);
      if (result.ok) findings.push(...result.value);
      else scanErrors.push({ kind: scanner.kind, region: region.code, error: result.error });
    }
  }),
);
```

Tre proprietà da notare:

1. **Generico**: il coordinatore non conosce i tipi di risorsa; aggiungere uno scanner non lo modifica.
2. **Granularità d'errore per (scanner, regione)**: se `eu-west-1` non è abilitata, i risultati di `us-east-1` per lo stesso tipo di risorsa sopravvivono, e l'errore riporta sia il kind sia la regione.
3. **Profilo di concorrenza**: parallelo tra tipi di risorsa (API diverse), sequenziale tra regioni dello stesso tipo (stessa API in regioni diverse) — per rispettare i rate limit AWS.

Il costo totale è la somma dei `costEstimate` dei findings; i tipi falliti semplicemente non contribuiscono (e il report segnala l'incompletezza).

---

### Gli scanner (es. `AwsEbsVolumeScanner`)

Ogni scanner implementa `WasteScannerPort` e segue lo stesso schema:

1. Crea il client AWS per la regione.
2. Raccoglie i **candidati** con `paginate()` (le API AWS restituiscono max 1000 elementi per pagina), pre-filtrando lato server dove possibile (`status=available`, `state-name=stopped`, …). Il prefiltro è un'ottimizzazione: produce un sovrainsieme.
3. Mappa le risposte alle entità di dominio, calcolando il costo via `PricingPort` e impostando `accountId` e `detectedAt`.
4. **Applica la waste policy di dominio** — è qui che grace period, tag di esclusione e criteri specifici decidono cosa è davvero spreco.
5. Wrappa gli errori SDK in `AwsAdapterError` e distrugge il client nel `finally`.

```typescript
const volumes = rawVolumes
  .map((v) => new EbsVolume({ /* mapping campi AWS → entità */ }))
  .filter((volume) => this.policy.evaluate(volume, now).isWaste);
```

#### `AwsEc2InstanceScanner` — Due chiamate + data di stop

`DescribeInstances` non riporta la dimensione dei volumi: una seconda chiamata `DescribeVolumes` risolve dimensioni e tipi (saltata se non ci sono istanze ferme). La data di stop viene ricostruita da `StateTransitionReason` (stringa `"User initiated (2026-06-01 12:34:56 GMT)"`): è ciò che permette alla policy di applicare il grace period sul momento dello stop e non sul launch time.

#### `AwsEbsSnapshotScanner` — Tre sorgenti in parallelo

```
DescribeSnapshots(OwnerIds: self)  ┐
DescribeVolumes()                  ├─ Promise.all
DescribeImages(Owners: self)       ┘
```

Set dei volumi esistenti → `sourceVolumeExists`; mappa snapshot→AMI dai `BlockDeviceMappings` delle immagini → `boundToAmiId`. La policy esclude gli snapshot il cui volume esiste ancora, quelli referenziati da AMI (non cancellabili) e quelli recenti.

#### `AwsNatGatewayScanner` — EC2 + CloudWatch con concorrenza limitata

Per ogni gateway `available`, interroga `GetMetricStatistics(BytesOutToDestination, 48h, Sum)`. Le chiamate CloudWatch passano per `mapWithConcurrency(…, 5, …)`: su un account con 100 NAT si hanno al massimo 5 chiamate in volo, evitando il throttling. I bytes osservati finiscono nell'entità (`bytesOutLastWindow`), e la decisione "idle" è della policy.

#### `AwsLoadBalancerScanner` — Conteggio target

Per ogni ALB/NLB conta i target registrati attraverso `DescribeTargetGroups` + `DescribeTargetHealth` (più preciso del solo "esistono target group": un TG può essere vuoto). Il conteggio finisce nell'entità (`registeredTargetCount`); la policy decide.

#### `AwsEbsIdleScanner` — Attaccato ma senza I/O

Distinto da `AwsEbsVolumeScanner` (volumi non attaccati): questo elenca i volumi `in-use` e somma `VolumeReadOps` + `VolumeWriteOps` da CloudWatch sulla finestra (48h default), tramite lo stesso limite `mapWithConcurrency(…, 5, …)` dello scanner NAT. Un volume con zero operazioni totali è "idle" — storage pagato attaccato a un'istanza che non tocca mai il disco. La soglia di `EbsIdlePolicy` (`maxOps`, default 0) è configurabile via `config.thresholds.ebsIdleMaxOps`.

#### `AwsEc2UnderutilizedScanner` — Rightsizing basato su CPU, solo advisory

Elenca le istanze `running`, recupera `CPUUtilization` (`Average`, `Maximum`) su una finestra configurabile (`config.utilizationWindowHours`, default 168h = 7 giorni, max 336h = 14 giorni), e risolve il prezzo mensile dell'istanza **on demand** dall'AWS Pricing API (implementa `Ec2InstancePricingSource` per duck typing contro `AwsPricingApiAdapter`) — lo spazio dei prezzi per instance type è troppo grande per il listino statico. Senza `--live-pricing` non c'è un prezzo da risolvere, quindi il composition root non registra affatto questo scanner (vedi sopra la sezione sul composition root). La stima di risparmio è metà del costo mensile dell'istanza (`RIGHTSIZE_SAVING_FRACTION = 0.5`, un'euristica da downsize di un tier) ed è marcata `estimated: true` in `RESOURCE_KIND_META`: una CPU bassa da sola non conferma che RAM/rete siano altrettanto inutilizzate.

#### `AwsRdsUnderutilizedScanner` — Rightsizing basato su CPU, solo advisory

Stesso pattern di `AwsEc2UnderutilizedScanner`, applicato a RDS. Elenca le istanze `available` (filtro server-side, disgiunto da `AwsRdsInstanceScanner` che filtra su `stopped`), recupera `CPUUtilization` dal namespace `AWS/RDS` (`Average`, `Maximum`) sulla stessa finestra configurabile (`config.utilizationWindowHours`), e risolve il prezzo mensile **on demand** dall'AWS Pricing API (implementa `RdsInstancePricingSource` per duck typing contro `AwsPricingApiAdapter`, che mappa l'engine di `DescribeDBInstances` — es. `postgres` — al valore `databaseEngine` del Pricing API — `PostgreSQL` — e usa `deploymentOption` per Single-AZ/Multi-AZ; engine senza mappatura, come Aurora, restituiscono `undefined`). Senza `--live-pricing` lo scanner non viene registrato, per lo stesso motivo dello scanner EC2. Stessa stima di risparmio (metà del costo mensile, `RIGHTSIZE_SAVING_FRACTION = 0.5`) e stesso flag `estimated: true`: una CPU bassa non conferma che storage I/O o connessioni siano altrettanto inutilizzati.

#### `AwsS3NoLifecycleScanner` — Risorsa globale filtrata per regione

I bucket S3 sono **globali**, non per-regione: `ListBucketsCommand({ BucketRegion: region.code })` usa il filtro per regione (disponibile dal 2024+) così ogni scan regionale vede solo i bucket che gli appartengono davvero — senza di esso, lo stesso bucket verrebbe segnalato una volta per ogni regione scansionata. Per ogni bucket chiama `GetBucketLifecycleConfiguration`, trattando l'errore con nome `NoSuchLifecycleConfiguration` come "nessuna policy" (qualunque altro errore si propaga e fa fallire lo scan), e legge `BucketSizeBytes` da CloudWatch (`AWS/S3`, metrica giornaliera, `StorageType=StandardStorage`). Il risparmio stimato è una frazione fissa (`ESTIMATED_SAVING_FRACTION = 0.4`) del costo storage Standard corrente — advisory, perché non sappiamo quali oggetti siano davvero freddi.

#### `AwsEfsUnusedScanner` — Non serve `DescribeMountTargets`

`DescribeFileSystems` restituisce già `NumberOfMountTargets` e `SizeInBytes` per ogni file system, quindi a differenza di un'implementazione naive questo scanner non ha bisogno di una seconda chiamata API per sapere se un file system è raggiungibile. CloudWatch (`DataReadIOBytes` + `DataWriteIOBytes`, sommati) viene interrogato solo per i file system che **hanno** un mount target — un file system orfano (zero mount target) è spreco per definizione e la chiamata alla metrica viene saltata del tutto.

#### `AwsDynamoDbOverprovisionedScanner` — Fan-out a due livelli

L'unico scanner che ha bisogno di un fan-out **prima** di CloudWatch: `ListTables` restituisce solo i nomi delle tabelle, quindi una chiamata `DescribeTable` per nome (limitata via `mapWithConcurrency`) risolve `BillingModeSummary`/`ProvisionedThroughput`, necessari per decidere se una tabella sia anche solo `PROVISIONED` (vs `PAY_PER_REQUEST`, che viene saltata — non c'è capacità fissa di cui essere "in eccesso"). Solo a quel punto recupera `ConsumedReadCapacityUnits`/`ConsumedWriteCapacityUnits` per le tabelle provisioned. L'utilizzo è `consumato / secondiFinestra / provisioned`; la policy segnala una tabella solo quando **sia** l'utilizzo read **sia** quello write sono sotto soglia (una tabella read-heavy e write-light è dimensionata correttamente per la sua dimensione più pesante, non overprovisioned).

#### `AwsElastiCacheIdleScanner` — Costo reale, gated su live-pricing come EC2/RDS

Elenca i cluster, somma `CurrConnections` nella finestra — zero connessioni è un segnale di idle inequivocabile (a differenza delle euristiche basate su CPU, non serve calibrare una soglia). A differenza di Lambda (genuinamente $0 se inattiva), un nodo ElastiCache è fatturato per ora indipendentemente dall'uso, quindi qui si tratta di soldi reali — ma lo spazio dei node type è ampio quanto quello EC2, da cui la stessa risoluzione on-demand dalla Pricing API (`getElastiCacheNodePricePerMonth`, duck-typed come `Ec2InstancePricingSource`) e lo stesso gate `--live-pricing`. Poiché il prezzo, una volta risolto, è esatto e non una frazione euristica, il kind è `estimated: false` e categoria `waste` — l'unico scanner gated su live-pricing che non è advisory.

---

### Entità e Value Object

Tutte le entità implementano `WastedResource` e congelano le props (`Object.freeze`). Oltre ai campi comuni (`accountId`, `detectedAt`, `tags`, `monthlyCostUsd`), ogni entità porta i fatti che servono alla sua policy:

```typescript
// Esempi dei "fatti" per le decisioni
LoadBalancer.registeredTargetCount         // → isIdle()
NatGateway.bytesOutLastWindow              // → isIdle()
EbsSnapshot.sourceVolumeExists             // → isOrphan()
EbsSnapshot.boundToAmiId                   // → non cancellabile
Ec2Instance.stoppedSince                   // → grace period sullo stop reale
IdleEbsVolume.totalOps()                   // readOps + writeOps → EbsIdlePolicy
UnderutilizedEc2Instance.maxCpuPercent     // → Ec2UnderutilizedPolicy
EfsFileSystem.numberOfMountTargets         // → hasNoMountTargets()
OverprovisionedDynamoDbTable.avgReadUtilizationPercent  // consumato/provisioned/finestra
IdleElastiCacheCluster.connectionsLastWindow            // → isIdle()
```

`CostEstimate.of(monthlyCostUsd, description)` è l'unico factory: il calcolo dei prezzi vive nell'infrastruttura (`StaticPriceTableAdapter` + `prices.json`), mai nel domain.

---

### Formatter

I tre formatter condividono il registry `resource-presenters.ts` (CLI):

```typescript
type PresenterMap = { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ebs-volume': { title, head, colWidths, row(v), recommend(v) },
  // … il mapped type impone l'esaustività: una chiave mancante è un errore di compilazione
};
```

- **Tabella console** (`waste-report.table-formatter.ts`): itera `RESOURCE_KINDS`, usa `groupByKind(findings)` e il presenter per intestazioni e righe. In coda: warning per (kind, regione), il totale waste, una riga separata "Optimization opportunities" quando `totalOptimizationMonthlyUsd > 0`, e disclaimer con la data del listino prezzi.
- **PDF** (`waste-report.pdf-formatter.ts`): pagina executive summary (totali, breakdown, top 8 raccomandazioni da `presenter.recommend`) + una pagina per kind. Il totale optimization è evidenziato separatamente, con una nota che le voci `estimated` vanno verificate. `drawTable` gestisce il **salto pagina**: quando una tabella supera il margine inferiore, chiude il bordo, apre una nuova pagina e ridisegna l'header.
- **JSON** (`waste-report.json-formatter.ts`): serializza `toWasteReportDto(summary, meta)` — il contratto dati per dashboard, CI o un futuro frontend. Ogni finding porta il proprio `category` e il flag `estimated`.
- **Markdown** (`waste-report.markdown-formatter.ts`): un report pronto per le Pull Request (totali, breakdown, `<details>` collassabile per kind, raccomandazioni principali, callout sulla soglia di costo, una riga separata "Total optimization") per `--format markdown` in CI.

`--format` (`table` | `json` | `markdown`) sceglie cosa va su stdout; `--pdf` / `--json [filename]` scrivono file aggiuntivi. Nei formati machine-readable il chrome umano va su stderr, così su stdout resta solo il report.

---

## Risoluzione dei prezzi

I costi sono risolti per `(regione, chiave)` da tre livelli costruiti nel composition root, vince il più specifico:

```
prices.json (statico, sempre presente)
   ← AWS Pricing API (solo con --live-pricing)
   ← config.prices (override utente, vincono)
```

Tutte e tre condividono la stessa forma `PriceTable` (`regione → { chiave: USD }` con fallback `default`), quindi si compongono con un semplice `mergePriceTables`. Poiché il merge avviene **prima** dello scan, i getter di `PricingPort` restano sincroni e gli scanner non cambiano.

- **`AwsPricingApiAdapter.warmUp(regions)`** recupera i prezzi di listino (`@aws-sdk/client-pricing`) e materializza una tabella. Accetta un prezzo **solo se i filtri risolvono un valore unico** (ambiguo → omesso → lo riempie lo statico); qualunque errore fa ricadere il chiamante interamente sulla tabella statica con un warning — mai un crash.
- **`config.prices`** sono le tariffe negoziate/aziendali dell'utente e vincono su entrambi. Sono l'unico modo per far combaciare il report con la bolletta reale — anche i prezzi live sono prezzi di *listino* AWS, non la tua fattura.
- `getPricesAsOf()` riflette il livello usato: la data dello statico, quella del fetch live, o `… + custom overrides`.

**Eccezione: `AwsEc2UnderutilizedScanner`, `AwsRdsUnderutilizedScanner` e `AwsElastiCacheIdleScanner`.** I prezzi per instance type/classe/node type non sono in `prices.json` (troppi tipi distinti da mantenere) e non vengono pre-caricati da `warmUp()`. Questi tre scanner chiamano invece direttamente `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` / `getRdsInstancePricePerMonth(region, instanceClass, engine, deploymentOption)` / `getElastiCacheNodePricePerMonth(region, cacheNodeType)`, on demand, per ogni tipo distinto trovato — per questo sono gli unici tre scanner che richiedono `--live-pricing` per essere registrati affatto, invece di degradare al listino statico come gli altri. DynamoDB non è un'eccezione: i prezzi RCU/WCU sono uniformi per regione (non per-tipo-di-tabella), quindi stanno in `prices.json` come qualunque altro prezzo statico.

## Integrazione CI/CD

Tre elementi rendono il tool nativo per le pipeline:

1. **`--format markdown`** produce un report pronto per le Pull Request (totali, breakdown, raccomandazioni, callout soglia) — instradalo in `$GITHUB_STEP_SUMMARY` o pubblicalo come commento PR.
2. **`config.costAlertThresholdUsd`** imposta un budget: quando `totalWasteMonthlyUsd` lo supera, il comando imposta **exit code 2**, facendo fallire il job CI. `totalOptimizationMonthlyUsd` non fa mai da gate — è una cifra stimata/advisory. L'alert va su stderr, così non sporca mai lo stdout machine-readable.
3. **stdout pulito** — nei formati `json`/`markdown` tutti i messaggi umani vanno su stderr, quindi `cloudrift … --format json | jq` e `… --format markdown >> "$GITHUB_STEP_SUMMARY"` sono sicuri.

Il file di config (`cloudrift.config.json`) viene cercato nella working directory: committarlo alla root del repo fa sì che la CI lo prenda automaticamente dopo il checkout.

---

## Come vengono gestite le credenziali AWS

L'SDK AWS v3 usa la **catena di credenziali predefinita**:

1. Variabili d'ambiente (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. File `~/.aws/credentials` (profilo `default` o `AWS_PROFILE`)
3. IAM Instance Profile (se si esegue su EC2)
4. ECS Task Role / EKS Service Account

Le stesse credenziali servono per `sts:GetCallerIdentity` (account ID automatico). La regione viene passata esplicitamente a ogni scanner tramite `AwsRegion`.

---

## Struttura dei test

- **Domain** — pura logica, zero dipendenze: entità, value object e soprattutto le **policy** (grace period, tag, AMI, finestre di traffico) con date fisse e deterministiche.
- **Application** — il coordinatore è testato con scanner finti in-memory:
  ```typescript
  const scanner: WasteScannerPort = {
    kind: 'ebs-volume',
    scan: async () => Result.ok([makeVolume('vol-1')]),
  };
  ```
  Nessun framework di mock. I casi coprono aggregazione, errori per (kind, regione) e conservazione dei risultati parziali. `toWasteReportDto` ha un test di round-trip JSON.
- **Scanner (infrastruttura)** — il modulo AWS SDK è mockato con `jest.mock(...)`; i test verificano mapping, filtri server-side, paginazione, gestione errori, `destroy()` dei client e l'applicazione delle policy (risorsa recente → esclusa, tag → esclusa). Per le chiamate multi-comando i mock instradano sul tipo di `Command` ricevuto.

> Nota: questi test mockano l'SDK, quindi validano il *nostro* codice, non l'integrazione reale con AWS. Un'eventuale suite d'integrazione contro LocalStack sarebbe il prossimo investimento sensato sul fronte qualità.
