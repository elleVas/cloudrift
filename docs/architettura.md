# Architettura di cloudrift

## Panoramica

cloudrift adotta un'architettura a strati ispirata al **Domain-Driven Design (DDD)** e all'**Architettura Esagonale** (Ports & Adapters). L'obiettivo è tenere separata la logica di business pura (domain) dalla tecnologia concreta (AWS SDK, CLI), in modo che la logica possa essere testata, modificata e riusata indipendentemente dall'infrastruttura.

---

## Struttura dei layer

```
┌──────────────────────────────────────────────────────────┐
│                        apps/cli                          │
│           (entry point, Commander.js, formatter)         │
└───────────────────────────┬──────────────────────────────┘
                            │ dipende da
┌───────────────────────────▼──────────────────────────────┐
│              libs/cloud-cost/application                 │
│           (use cases, orchestrazione del domain)         │
└──────┬──────────────────────────────────────┬────────────┘
       │ dipende da                           │ dipende da (interfacce)
┌──────▼──────────────────┐   ┌──────────────▼────────────┐
│  libs/cloud-cost/domain │   │  libs/shared/kernel       │
│  (entità, value objects,│   │  (base classes riusabili) │
│   ports inbound/outbound│   └───────────────────────────┘
└──────▲──────────────────┘
       │ implementa le porte outbound
┌──────┴──────────────────────────────────────────────────┐
│        libs/cloud-cost/infrastructure/aws-adapter       │
│           (AWS SDK v3, adapter concreti)                │
└─────────────────────────────────────────────────────────┘
```

**Regola fondamentale:** le dipendenze puntano sempre verso l'interno (verso il domain). Il domain non sa nulla di AWS, di Commander.js o di qualsiasi libreria esterna.

---

## I layer in dettaglio

### 1. `shared/kernel` — Nucleo condiviso

Contiene le astrazioni di base riusabili in tutti i bounded context futuri:

- **`Entity<TId>`**: classe base per gli oggetti con identità (es. un EBS Volume identificato dal suo ID).
- **`ValueObject<T>`**: classe base per oggetti immutabili senza identità propria; l'uguaglianza è strutturale (es. `AwsRegion`, `CostEstimate`).
- **`Result<T, E>`**: tipo unione per gestire il successo/fallimento senza eccezioni. Ogni operazione che può fallire restituisce `Result.ok(value)` oppure `Result.fail(error)`, evitando `throw` attraverso i confini dei layer.
- **`DomainError`**: classe base per errori tipizzati con un `code` esplicito, che mantiene la catena del prototipo per `instanceof`.

### 2. `cloud-cost/domain` — Il cuore del sistema

È il layer più importante: non dipende da nulla di esterno (solo da `shared-kernel`). Contiene:

**Entità:**
| Entità | ID | Metodo chiave |
|---|---|---|
| `EbsVolume` | `volumeId` | `isUnattached()` |
| `ElasticIp` | `allocationId` | `isUnassociated()` |
| `RdsInstance` | `dbInstanceIdentifier` | `isStopped()` |
| `LoadBalancer` | `arn` | — |
| `Ec2Instance` | `instanceId` | `isStopped()` |
| `EbsSnapshot` | `snapshotId` | — |
| `NatGateway` | `natGatewayId` | — |

**Value Objects:**
- `AwsRegion`: wrapper validante sul codice di regione AWS (es. `us-east-1`). Lancia errore se il codice non è una regione AWS valida.
- `CostEstimate`: stima del costo mensile in USD. Ha un solo factory method: `CostEstimate.of(monthlyCostUsd, description)`. Il calcolo del costo avviene nell'adapter tramite `PricingPort`, non nel domain.

