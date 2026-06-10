# Come funziona il codice

Questo documento descrive il flusso completo di esecuzione, dall'invocazione CLI fino alla risposta AWS e alla visualizzazione dei risultati.

---

## Flusso di esecuzione end-to-end

```
utente: cloudrift analyze -r us-east-1 eu-west-1 [--pdf report.pdf]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js fa il parse degli argomenti
          │
          ▼
     analyze-waste.command.ts
     Crea i 7 adapter AWS e il use case principale
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Lancia 7 use case in parallelo (Promise.all)
          │
     ┌────┬────┬────┬────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EBS  EIP  RDS  ELB  EC2  Snap  NAT
  UC   UC   UC   UC   UC   UC    UC
     │    │    │    │    │    │    │
     ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EC2  EC2  RDS ELBv2 EC2* EC2* EC2+CW
  API  API  API  API  API  API  API
                      (* 2 chiamate; CW=CloudWatch)
          │
          ▼
     Aggregazione in WastedResourcesSummary
     Calcolo totalMonthlyCostUsd
          │
          ├──────────────────────────────────────┐
          ▼                                      ▼ (solo con --pdf)
     formatWasteReportAsTable(summary)    generateWasteReportPdf(summary, meta, path)
     Stampa le tabelle con chalk/cli-table3    Scrive il PDF su file con pdfkit
```

---

## Dettaglio componente per componente

### `main.ts` — Entry point

```typescript
program
  .command('analyze')
  .option('-r, --regions <regions...>', 'AWS regions to scan', ['us-east-1'])
  .option('--account-id <id>', 'AWS account ID (12-digit number)', 'unknown')
  .option('--pdf [filename]', 'Export a PDF report (optional filename)')
  .action(analyzeWasteCommand);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

Commander.js raccoglie le regioni, l'account ID e l'opzione PDF dalla riga di comando e li passa come oggetto al command handler. `--account-id` è opzionale. `--pdf` è opzionale: se passato senza valore Commander lo converte in `true` (booleano) e il comando genera un nome automatico `cloudrift-report-YYYY-MM-DD.pdf`; se passato con un valore stringa, usa quello come nome file.

---

### `analyze-waste.command.ts` — Composizione e orchestrazione

Questo è il **composition root**: l'unico punto dove le implementazioni concrete (adapter AWS) vengono istanziate e iniettate nel use case.

```typescript
const regions = options.regions.map(AwsRegion.create);
const { accountId } = options;

const pricing = new StaticPriceTableAdapter();

const useCase = new AnalyzeCloudWasteUseCase({
  ebsRepository: new AwsEbsVolumeRepositoryAdapter(pricing, accountId),
  elasticIpRepository: new AwsElasticIpRepositoryAdapter(pricing, accountId),
  rdsRepository: new AwsRdsInstanceRepositoryAdapter(pricing, accountId),
  loadBalancerRepository: new AwsLoadBalancerRepositoryAdapter(pricing, accountId),
  ec2Repository: new AwsEc2InstanceRepositoryAdapter(pricing, accountId),
  snapshotRepository: new AwsEbsSnapshotRepositoryAdapter(pricing, accountId),
  natGatewayRepository: new AwsNatGatewayRepositoryAdapter(pricing, accountId),
});

const result = await useCase.execute({ regions });
```

`StaticPriceTableAdapter` non dipende da credenziali AWS — legge `prices.json` bundlato nel build. Se il `result.ok` è `false` (errore fatale), stampa l'errore ed esce con codice 1. Se ci sono `scanErrors` nel summary, il formatter li mostra come warning ma non esce con errore.

---

### `AnalyzeCloudWasteUseCase` — Coordinatore principale

```typescript
const scanErrors: ResourceScanError[] = [];

const [ebsResult, eipResult, rdsResult, elbResult, ec2Result, snapshotResult, natResult] =
  await Promise.all([
    this.findEbs.execute(request.regions),
    this.findEips.execute(request.regions),
    this.findRds.execute(request.regions),
    this.findElb.execute(request.regions),
    this.findEc2.execute(request.regions),
    this.findSnapshots.execute(request.regions),
    this.findNat.execute(request.regions),
  ]);

