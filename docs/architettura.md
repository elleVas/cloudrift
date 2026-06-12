# Architettura di cloudrift

## Panoramica

cloudrift adotta un'architettura a strati ispirata al **Domain-Driven Design (DDD)** e all'**Architettura Esagonale** (Ports & Adapters), organizzata attorno a un **modello a plugin**: il concetto centrale del dominio è la *risorsa sprecata* (`WastedResource`), e ogni tipo di risorsa AWS è un plugin (`WasteScannerPort`) che il coordinatore esegue in modo generico.

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
       │ implementa WasteScannerPort (×7)
┌──────┴──────────────────────────────────────────────────┐
│        libs/cloud-cost/infrastructure/aws-adapter       │
│   (scanner AWS SDK v3, pricing, STS account resolver)   │
└─────────────────────────────────────────────────────────┘
```

**Regola fondamentale:** le dipendenze puntano sempre verso l'interno (verso il domain). Il domain non sa nulla di AWS SDK, Commander.js o pdfkit.

---

## I layer in dettaglio

### 1. `shared/kernel` — Nucleo condiviso

- **`Entity<TId>`**: classe base per oggetti con identità.
- **`ValueObject<T>`**: oggetti immutabili con uguaglianza strutturale (`AwsRegion`, `CostEstimate`).
- **`Result<T, E>`**: successo/fallimento come valore, senza eccezioni attraverso i layer.
- **`DomainError`**: errori tipizzati con `code` esplicito.

### 2. `cloud-cost/domain` — Il cuore del sistema

#### Il modello unificante: `WastedResource` e `ResourceKind`

```typescript
export type ResourceKind =
  | 'ebs-volume' | 'elastic-ip' | 'rds-instance' | 'load-balancer'
  | 'ec2-instance' | 'ebs-snapshot' | 'nat-gateway';

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

#### Entità

Le 7 entità (`EbsVolume`, `ElasticIp`, `RdsInstance`, `LoadBalancer`, `Ec2Instance`, `EbsSnapshot`, `NatGateway`) implementano `WastedResource` e portano i **fatti** osservati necessari alle decisioni: `LoadBalancer.registeredTargetCount`, `NatGateway.bytesOutLastWindow`, `EbsSnapshot.sourceVolumeExists` / `boundToAmiId`, `Ec2Instance.stoppedSince`.

#### Waste Policies — dove vive la conoscenza di business

La definizione di "spreco" **non** sta negli adapter né nei filtri delle API AWS: sta nelle policy di dominio (`libs/cloud-cost/domain/src/policies/`). La classe base `WastePolicy<T>` applica due regole trasversali:

- **Tag di esclusione** (`cloudrift:ignore`, configurabile): la risorsa è esclusa esplicitamente dall'utente.
- **Periodo di grazia** (`minAgeDays`, default 7): una risorsa troppo giovane non è spreco — un volume appena staccato, un LB appena creato o un NAT senza traffico da poche ore sono quasi sempre lavori in corso, non sprechi.

Ogni policy concreta aggiunge il criterio specifico del tipo:

| Policy | Criterio | Guardia anti-falso-positivo |
|---|---|---|
| `EbsVolumeWastePolicy` | `state === 'available'` | grace su `createTime` (AWS non espone la data di detach) |
| `ElasticIpWastePolicy` | nessuna association | — (gli EIP non hanno data di creazione) |
| `RdsInstanceWastePolicy` | `status === 'stopped'` | — (AWS riavvia da solo dopo 7 giorni: se è stopped, è recente per definizione) |
| `LoadBalancerWastePolicy` | zero target registrati | grace su `createdTime` |
| `Ec2InstanceWastePolicy` | `state === 'stopped'` | grace su `stoppedSince` (da `StateTransitionReason`), fallback `launchTime` |
| `EbsSnapshotWastePolicy` | volume sorgente cancellato | esclusi snapshot referenziati da AMI (non cancellabili); grace su `startTime` |
| `NatGatewayWastePolicy` | zero bytes in uscita nella finestra (48h) | grace su `createTime` (ambienti appena creati) |

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
- **Outbound `PricingPort`** — prezzi per-regione per tipo di risorsa, più `getPricesAsOf()` (la data di verifica del listino, mostrata in ogni report).
- **Inbound `FindWastedResourcesUseCasePort`** — definisce `WastedResourcesSummary { findings, totalMonthlyCostUsd, scanErrors }` e `ResourceScanError { kind, region, error }`.

