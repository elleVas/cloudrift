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
     analyze-waste.command.ts  (composition root)
     1. loadConfig() — cloudrift.config.json / .cloudriftrc / --config
     2. AwsRegion.parse() per regione; config.excludeRegions filtrate via
     3. accountId: --account-id oppure STS GetCallerIdentity
     4. Pricing: tabella statica ← live API (--live-pricing) ← config.prices (vincono)
     5. Istanzia policy (config + flag) e 9 degli 11 scanner
        (gli altri due, EC2/RDS underutilized, solo con --live-pricing)
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Esegue gli scanner registrati in parallelo (Promise.all),
     ogni scanner itera le regioni in sequenza
          │
     ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    │ (uno per ResourceKind)
   EBS  EIP  RDS  ELB  EC2  Snap  NAT  gp2  EBS  EC2  RDS  │
  scan  scan scan scan scan scan scan scan  idle under- under-│
     │    │    │    │    │    │    │    │   scan util*  util* │
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EC2  EC2  RDS ELBv2 EC2* EC2** EC2+CW EC2 EC2+CW EC2+CW RDS+CW
  API  API  API  API  API  API   API   API  API   +Pricing +Pricing
          │        (* 2 chiamate; ** 3 chiamate; CW=CloudWatch, max 5 concorrenti)
          │        (EC2/RDS underutilized: registrati solo con --live-pricing — serve
          │         un prezzo per instance type/classe che il listino statico non ha)
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

### `analyze-waste.command.ts` — Composition root

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
  // … gli altri 6 scanner sempre registrati (rds, lb, ec2, snapshot, nat, gp2-upgrade, ebs-idle)
];

// EC2 underutilized richiede un prezzo per instance type (disponibile solo live):
// registrato condizionalmente, non fa parte dei 9 di base.
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

**Eccezione: `AwsEc2UnderutilizedScanner` e `AwsRdsUnderutilizedScanner`.** I prezzi per instance type/classe non sono in `prices.json` (troppi tipi da mantenere) e non vengono pre-caricati da `warmUp()`. I due scanner chiamano invece direttamente `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` / `getRdsInstancePricePerMonth(region, instanceClass, engine, deploymentOption)`, on demand, per ogni instance type/classe distinto trovato — per questo sono gli unici due scanner che richiedono `--live-pricing` per essere registrati affatto, invece di degradare al listino statico come gli altri.

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