// collect() registra l'errore in scanErrors e restituisce [] se il Result è fail
const ebsVolumes = collect(ebsResult, 'EBS Volumes', scanErrors);
const elasticIps = collect(eipResult, 'Elastic IPs', scanErrors);
// ... stessa logica per gli altri
```

I 7 sotto-use-case vengono lanciati in **parallelo** (`Promise.all`). Se uno fallisce, il suo errore viene registrato in `scanErrors` ma non blocca gli altri. Il summary viene sempre restituito con `Result.ok`.

Il calcolo del costo totale esclude automaticamente i tipi che hanno fallito (poiché `collect()` restituisce `[]` per i fail):
```typescript
const totalMonthlyCostUsd =
  [...ebsVolumes, ...elasticIps, ...rdsInstances, ...loadBalancers,
   ...stoppedEc2Instances, ...orphanSnapshots, ...idleNatGateways]
    .reduce((sum, r) => sum + r.costEstimate.monthlyCostUsd, 0);
```

---

### Sotto-use-case (es. `FindUnattachedEbsVolumesUseCase`)

I sotto-use-case hanno tutti la stessa struttura: iterano sulle regioni **in sequenza** (non in parallelo — una regione alla volta per evitare rate limiting AWS) e aggregano i risultati.

```typescript
for (const region of regions) {
  const result = await this.ebsRepository.findUnattachedVolumes(region);
  if (!result.ok) return result; // short-circuit al primo errore
  allVolumes.push(...result.value);
}
return Result.ok(allVolumes);
```

---

### Adapter AWS (es. `AwsEbsVolumeRepositoryAdapter`)

Ogni adapter riceve `PricingPort` e `accountId` nel costruttore, poi:

1. Crea un client AWS per la regione specifica
2. Usa `paginate()` per raccogliere tutti i risultati (le API AWS restituiscono max 1000 elementi)
3. Calcola il costo via `PricingPort` (che legge prezzi per-regione da `prices.json`)
4. Mappa ogni oggetto AWS all'entità del domain, impostando `accountId` e `detectedAt: new Date()`
5. Wrappa gli errori SDK in `AwsAdapterError`
6. Distrugge il client nel `finally`

```typescript
const rawVolumes = await paginate<Volume>(async (cursor) => {
  const r = await client.send(new DescribeVolumesCommand({
    Filters: [{ Name: 'status', Values: ['available'] }],
    NextToken: cursor,
  }));
  return { items: r.Volumes ?? [], cursor: r.NextToken };
});

const volumes = rawVolumes.map(v => {
  const volumeType = v.VolumeType ?? 'gp2';
  const pricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, volumeType);
  return new EbsVolume({
    volumeId: v.VolumeId!,
    region,
    accountId: this.accountId,
    sizeGb: v.Size!,
    volumeType,
    state: v.State as EbsVolumeState,
    createTime: v.CreateTime ?? new Date(),
    detectedAt: new Date(),
    tags: Object.fromEntries((v.Tags ?? []).map(t => [t.Key ?? '', t.Value ?? ''])),
    monthlyCostUsd: +(pricePerGb * v.Size!).toFixed(4),
  });
});
```

`paginate()` segue il cursore (`NextToken`/`Marker`/`NextMarker` a seconda dell'API) finché non è `undefined`, raccogliendo tutti gli elementi senza limite di 1000.

---

### `AwsEc2InstanceRepositoryAdapter` — Due chiamate in sequenza

L'adapter per le istanze EC2 ferme richiede due chiamate API perché `DescribeInstances` non restituisce la dimensione dei volumi EBS attaccati:

```
1. DescribeInstances(filter: state-name=stopped)
   → lista le istanze ferme con i loro BlockDeviceMappings (solo VolumeId)
2. Se ci sono istanze → DescribeVolumes(VolumeIds: [...])
   → risolve dimensione e tipo di ogni volume
3. Merge: ogni istanza riceve i dati dei propri volumi → calcolo del costo
```

Se non ci sono istanze ferme, la seconda chiamata viene saltata (zero overhead).

---

### `AwsEbsSnapshotRepositoryAdapter` — Diff tra snapshot e volumi

L'adapter individua gli snapshot orfani confrontando due sorgenti AWS:

```
1. DescribeSnapshots(OwnerIds: ['self'])  ← lanciati in parallelo
   DescribeVolumes()                     ←