### 3. `cloud-cost/application` — Use case generico e DTO

`AnalyzeCloudWasteUseCase` riceve un **array di `WasteScannerPort`** e non sa quanti o quali siano:

```typescript
constructor(private readonly scanners: readonly WasteScannerPort[]) {}
```

Esegue gli scanner **in parallelo tra loro** e **in sequenza sulle regioni** (per non concentrare chiamate sulle stesse API regionali). Gli errori sono raccolti per coppia *(scanner, regione)*: il fallimento di una regione non scarta i risultati delle altre regioni né degli altri scanner. Il summary viene sempre restituito con i dati parziali e gli errori in `scanErrors`.

`toWasteReportDto()` proietta il summary in **`WasteReportDto`**, una struttura JSON-safe (solo primitivi e stringhe ISO): è il contratto dati per qualunque presentazione, presente e futura (vedi [Frontend-readiness](#frontend-readiness)).

### 4. `cloud-cost/infrastructure/aws-adapter` — Scanner concreti

Ogni scanner implementa `WasteScannerPort` con **AWS SDK v3**: crea il client per la regione, usa `paginate()` per seguire i cursori, mappa le risposte alle entità (calcolando i costi via `PricingPort`), applica la waste policy e distrugge il client nel `finally`. Gli errori SDK sono wrappati in `AwsAdapterError`.

Gli adapter pre-filtrano lato server dove possibile (es. `status=available` per gli EBS) come **ottimizzazione**: il filtro API produce un sovrainsieme dei candidati, la decisione finale è sempre della policy di dominio.

Particolarità:
- **`AwsNatGatewayScanner`**: le chiamate CloudWatch sono limitate a 5 concorrenti (`mapWithConcurrency`) per evitare throttling su account con molti gateway.
- **`AwsEbsSnapshotScanner`**: interroga anche `DescribeImages` per escludere gli snapshot legati ad AMI registrate.
- **`resolveAwsAccountId()`**: risolve l'account ID via `sts:GetCallerIdentity`, eliminando l'inserimento manuale (resta l'override `--account-id`).

### 5. `apps/cli` — Entry point e composition root

`analyze-waste.command.ts` è l'unico punto in cui le implementazioni concrete vengono istanziate: costruisce il listino prezzi, le policy (con i parametri da CLI) e i 7 scanner, li inietta nel use case e passa il risultato ai formatter. I tre formatter (tabella console, PDF, JSON) condividono il registry `resource-presenters.ts`, tipizzato `Record<ResourceKind, …>` con `satisfies`: dimenticare il presenter di un nuovo kind è un errore di compilazione.

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

- **Kind aggiuntivi nello stesso contesto** — `'gcp-persistent-disk'`, `'gcp-static-ip'`, … entrano nella union `ResourceKind` con le loro entità (`PersistentDisk`, non un finto `EbsVolume`), policy e scanner (`libs/cloud-cost/infrastructure/gcp-adapter`). Adatta se il prodotto resta "un report di spreco unificato". Il `Promise.all` del coordinatore scala da 7 a N scanner senza modifiche.
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

**Cosa NON promettere:** che "basta scrivere un adapter". Servono entità GCP, policy GCP (le semantiche di spreco sono diverse: un Persistent Disk non ha lo stato `available` di EBS), un listino GCP e i presenter. L'architettura garantisce che il *core* non si tocca, non che il lavoro sia gratis.

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