**Ports (interfacce):**
- **Outbound repository** (implementate dall'infrastruttura): `EbsVolumeRepositoryPort`, `ElasticIpRepositoryPort`, `RdsInstanceRepositoryPort`, `LoadBalancerRepositoryPort`, `Ec2InstanceRepositoryPort`, `EbsSnapshotRepositoryPort`, `NatGatewayRepositoryPort`
- **Outbound pricing** (implementata dall'infrastruttura): `PricingPort` — restituisce prezzi per-regione per ogni tipo di risorsa. Implementazione concreta: `StaticPriceTableAdapter` che legge `prices.json`.
- **Inbound** (implementata dall'application layer): `FindWastedResourcesUseCasePort` — definisce `WastedResourcesSummary` e `ResourceScanError`, il DTO che attraversa il confine verso la CLI

### 3. `cloud-cost/application` — Use Cases

Coordina il domain con i port outbound senza dipendere dall'implementazione concreta. Ogni sotto-use-case:

1. Riceve una lista di regioni
2. Chiama il repository port per ogni regione in sequenza (no parallelo per evitare rate limiting AWS)
3. Aggrega i risultati, short-circuits al primo errore

`AnalyzeCloudWasteUseCase` è il coordinatore principale: esegue tutti i 7 sotto-use-case in parallelo con `Promise.all` e assembla il `WastedResourcesSummary`. Se uno dei sotto-use-case fallisce, il suo errore viene registrato in `scanErrors: ResourceScanError[]` ma non blocca gli altri — il summary viene sempre restituito con i dati parziali disponibili.

### 4. `cloud-cost/infrastructure/aws-adapter` — Implementazione concreta

Implementa i port outbound usando **AWS SDK v3**. Ogni repository adapter:

1. Riceve `PricingPort` e `accountId` nel costruttore
2. Crea un client AWS per la regione specifica
3. Usa `paginate()` per raccogliere tutti i risultati dalle API AWS (che restituiscono max 1000 elementi per chiamata)
4. Mappa la risposta AWS alle entità del domain, calcolando il costo via `PricingPort` e impostando `accountId` e `detectedAt: new Date()`
5. Wrappa gli errori SDK in `AwsAdapterError` (un `DomainError` tipizzato)
6. Distrugge il client nel `finally` per liberare le connessioni

`StaticPriceTableAdapter` implementa `PricingPort` leggendo `prices.json` con prezzi per 7 regioni. Le regioni senza prezzi specifici ricadono sui valori `default` (us-east-1).

### 5. `apps/cli` — Entry Point

Usa **Commander.js** per definire il comando `analyze` con le opzioni `--regions` e `--account-id`. Il command:

1. Istanzia `StaticPriceTableAdapter` e tutti e 7 gli adapter AWS (passando pricing e accountId)
2. Li inietta in `AnalyzeCloudWasteUseCase`
3. Esegue il use case
4. Formatta il risultato con `cli-table3` e `chalk` (inclusa la sezione "Scan Warnings" se ci sono `scanErrors`)
5. Esce con codice 1 solo in caso di errore fatale del use case (non per scan errors parziali)

---

## Perché DDD e Architettura Esagonale?

### Testabilità
Il domain e gli use case possono essere testati **senza nessuna dipendenza AWS**. I test dell'application layer usano oggetti fittizi (mock in-memory) che implementano le porte outbound, rendendo i test veloci e deterministici.

### Sostituibilità
Se domani si vuole supportare **GCP o Azure**, basta creare nuovi adapter che implementano le stesse porte outbound. Il domain e gli use case rimangono invariati.

### Scalabilità del codice
Aggiungere un nuovo tipo di risorsa AWS richiede passi ben definiti e localizzati (vedi [aggiungere-risorsa.md](./aggiungere-risorsa.md)) senza toccare il codice esistente nei layer già stabili.

### Separazione delle responsabilità
- Il domain SA cosa è "sprecato" (logica di business)
- L'application SA come coordinare la ricerca
- L'infrastruttura SA come parlare con AWS
- La CLI SA come mostrarlo all'utente

---

## Gestione degli errori

Il progetto usa il pattern **Railway-Oriented Programming** tramite il tipo `Result<T, E>`:

```
Adapter AWS ──Result.ok(entità)──▶ Use Case ──Result.ok(summary)──▶ CLI
             ──Result.fail(err)──▶ Use Case ──collect() → scanErrors[] ──▶ CLI (warnings)
```

`AnalyzeCloudWasteUseCase` non propaga i `Result.fail` dei sotto-use-case: li raccoglie in `scanErrors` e restituisce comunque `Result.ok` con i dati parziali. La CLI mostra i warning senza uscire con errore.

I sotto-use-case (es. `FindUnattachedEbsVolumesUseCase`) propagano ancora il `Result.fail` al primo errore per evitare chiamate inutili a regioni che hanno già fallito.

Non ci sono `throw` attraverso i confini dei layer. Gli errori viaggiano come valori.

---

## Bounded Context

Al momento esiste un solo bounded context: **cloud-cost**. In futuro si potrebbero aggiungere contesti separati (es. `network-cost`, `storage-cost`) ognuno con il proprio domain, application e infrastruttura, condividendo solo il `shared/kernel`.