2. Set dei VolumeId esistenti
3. Snapshot il cui VolumeId non è nel set → orfano
```

Le due chiamate partono in `Promise.all` per ridurre la latenza.

---

### `AwsNatGatewayRepositoryAdapter` — EC2 + CloudWatch in due fasi

L'adapter usa due client diversi: EC2 per la lista dei gateway, CloudWatch per le metriche di traffico.

```
1. DescribeNatGateways(filter: state=available)
   → lista dei NAT Gateway attivi
2. Se la lista è vuota → ritorna subito (zero overhead CloudWatch)
3. Per ogni gateway in parallelo:
   GetMetricStatistics(BytesOutToDestination, 48h, SUM)
   → bytes inviati verso la destinazione
4. Se SUM == 0 (o assenti datapoints) → gateway idle
```

I NAT Gateway vengono verificati in `Promise.all` interno per massimizzare il parallelismo sulle chiamate CloudWatch. I due client vengono distrutti nel `finally` anche in caso di errore.

---

### `AwsLoadBalancerRepositoryAdapter` — Logica più complessa

Il Load Balancer adapter richiede più chiamate API per determinare se un LB è "idle":

```
1. DescribeLoadBalancers()         → lista tutti i LB (tipo application/network)
2. Per ogni LB:
   DescribeTargetGroups(lbArn)    → lista i target group del LB
3. Per ogni target group:
   DescribeTargetHealth(tgArn)    → conta i target registrati
4. Se totalTargets == 0 → il LB è idle
```

Questo approccio è più preciso rispetto al semplice guardare se esistono target group, perché un LB può avere TG configurati ma vuoti.

---

### Entità e Value Object

Tutte le entità condividono tre campi obbligatori oltre ai propri:

```typescript
interface EbsVolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;     // ID account AWS (es. '123456789012')
  sizeGb: number;
  volumeType: string;
  state: EbsVolumeState;
  createTime: Date;
  detectedAt: Date;      // quando il repository adapter ha rilevato lo spreco
  tags: Record<string, string>;
  monthlyCostUsd: number; // calcolato dall'adapter via PricingPort
}
```

**Entità** (`Entity<TId>`): identità basata sull'ID, non sulla struttura.

```typescript
class EbsVolume extends Entity<string> {
  constructor(props: EbsVolumeProps) {
    super(props.volumeId); // l'ID è il volumeId
    this.props = Object.freeze({ ...props }); // immutabile
  }

  isUnattached(): boolean {
    return this.props.state === 'available';
  }

