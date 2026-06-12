# Come funziona il codice

> 🇬🇧 [English version](../en/how-it-works.md)

Questo documento descrive il flusso completo di esecuzione, dall'invocazione CLI fino alla risposta AWS e alla visualizzazione dei risultati.

---

## Flusso di esecuzione end-to-end

```
utente: cloudrift analyze -r us-east-1 eu-west-1 [--pdf] [--json] [--min-age-days 7]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js fa il parse degli argomenti
          │
          ▼
     analyze-waste.command.ts  (composition root)
     1. AwsRegion.parse() per ogni regione (errore pulito su input invalido)
     2. accountId: --account-id oppure STS GetCallerIdentity
     3. Istanzia pricing, policy (con --min-age-days / --ignore-tag) e i 7 scanner
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Esegue gli scanner registrati in parallelo (Promise.all),
     ogni scanner itera le regioni in sequenza
          │
     ┌────┬────┬────┬────┬────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    │ (uno per ResourceKind)
   EBS  EIP  RDS  ELB  EC2  Snap  NAT   │
  scan  scan scan scan scan scan  scan  │
     │    │    │    │    │    │    │
     ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EC2  EC2  RDS ELBv2 EC2* EC2** EC2+CW
  API  API  API  API  API  API   API
          │        (* 2 chiamate; ** 3 chiamate; CW=CloudWatch, max 5 concorrenti)
          ▼
     Ogni scanner applica la waste policy di dominio
     (grace period, tag di esclusione, criteri specifici)
          │
          ▼
     WastedResourcesSummary { findings: WastedResource[],
                              totalMonthlyCostUsd, scanErrors }
          │
          ├──────────────────────────┬───────────────────────────┐
          ▼                          ▼ (--pdf)                   ▼ (--json)
  formatWasteReportAsTable    generateWasteReportPdf      formatWasteReportAsJson
  (cli-table3 + chalk)        (pdfkit, con salto pagina)  (WasteReportDto, JSON-safe)
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

`--pdf` e `--json` accettano un filename opzionale. `--json` senza filename stampa **solo** il JSON su stdout (l'output tabellare viene soppresso), così il comando è componibile: `cloudrift analyze --json | jq '.totalMonthlyCostUsd'`.

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
  // … gli altri 5
];

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

---

### Entità e Value Object

Tutte le entità implementano `WastedResource` e congelano le props (`Object.freeze`). Oltre ai campi comuni (`accountId`, `detectedAt`, `tags`, `monthlyCostUsd`), ogni entità porta i fatti che servono alla sua policy:

```typescript
// Esempi dei "fatti" per le decisioni
LoadBalancer.registeredTargetCount  // → isIdle()
NatGateway.bytesOutLastWindow       // → isIdle()
EbsSnapshot.sourceVolumeExists      // → isOrphan()
EbsSnapshot.boundToAmiId            // → non cancellabile
Ec2Instance.stoppedSince            // → grace period sullo stop reale
```

`CostEstimate.of(monthlyCostUsd, description)` è l'unico factory: il calcolo dei prezzi vive nell'infrastruttura (`StaticPriceTableAdapter` + `prices.json`), mai nel domain.

---

### Formatter

I tre formatter condividono il registry `resource-presenters.ts` (CLI):

```typescript
export const presenters: { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> } = {
  'ebs-volume': { title, head, colWidths, row(v), recommend(v) },
  // … satisfies garantisce l'esaustività a compile time
};
```

- **Tabella console** (`waste-report.table-formatter.ts`): itera `RESOURCE_KINDS`, usa `groupByKind(findings)` e il presenter per intestazioni e righe. In coda: warning per (kind, regione), totale e disclaimer con la data del listino prezzi.
- **PDF** (`waste-report.pdf-formatter.ts`): pagina executive summary (totali, breakdown, top 8 raccomandazioni da `presenter.recommend`) + una pagina per kind. `drawTable` gestisce il **salto pagina**: quando una tabella supera il margine inferiore, chiude il bordo, apre una nuova pagina e ridisegna l'header.
- **JSON** (`waste-report.json-formatter.ts`): serializza `toWasteReportDto(summary, meta)` — il contratto dati per dashboard, CI o un futuro frontend.

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