  get costEstimate(): CostEstimate {
    // monthlyCostUsd è già calcolato; CostEstimate.of lo avvolge con una descrizione
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB ${this.props.volumeType} unattached EBS`,
    );
  }
}
```

**Value Object** (`ValueObject<T>`): nessuna identità, uguaglianza strutturale.

```typescript
class CostEstimate extends ValueObject<{ monthlyCostUsd: number; description: string }> {
  // Unico factory method — il calcolo avviene nell'adapter tramite PricingPort
  static of(monthlyCostUsd: number, description = ''): CostEstimate {
    return new CostEstimate({ monthlyCostUsd, description });
  }

  format(): string {
    return `$${this.props.monthlyCostUsd.toFixed(2)}/mo`;
  }
}
```

La logica di pricing è separata dal domain e vive in `StaticPriceTableAdapter` (infrastructure), che legge `prices.json` con prezzi per-regione. Cambiare i prezzi o supportare nuove regioni richiede solo aggiornare `prices.json`.

---

### Formatter CLI (console)

Il formatter riceve il `WastedResourcesSummary` e produce una stringa di output con tabelle colorate. Non contiene logica di business: sa solo come visualizzare i dati.

```typescript
const ebsTable = new Table({
  head: ['Volume ID', 'Region', 'Size', 'Type', 'Created', 'Est. Cost'],
  style: { head: ['cyan'] },
});

for (const vol of summary.ebsVolumes) {
  ebsTable.push([
    vol.id,
    vol.region.code,
    `${vol.sizeGb} GB`,
    vol.volumeType,
    vol.createTime.toISOString().split('T')[0],
    chalk.red(vol.costEstimate.format()),
  ]);
}
```

---

### Formatter PDF (`waste-report.pdf-formatter.ts`)

Attivato solo se l'utente passa `--pdf`. Riceve gli stessi dati del formatter console (`WastedResourcesSummary`) più i metadati della scansione (`accountId`, `regions`, `generatedAt`) e scrive un file PDF usando **pdfkit**.

Il documento è strutturato in due blocchi:

**Pagina 1 — Executive summary**

```
┌──────────────────────────────────────────────┐
│ CloudRift  AWS Waste Detection Report        │
│ Generated: 2026-06-09 · Account: 123… · ... │
├────────────────┬────────────────┬────────────┤
│ MONTHLY WASTE  │ ANNUAL WASTE   │ RESOURCES  │
│ $312.40/mo     │ $3,748.80/yr   │ 18         │
├──────────────────────────────────────────────┤
│ Breakdown by resource type                   │
│ EBS Volumes (unattached)   │  5  │ $80.00/mo │
│ ...                                          │
├──────────────────────────────────────────────┤
│ Top recommendations                          │
│ 1. Delete idle NAT Gateway nat-0abc… eu-w-1  │
│    $32.40/mo   $388/yr                       │
│ ...                                          │
└──────────────────────────────────────────────┘
```

**Pagine successive — Dettaglio per tipo di risorsa**

Una pagina per ogni tipo che ha trovato risorse (EBS, Elastic IP, RDS, Load Balancer, EC2, Snapshot, NAT Gateway), con una tabella completa dei campi rilevanti.

Il PDF viene generato con primitive pdfkit (`rect`, `text`, `moveTo`/`lineTo`) senza librerie aggiuntive per le tabelle. La funzione `clip()` tronca il testo con `doc.widthOfString()` per evitare overflow di cella. La generazione è asincrona (`Promise` su stream): il file viene scritto via `fs.createWriteStream` e la promise si risolve sull'evento `finish` dello stream.

```typescript
// Struttura del modulo
generateWasteReportPdf(summary, meta, outputPath): Promise<void>
  └── drawSummaryPage(doc, summary, meta)     // pagina 1
  └── drawDetailPages(doc, summary)           // pagine 2..N
        └── drawTable(doc, headers, rows, colWidths, y): number
```

Le raccomandazioni vengono calcolate da `buildQuickWins()`: appiattisce tutte le risorse trovate in un array unico, ordina per `costEstimate.monthlyCostUsd` decrescente e prende le prime 8. Per ogni risorsa produce un testo descrittivo (es. _"Delete idle NAT Gateway nat-0abc in eu-west-1 — zero traffic for 48h"_) con il costo mensile e annuale stimato.

---

## Come vengono gestite le credenziali AWS

L'SDK AWS v3 usa la **catena di credenziali predefinita**, nell'ordine:

1. Variabili d'ambiente (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. File `~/.aws/credentials` (profilo `default` o `AWS_PROFILE`)
3. IAM Instance Profile (se si esegue su EC2)
4. ECS Task Role / EKS Service Account

Non è necessario configurare nulla nel codice. La regione viene passata esplicitamente all'adapter tramite `AwsRegion`.

---

## Struttura dei test

I test seguono la struttura del codice sorgente, con un file `.spec.ts` per ogni file sorgente.

**Test del domain:** pura logica di business, zero dipendenze esterne.

**Test dell'application layer:** i repository port vengono sostituiti da oggetti JavaScript inline:
```typescript
const repo: EbsVolumeRepositoryPort = {
  findUnattachedVolumes: async () => Result.ok([makeVolume('vol-1')]),
};
```
Nessun mock di framework necessario.

**Test degli adapter:** il modulo AWS SDK viene mockato con `jest.mock('@aws-sdk/client-ec2')`. Il `mockSend` viene configurato per restituire dati AWS simulati. Per verificare i parametri passati al costruttore di un `Command`, si usa:
```typescript
const constructorArgs = (DescribeVolumesCommand as jest.Mock).mock.calls[0][0];
expect(constructorArgs.Filters).toEqual([...]);
```
Questo perché il mock non esegue il costruttore reale e quindi `command.input` è `undefined`.
