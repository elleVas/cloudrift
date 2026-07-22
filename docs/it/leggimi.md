# cloudrift

> 🇬🇧 [English version](../../README.md)

<p align="center">
  <img src="https://raw.githubusercontent.com/elleVas/cloudrift/main/docs/assets/banner-readme.png" alt="Il wizard interattivo di cloudrift mentre scansiona un account AWS alla ricerca di risorse sprecate" width="850" />
</p>

<p align="center"><strong>Scansiona account AWS alla ricerca di risorse sprecate e stima il costo mensile di quello spreco.</strong><br />Sola lettura. Nessuna telemetria. Non cancella, modifica o ferma nulla — segnala soltanto.</p>

## Guida rapida

```sh
npm install -g @cloudrift/cli
cloudrift
```

Tutto qui — nessun sottocomando necessario, il wizard interattivo ti guida nella scelta di regioni e scanner. Richiede **Node.js 20+** e credenziali AWS con [permessi IAM in sola lettura](#permessi-iam-necessari) (`aws configure`, o variabili d'ambiente — vedi [setup completo](#setup-completo-credenziali-aws-da-zero-dai-sorgenti) qui sotto se ti serve prima quello).

Preferisci i flag al wizard (script, CI)? Stesso tool, stesso output:

```sh
cloudrift analyze -r us-east-1 eu-west-1 --pdf
```

Vedi [Utilizzo](#utilizzo) per l'elenco completo dei flag.

> ⚠️ **Disclaimer:** cloudrift segnala solo spreco stimato e raccomandazioni — non cancella, modifica o ferma alcuna risorsa AWS. Ogni finding deve essere validato dal tuo team infrastrutturale prima di agire. I maintainer non si assumono alcuna responsabilità per le azioni intraprese sulla base di questo report.
> **Contatti:** [raffaelevasini@gmail.com](mailto:raffaelevasini@gmail.com) · <a href="https://github.com/elleVas" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://www.linkedin.com/in/raffaele-vasini-87937470/" target="_blank" rel="noopener noreferrer">LinkedIn</a>

**📑 Indice**

- [Guida rapida](#guida-rapida)
- [Cosa rileva](#cosa-rileva)
- [Confronto e trend di spesa](#confronto-e-trend-di-spesa-cost--trend)
- [Utilizzo](#utilizzo)
- [File di configurazione](#file-di-configurazione)
- [Fonti dei prezzi](#fonti-dei-prezzi)
- [Uso in CI/CD](#uso-in-cicd)
- [Policy as Code (OPA)](#policy-as-code-opa)
- [Permessi IAM necessari](#permessi-iam-necessari)
- [Sviluppo](#sviluppo)
- [Rilascio](#rilascio)
- [Architettura](#architettura)
- [Documentazione tecnica](#documentazione-tecnica)
- [Licenza](#licenza)

<details>
<summary><strong>Setup completo</strong> — credenziali AWS da zero, dai sorgenti</summary>

#### Setup completo (credenziali AWS da zero, dai sorgenti)

- **Node.js 20+** — verifica con `node --version`
- **Credenziali AWS** con permessi in sola lettura (vedi sezione [Permessi IAM](#permessi-iam-necessari) qui sotto)
- **pnpm** — necessario solo per compilare dai sorgenti (`npm install -g pnpm`)

#### Passo 1 — Installa

```sh
npm install -g @cloudrift/cli
# oppure eseguilo una tantum, senza installarlo:
npx @cloudrift/cli analyze
```

**Dai sorgenti** (per contribuire, o per eseguire modifiche non ancora rilasciate):

```sh
git clone <repo-url>
cd cloudrift
pnpm install
pnpm nx build cli   # output compilato in apps/cli/dist/
```

#### Passo 2 — Configura le credenziali AWS

Hai tre opzioni, in ordine di preferenza:

**Opzione A — AWS CLI (consigliato se hai già aws cli installata)**

```sh
aws configure
# inserisci: Access Key ID, Secret Access Key, regione default (es. us-east-1), output format (json)
```

Questo crea il file `~/.aws/credentials` con il profilo `default`.

**Opzione B — File `~/.aws/credentials` manuale**

```ini
[default]
aws_access_key_id     = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Opzione C — Variabili d'ambiente**

```sh
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

> **Verifica:** `aws sts get-caller-identity` deve restituire il tuo account ID senza errori.

#### Passo 3 — Assicurati di avere i permessi IAM

L'utente/ruolo AWS deve avere la policy elencata nella sezione [Permessi IAM](#permessi-iam-necessari) qui sotto. Se usi un utente IAM, aggiungila direttamente dall'[IAM Console](https://console.aws.amazon.com/iam/) → Utente → Aggiungi permessi → Crea policy inline.

#### Passo 4 — Esegui

```sh
# con npm install:
cloudrift                                      # nessun sottocomando, in un vero terminale: wizard interattivo
cloudrift analyze                              # scansione su us-east-1 (default)
cloudrift analyze -r us-east-1 eu-west-1       # scansione su più regioni

# dai sorgenti:
node apps/cli/dist/main.js analyze
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1
```

L'account ID viene rilevato automaticamente via STS. Se tutto è configurato correttamente vedrai tabelle con le risorse sprecate trovate e il totale stimato. Se un account non ha risorse sprecate vedrai un messaggio "No wasted resources found".

</details>

---

### Cosa rileva

| Risorsa            | Condizione di spreco                                                    | Costo stimato (us-east-1)                                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| **EBS Volumes**    | Non attaccati a nessuna istanza (`state: available`)                    | gp3: $0,08/GB-mese · gp2: $0,10/GB-mese · io1: $0,125/GB-mese |
| **Elastic IP**     | Non associati a EC2 o NAT Gateway                                       | $3,60/mese fisso                                              |
| **RDS Instances**  | Ferme (`stopped`), ancora a pagamento per lo storage                    | gp2: $0,115/GB-mese · gp3: $0,115/GB-mese                     |
| **Load Balancers** | Nessun target registrato (ALB/NLB)                                      | ~$16,20/mese fisso                                            |
| **EC2 Instances**  | Ferme (`stopped`), i volumi EBS attaccati continuano a essere fatturati | Somma dei volumi EBS attaccati                                |
| **EBS Snapshots**  | Volume sorgente cancellato (snapshot orfani)                            | $0,05/GB-mese                                                 |
| **NAT Gateways**   | Zero traffico in uscita nelle ultime 48h                                | ~$32,40/mese fisso                                            |
| **EBS gp2→gp3**    | Volume gp2 in uso aggiornabile a gp3 (risparmio, non spreco)            | Risparmio: prezzo gp2 − gp3 × GB (≈ $0,02/GB-mese)           |
| **EBS Volumes (idle)** | Attaccati (in-use) ma zero I/O nelle ultime 48h                     | gp3: $0,08/GB-mese · gp2: $0,10/GB-mese · io1: $0,125/GB-mese |
| **EC2 Instances (underutilized)** | Running, CPU massima ≤ 5% in 14 giorni — candidato a rightsizing, richiede `--live-pricing` | Risparmio: ~50% del costo mensile dell'istanza (stima — verificare RAM/rete prima di agire) |
| **RDS Instances (underutilized)** | Disponibile (`available`), CPU massima ≤ 5% in 14 giorni — candidato a rightsizing, richiede `--live-pricing` | Risparmio: ~50% del costo mensile dell'istanza (stima — verificare storage I/O/connessioni prima di agire) |
| **CloudWatch Log Groups** | Nessuna retention policy configurata (i log crescono all'infinito) | $0,03/GB-mese |
| **ENI orfane** | `Status: available` (non attaccate a nessuna istanza) | $0 (segnalazione di igiene, non un costo diretto) |
| **S3 Buckets (no lifecycle)** | Nessuna lifecycle configuration — candidato a rightsizing | Risparmio: ~40% del costo storage Standard (stima — verificare i pattern di accesso prima di agire) |
| **Lambda Functions (underutilized)** | (Quasi) zero invocazioni in 7 giorni | $0 (segnalazione di igiene — Lambda pay-per-use non ha costo diretto se inutilizzata) |
| **EFS File Systems (unused)** | Nessun mount target, oppure montato con zero I/O nelle ultime 48h | $0,30/GB-mese (storage Standard) |
| **DynamoDB Tables (overprovisioned)** | Modalità PROVISIONED, utilizzo capacità read/write < 10% in 7 giorni — candidato a rightsizing | Risparmio: ~50% del costo mensile RCU/WCU provisioned (stima — verificare picchi di traffico prima di agire) |
| **ElastiCache Clusters (idle)** | Zero connessioni client nelle ultime 48h, richiede `--live-pricing` | Costo pieno node-hour (il nodo è fatturato indipendentemente dall'uso) |
| **Redshift Clusters (idle)** | Zero connessioni al database nelle ultime 48h, richiede `--live-pricing` | Costo pieno node-hour × numero di nodi |
| **OpenSearch Domains (idle)** | Richieste di ricerca/indicizzazione quasi nulle nelle ultime 48h (sotto la soglia di rumore interno del cluster — health check/ISM polling non arrivano mai a zero letterale), richiede `--live-pricing` | Costo pieno instance-hour × numero di istanze |
| **MSK Clusters (idle)** | Modalità Provisioned, zero traffico broker nelle ultime 48h, richiede `--live-pricing` | Costo pieno broker-hour × numero di broker |
| **FSx File Systems (idle)** | Zero I/O di lettura/scrittura nelle ultime 48h | $0,093–$0,14/GB-mese a seconda del tipo di file system |
| **DocumentDB Instances (idle)** | Zero connessioni al database nelle ultime 48h, richiede `--live-pricing` | Costo pieno instance-hour |
| **Neptune Instances (idle)** | Zero traffico di query nelle ultime 48h, richiede `--live-pricing` | Costo pieno instance-hour |
| **Amazon MQ Brokers (idle)** | Zero traffico di rete nelle ultime 48h, richiede `--live-pricing` | Costo pieno broker-hour (×2 per ACTIVE_STANDBY_MULTI_AZ) |
| **WorkSpaces (idle)** | AlwaysOn, nessuna connessione utente negli ultimi 30 giorni, richiede `--live-pricing` | Costo pieno mensile del bundle |
| **Connessioni VPN Site-to-Site (idle)** | Zero traffico nei tunnel nelle ultime 48h | ~$36,50/mese fisso |
| **Transit Gateway Attachments (idle)** | Zero traffico nelle ultime 48h | ~$36,50/mese fisso |
| **Kinesis Streams (idle, modalità Provisioned)** | Zero record in ingresso nelle ultime 48h (modalità On-Demand fuori scope — pay-per-use) | ~$10,95/mese per shard |
| **Code SQS Dead Letter (abbandonate)** | Identificata come DLQ (RedrivePolicy/naming), messaggio più vecchio non consumato da oltre 14 giorni | $0 (segnalazione di igiene — SQS non ha costo di storage) |
| **CloudWatch Log Groups (Lambda orfani)** | Log group `/aws/lambda/*` la cui funzione non esiste più | $0,03/GB-mese (dati di log memorizzati) |
| **Aurora Serverless v2 (Min ACU sovradimensionato)** | Min ACU molto superiore al picco osservato in 7 giorni — candidato a rightsizing | Risparmio: (Min ACU − Min ACU suggerito) × $87,60/ACU-mese |
| **SageMaker Notebook Instances (idle)** | `InService`, CPU massima ≤ 2% in 7 giorni, richiede `--live-pricing` | Costo pieno instance-hour |
| **SageMaker Endpoints (idle)** | `InService`, zero invocazioni in 7 giorni, richiede `--live-pricing` | Costo pieno instance-hour × numero di istanze |
| **SageMaker Models (orfani, nessun endpoint)** | Non referenziati da nessuna endpoint config — igiene del namespace modelli | Costo stimato storage S3 Standard |
| **Ambienti Dev/PR fantasma (tutte le risorse inattive)** | Risorse raggruppate per tag o naming pattern, tutte inattive da 7+ giorni | Costo stimato totale del gruppo di risorse |
| **EKS Node Groups (sovradimensionati)** | CPU richiesta < 30% dell'allocabile secondo Container Insights, richiede `--live-pricing` | Risparmio: (nodi − nodi suggeriti) × prezzo istanza |
| **EKS Volumi PVC orfani** | Volume EBS creato da Kubernetes non attaccato, oppure cluster proprietario non più esistente | gp3: $0,08/GB-mese · gp2: $0,10/GB-mese (stessa tabella di EBS Volumes) |
| **AMI (inutilizzate)** | AMI di proprietà non referenziata da nessuna istanza o launch template | Costo degli snapshot EBS sottostanti, $0,05/GB-mese |
| **Immagini ECR (senza tag)** | Immagine dangling (nessun tag) in un repository | $0,10/GB-mese |
| **Multipart upload S3 (abbandonati)** | Multipart upload incompleto, mai completato né annullato | $0,023/GB-mese (tariffa storage Standard sulle parti caricate) |
| **Snapshot RDS manuali (vecchi)** | Snapshot manuale più vecchio del periodo di grazia | $0,095/GB-mese |
| **Secret Secrets Manager (inutilizzati)** | Mai acceduti, o non acceduti negli ultimi 30 giorni | $0,40/segreto/mese fisso |

Ogni finding è anche etichettato `waste` o `optimization`: `waste` è denaro speso ora e contribuisce al totale principale e al gate CI; `optimization` (gp2→gp3, EC2/RDS underutilized, S3 no-lifecycle, Lambda underutilized, DynamoDB overprovisioned, Aurora Serverless overprovisioned, SageMaker Models orfani, EKS Node Groups sovradimensionati) è un'opportunità di risparmio che mantiene la risorsa, mostrata a parte e mai usata come gate. `EC2/RDS Instances (underutilized)`, `S3 Buckets (no lifecycle)`, `DynamoDB Tables (overprovisioned)`, `Aurora Serverless v2 (Min ACU sovradimensionato)`, `SageMaker Models (orfani)` e `EKS Node Groups (sovradimensionati)` sono inoltre delle *stime* — da verificare prima di agire.

> **Nota onesta (Lambda):** controlliamo solo il numero di invocazioni nella finestra di osservazione, nient'altro. **Non** facciamo rightsizing della memoria — richiederebbe Lambda Insights (costo extra, da attivare per ogni funzione), fuori scope per uno scan read-only senza permessi IAM aggiuntivi. Una funzione con zero invocazioni ha per definizione $0 di costo diretto (pay-per-use); il valore di questo finding è igiene (codice morto, ruoli IAM/event source inutili), non un risparmio in dollari. Non rileva nemmeno la **Provisioned Concurrency** idle, che invece *è* fatturata indipendentemente dalle invocazioni — fuori scope per ora.

> **Nota onesta (rightsizing):** il check di sottoutilizzo è un'euristica su una singola metrica — CPU massima sotto una soglia nella finestra di osservazione, nient'altro. **Non** guarda RAM, throughput di rete, IOPS o numero di connessioni, quindi non può dirti *quale* instance type più piccolo sia davvero adatto. Lo facciamo così perché non richiede permessi IAM aggiuntivi e funziona uguale su ogni account; non sostituiamo [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/), che modella più metriche e raccomanda un target specifico. Tratta il nostro finding come "vai a controllare questa istanza", non come una raccomandazione di sizing — verifica con Compute Optimizer (o con le tue metriche) prima di ridimensionare.

> **Nota onesta (EKS):** il check sul sovradimensionamento dei nodi legge gli aggregati **a livello di nodo** di Container Insights (`node_cpu_request`/`node_cpu_limit`) tramite la sola AWS API — non vede mai le richieste/limiti dei singoli Pod e non parla con la Kubernetes API (nessun kubeconfig, vedi ADR-0066). Se Container Insights non è attivo sul cluster, lo scanner non segnala nulla invece di indovinare. Tratta il numero di nodi suggerito come punto di partenza per l'indagine, non come raccomandazione di sizing. Separatamente, il check sui volumi PVC orfani può recuperare il nome del cluster proprietario solo dal tag legacy `kubernetes.io/cluster/<nome>` — i volumi creati dal CSI driver senza `--extra-tags` non lo portano, quindi vengono segnalati solo tramite il check "non attaccato", mai tramite quello sul cluster cancellato.

> **Nota onesta (verifica su AWS reale):** 36 dei 43 scanner hanno trovato uno spreco reale su un account AWS live (33 originali + `ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, confermati il 2026-07-22). Altri 2 — `rds-manual-snapshot-old`, `secretsmanager-unused` — sono girati end-to-end sullo stesso account reale senza nessun errore SDK/IAM/parsing, ma senza trovare nulla da segnalare (nessuno snapshot manuale presente da listare; il secret di test era più giovane del grace period di 30 giorni) — quindi la chiamata e la shape della risposta sono confermate live, ma il percorso finding+policy non ancora. I restanti 5 — `rds-underutilized`, `environment-ghost`, `sqs-dlq-abandoned`, `aurora-serverless-overprovisioned`, `eks-node-overprovisioned` — restano non verificati per scelta, non per dimenticanza: richiedono risorse che hanno accumulato pattern d'uso reali e organici per 7-14 giorni, cosa che uno stack di test sintetico di breve durata non può produrre. Tutti e 43 sono comunque coperti da unit test e contract test a fixture replay (risposte AWS mockate), indipendentemente dallo stato di verifica live. Vedi [test.md](test.md#stato-della-verifica-su-aws-reale-più-ampia-di-verify-against-awsmjs) per il dettaglio completo.

**Protezioni contro i falsi positivi (waste policies):**

- **Periodo di grazia** — le risorse più giovani di 7 giorni (configurabile con `--min-age-days`) non vengono mai segnalate. Per le EC2 la data di stop è ricostruita da `StateTransitionReason`; per NAT Gateway e Load Balancer si usa la data di creazione.
- **Tag di esclusione** — qualunque risorsa con il tag `cloudrift:ignore` (configurabile con `--ignore-tag`) viene saltata.
- **Snapshot legati ad AMI** — gli snapshot orfani referenziati da un'AMI registrata non vengono segnalati (non sarebbero comunque cancellabili).

> I prezzi variano per regione. Il tool usa prezzi specifici per: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Ogni report indica la data di ultima verifica del listino (`prices as of`).

---

### Confronto e trend di spesa (`cost` / `trend`)

Oltre alla waste detection, cloudrift può anche confrontare e tracciare la spesa AWS reale via Cost Explorer:

```sh
cloudrift cost                          # questo mese finora vs. gli stessi giorni del mese scorso, per servizio
cloudrift trend --months 12             # spesa mensile negli ultimi 12 mesi, grafico a barre ANSI
```

> ⚠️ A differenza di ogni scanner sopra (chiamate describe/list gratuite), `cost`/`trend` chiamano **AWS Cost Explorer, che fattura $0.01 a richiesta** — gli unici comandi di cloudrift che possono generare un costo AWS. Entrambi chiedono conferma prima della prima chiamata (saltabile con `-y`/`--yes`); i periodi di fatturazione chiusi vengono cachati su disco così rilanciare lo stesso comando per le stesse date non fattura di nuovo. Vedi [Utilizzo](#utilizzo) per il riferimento completo dei flag.

---

<details>
<summary><strong>Utilizzo</strong> — flag, esempi, report PDF, gestione errori parziali, prezzi per regione</summary>

### Utilizzo

```sh
node apps/cli/dist/main.js analyze [opzioni]
```

| Opzione                      | Descrizione                                                                                                          | Default            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare                                                                                           | `us-east-1`        |
| `--format <format>`          | Formato di stdout: `table`, `json` o `markdown` (per CI / commenti PR)                                              | `table`            |
| `--config <path>`            | Percorso del file di config (default: `cloudrift.config.json` / `.cloudriftrc` nella cwd)                          | auto-rilevato      |
| `--live-pricing`             | Recupera i prezzi di listino correnti dall'AWS Pricing API (fallback alla tabella statica; i prezzi del config vincono) | off (tabella statica) |
| `--scanners <kinds...>`      | Esegue solo questi servizi (elenco di resource kind separati da spazio, es. `ebs-volume elastic-ip`); salta il picker interattivo | — |
| `--all-services`             | Esegue tutti gli scanner senza il picker interattivo                                                                  | on in CI / non-TTY |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                            | auto-rilevato      |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate (ha precedenza sul config)              | `7`                |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report (ha precedenza sul config)                                     | `cloudrift:ignore` |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `cloudrift-report-YYYY-MM-DD.pdf`)                                      | —                  |
| `--json [filename]`          | Scrive anche un report JSON su disco (default `cloudrift-report-YYYY-MM-DD.json`)                                   | —                  |
| `--silent`                   | Sopprime tutto l'output su stdout (banner, report, conferme) — usalo con `--pdf`/`--json` per ottenere solo il file | off                |
| `-h, --help`                 | Mostra l'help                                                                                                        | —                  |

> **stdout vs. file:** `--format` controlla cosa va su **stdout** (il report). `--json` / `--pdf` scrivono **file aggiuntivi** su disco, indipendenti da `--format` — di default il `--format` scelto continua comunque a essere stampato su stdout *in aggiunta* alla scrittura di quei file (quindi es. `--pdf` da solo mostra comunque la tabella). Aggiungi `--silent` per ottenere solo il file, senza nulla stampato a terminale. Nei formati machine-readable (`json`, `markdown`) tutti i messaggi umani vanno su stderr, così su stdout resta solo il report — ideale per il piping. Errori e l'alert della soglia di costo vanno sempre su stderr, anche con `--silent`.
>
> **Ordine dei flag con `--pdf`/`--json`:** il filename è un valore *opzionale* (`--pdf [filename]`), quindi viene raccolto solo se segue immediatamente il flag — `--pdf --silent ./report.pdf` fallisce ("too many arguments") perché `--silent` impedisce a `--pdf` di vedere il filename, lasciando `./report.pdf` senza nulla a cui agganciarsi. Tieni il filename subito dopo il flag (`--pdf ./report.pdf --silent`), oppure usa `=` per rendere l'ordine irrilevante: `--pdf=./report.pdf --silent --format json`.
>
> **Scegliere quali servizi scansionare:** lanciando `analyze` in un vero terminale (e fuori da CI) appare un picker interattivo — una checklist di tutti gli scanner, tutti pre-selezionati, così premere Invio scansiona tutto come prima. Deseleziona quello che non ti serve, oppure salta del tutto il picker con `--scanners <kinds...>` (elenco esplicito) o `--all-services` (scansiona tutto, nessun prompt). In CI o ogni volta che stdout non è un terminale, il picker non appare mai e viene eseguito ogni scanner di default — l'automazione non resta mai bloccata in attesa di input.

**Esempi:**

```sh
# Scansione nella regione di default (us-east-1)
node apps/cli/dist/main.js analyze

# Più regioni contemporaneamente
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disattiva il periodo di grazia (segnala risorse di qualsiasi età)
node apps/cli/dist/main.js analyze --min-age-days 0

# Scansiona solo EBS volumes ed Elastic IP, saltando il picker interattivo
node apps/cli/dist/main.js analyze --scanners ebs-volume elastic-ip

# Scansiona tutto senza il picker interattivo (es. in uno script lanciato da terminale)
node apps/cli/dist/main.js analyze --all-services

# Esporta un report PDF con nome automatico (reports/AWS_report_YYYY_MM_DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Come sopra, ma senza nulla stampato a terminale — solo il file
node apps/cli/dist/main.js analyze --pdf ./report.pdf --silent

# Output machine-readable (es. per una dashboard o un check CI)
node apps/cli/dist/main.js analyze --format json | jq '.totalWasteMonthlyUsd'

# Filtra i findings con jq (findings è un array flat, componibile)
node apps/cli/dist/main.js analyze --format json | jq '.findings[] | select(.category=="waste")'

# Report Markdown (es. commento PR / step summary su GitHub Actions)
node apps/cli/dist/main.js analyze --format markdown >> "$GITHUB_STEP_SUMMARY"
```

**Report PDF:**

Il flag `--pdf` genera un PDF in aggiunta all'output console (aggiungi `--silent` per sopprimere l'output console e ottenere solo il file). Il report contiene:

- **Executive summary** — totale spreco mensile e annuale, numero di risorse, breakdown per tipo
- **Top raccomandazioni** — fino a 8 voci ordinate per impatto mensile, con risparmio annuale stimato
- **Pagine di dettaglio** — una tabella per ogni tipo di risorsa trovata (EBS, Elastic IP, RDS, Load Balancer, EC2, Snapshot, NAT Gateway)
- **Scan warnings** — elencati se alcuni tipi di risorsa non hanno potuto essere scansionati

```sh
# Dopo aver eseguito con --pdf vedrai:
#   Generating PDF report... saved to /path/to/reports/AWS_report_2026_06_09.pdf
```

**Output di esempio:**

```
  Scanning us-east-1 (account 123456789012) for wasted cloud resources...

  EBS Volumes — Unattached
  ┌────────────────────┬───────────┬────────┬──────┬────────────┬────────────┐
  │ Volume ID          │ Region    │ Size   │ Type │ Created    │ Est. Cost  │
  ├────────────────────┼───────────┼────────┼──────┼────────────┼────────────┤
  │ vol-0abc123def456  │ us-east-1 │ 500 GB │ gp3  │ 2025-01-15 │ $40.00/mo  │
  └────────────────────┴───────────┴────────┴──────┴────────────┴────────────┘

  Total estimated waste: $40.00/month
```

**Comportamento in caso di errori parziali:**

Se la scansione di un tipo di risorsa fallisce (es. permessi mancanti su CloudWatch per i NAT Gateway), il tool:

- restituisce comunque tutti gli altri risultati disponibili
- mostra una sezione "Scan Warnings" con i dettagli dell'errore
- indica il totale come `(incomplete — see warnings above)`

```
  ⚠ Scan Warnings
  • NAT Gateways: Access denied to CloudWatch metrics

  Total estimated waste: $56.20/month (incomplete — see warnings above)
```

**Prezzi per regione:**

I prezzi sono per-regione (file `prices.json` nell'infrastruttura). Regioni supportate con prezzi specifici: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Per le altre regioni viene usato il prezzo di default (us-east-1).

#### `cost` / `trend` — confronto e trend di spesa

> ⚠️ Chiamano AWS Cost Explorer, che fattura **$0.01 a richiesta** — gli unici comandi di cloudrift che possono generare un costo AWS. Chiedono conferma prima della prima chiamata a meno di `-y`/`--yes`, `--silent`, o esecuzione fuori da un TTY/in CI. I periodi chiusi vengono cachati su disco (`~/.cloudrift/cache/cost-explorer/`). Nessuno dei due comandi ha un flag `--regions` — Cost Explorer è un endpoint globale unico.

| Opzione (`cost`) | Descrizione | Default |
| --- | --- | --- |
| `--account-id <id>` | Override account ID | auto-rilevato |
| `--format <format>` | `table` o `json` | `table` |
| `--fail-on-increase <pct>` | Esce con codice 2 se la spesa è aumentata più di questa percentuale | off |
| `--refresh-cache` | Ignora la cache locale | off |
| `-y, --yes` | Salta la conferma di fatturazione | — |
| `--pdf [filename]` | Scrive anche un PDF | — |

| Opzione (`trend`) | Descrizione | Default |
| --- | --- | --- |
| `--months <n>` | Mesi solari da mostrare (1–36) | `6` |
| `--services <nomi...>` | Limita a questi servizi (es. `ec2 s3`) | tutti |
| `--format <format>` | `table` (grafico ANSI) o `json` | `table` |
| `--refresh-cache` / `-y, --yes` / `--pdf [filename]` | Come `cost` | — |

```sh
node apps/cli/dist/main.js cost --fail-on-increase 20 --format json
node apps/cli/dist/main.js trend --months 12 --services ec2 s3 --yes
```

Riferimento completo, comportamento della cache e dettagli sulla conferma di fatturazione: [docs/en/usage.md](../en/usage.md#cost--trend--spend-comparison-and-monthly-trend) (in inglese) o [utilizzo.md](./utilizzo.md#cost--trend--confronto-e-trend-di-spesa).

</details>

<details>
<summary><strong>File di configurazione</strong> — campi di <code>cloudrift.config.json</code>, override, tuning falsi positivi</summary>

### File di configurazione

cloudrift legge `cloudrift.config.json` (o `.cloudriftrc`) dalla directory corrente, oppure il percorso passato con `--config`. I flag CLI hanno la precedenza sul file di config, che a sua volta ha la precedenza sui default. Tutti i campi sono opzionali:

> **Dove va il file?** È un file **tuo**, non fa parte dell'artefatto pubblicato. Metti `cloudrift.config.json` nella directory da cui lanci la CLI — tipicamente la root del tuo repo, **committato** così viene preso automaticamente in CI (dopo `actions/checkout`) e condiviso dal team. La ricerca si basa sulla working directory corrente, indipendentemente da come viene invocata la CLI. Se il file sta altrove, indicalo con `--config percorso/del/file.json`.

```json
{
  "excludeRegions": ["us-gov-east-1"],
  "excludeTagValues": { "Environment": "Production" },
  "cloudwatchWindowHours": 168,
  "utilizationWindowHours": 168,
  "minAgeDays": 14,
  "ignoreTag": "cloudrift:ignore",
  "costAlertThresholdUsd": 500,
  "prices": {
    "eu-west-1": { "nat-gateway": 28.5, "ebs-gp3": 0.07 },
    "default": { "elastic-ip": 3.2 }
  },
  "thresholds": {
    "ebsIdleMaxOps": 0,
    "ec2CpuPercent": 5,
    "rdsCpuPercent": 5
  }
}
```

| Campo                     | Significato                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `excludeRegions`          | Regioni saltate anche se passate con `-r`                                                                |
| `excludeTagValues`        | Esclude le risorse con un tag `chiave: valore` esatto (es. non toccare `Environment: Production`)        |
| `cloudwatchWindowHours`   | Finestra CloudWatch per i check "zero-attività" (NAT Gateway, EBS idle) (default 48, max 168 = 7 giorni) |
| `utilizationWindowHours`  | Finestra CloudWatch per i check di utilizzo CPU (EC2/RDS underutilized) (default 168 = 7 giorni, max 336 = 14 giorni) |
| `minAgeDays`              | Periodo di grazia in giorni (come `--min-age-days`)                                                      |
| `ignoreTag`               | Tag di esclusione (come `--ignore-tag`)                                                                  |
| `costAlertThresholdUsd`   | Se il totale **waste** (`totalWasteMonthlyUsd`) supera questa soglia, il comando **esce con codice 2** (per far fallire la pipeline); i risparmi di optimization non contano mai per questo gate |
| `prices`                  | Override prezzi per regione (stessa forma del listino built-in): `regione → { chiave: USD }`, con `default` come fallback. Usalo per le tue **tariffe negoziate/aziendali** |
| `thresholds.ebsIdleMaxOps` | Operazioni I/O CloudWatch totali sotto cui un volume EBS attaccato conta come idle (default `0`)      |
| `thresholds.ec2CpuPercent` | CPU massima % sotto cui un'istanza EC2 running conta come sottoutilizzata (default `5`)                |
| `thresholds.rdsCpuPercent` | CPU massima % sotto cui un'istanza RDS disponibile conta come sottoutilizzata (default `5`)            |

> Un NAT Gateway di staging senza traffico nel weekend è il classico falso positivo: allarga `cloudwatchWindowHours` a `168` così un weekend tranquillo non lo segnala.
> Un workload batch che picca la CPU solo una volta a settimana ha bisogno di un `utilizationWindowHours` più ampio (fino a `336`) per non essere segnalato come sottoutilizzato per via di un campione di 7 giorni troppo tranquillo.

</details>

<details>
<summary><strong>Fonti dei prezzi</strong> — tabella statica, AWS Pricing API live, tuoi override</summary>

### Fonti dei prezzi

I costi sono risolti da tre livelli; vince il più specifico, per `(regione, chiave)`:

1. **I tuoi override `prices`** (config) — le tue tariffe negoziate/aziendali. **Massima priorità.**
2. **AWS Pricing API** (`--live-pricing`) — listino pubblico corrente, recuperato all'avvio.
3. **Tabella statica built-in** (`prices.json`) — sempre presente come fallback.

Ogni report mostra `prices as of` (la data dello statico, quella del fetch live, o `+ custom overrides`).

> **Nota onesta:** anche con `--live-pricing`, AWS restituisce i prezzi di **listino**, non la *tua* bolletta — Savings Plans, Reserved Instances e sconti EDP non sono riflessi. Gli override `prices` sono l'unico modo per far combaciare il report con ciò che paghi davvero. Tutto ciò che il live non riesce a risolvere in modo univoco ricade sulla tabella statica.

</details>

<details>
<summary><strong>Uso in CI/CD</strong> — esempio GitHub Actions, gate di budget</summary>

### Uso in CI/CD

cloudrift è pensato per girare dentro le pipeline, non solo nel terminale. Due ingredienti lo rendono CI-friendly:

1. `--format markdown` produce un commento pronto per le Pull Request (totali, breakdown, raccomandazioni principali).
2. `costAlertThresholdUsd` nel config fa **uscire con codice 2** quando lo spreco supera il budget, facendo fallire il job.

**GitHub Actions — come azione riutilizzabile.** [`action.yml`](../../action.yml) nella root del repo incapsula `npm install -g @cloudrift/cli` + `cloudrift analyze`, pubblica il report markdown nel job summary, e fa fallire il job con gli stessi exit code della CLI (`2` = oltre budget).

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # per cloudrift.config.json, letto dalla cwd

      # OIDC o chiavi statiche — qui statiche, dai secret del repo
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - uses: elleVas/cloudrift@v0.5.1
        with:
          regions: us-east-1 eu-west-1
          config: cloudrift.config.json
```

Con un `cloudrift.config.json` committato (`{"costAlertThresholdUsd": 500}`), l'azione fa fallire il check automaticamente quando lo spreco supera il budget — la pipeline si blocca quando nuove risorse lo spingono oltre la soglia. Vedi `action.yml` per tutti gli input (`live-pricing`, `scanners`, `min-age-days`, `ignore-tag`, `pdf`, `json`, `format`, `version`, …) e gli output `report`/`exit-code`.

**GitHub Actions — compilando dai sorgenti:** alternativa se preferisci puntare a un commit non ancora rilasciato invece che a una versione pubblicata.

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: elleVas/cloudrift
          path: cloudrift-cli

      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm', cache-dependency-path: cloudrift-cli/pnpm-lock.yaml }

      - run: pnpm install --frozen-lockfile
        working-directory: cloudrift-cli
      - run: pnpm nx build cli
        working-directory: cloudrift-cli

      # OIDC o chiavi statiche — qui statiche, dai secret del repo
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      # Pubblica il report markdown nel job summary; esce 2 se oltre costAlertThresholdUsd
      # (cloudrift.config.json viene letto dal checkout di *questo* repo, la cwd)
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 --format markdown >> "$GITHUB_STEP_SUMMARY"
```

Con un `cloudrift.config.json` committato (`{"costAlertThresholdUsd": 500}`), il codice di uscita 2 dell'ultimo step fa fallire il check automaticamente — la pipeline si blocca quando nuove risorse spingono lo spreco oltre la soglia.

</details>

<details>
<summary><strong>Policy as Code (OPA)</strong> — regole più espressive del gate di budget, con Open Policy Agent</summary>

### Policy as Code (OPA)

Il gate `costAlertThresholdUsd` qui sopra è un singolo confronto totale-vs-budget. Per qualcosa di più specifico — regole per tag, per tipo di risorsa, per conteggio — cloudrift include policy [Open Policy Agent](https://www.openpolicyagent.org/) di esempio che valuti tu contro il suo output JSON, nella tua pipeline. cloudrift non esegue mai OPA da sé; produce solo JSON, esattamente come già fa.

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

Vedi [policy-as-code.md](policy-as-code.md) per una guida da zero e [policy/README.md](../../policy/README.md) per cosa verifica ogni policy di esempio. Motivazione per tenere questo livello esterno alla CLI: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).

</details>

### Permessi IAM necessari

Il principal AWS deve avere le seguenti permission in sola lettura:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeVolumes",
    "ec2:DescribeAddresses",
    "ec2:DescribeInstances",
    "ec2:DescribeSnapshots",
    "ec2:DescribeImages",
    "ec2:DescribeNatGateways",
    "ec2:DescribeNetworkInterfaces",
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "rds:DescribeDBClusters",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "logs:DescribeLogGroups",
    "s3:ListAllMyBuckets",
    "s3:GetBucketLifecycleConfiguration",
    "lambda:ListFunctions",
    "elasticfilesystem:DescribeFileSystems",
    "dynamodb:ListTables",
    "dynamodb:DescribeTable",
    "elasticache:DescribeCacheClusters",
    "sagemaker:ListNotebookInstances",
    "sagemaker:ListEndpoints",
    "sagemaker:DescribeEndpoint",
    "sagemaker:DescribeEndpointConfig",
    "sagemaker:ListEndpointConfigs",
    "sagemaker:ListModels",
    "sagemaker:DescribeModel",
    "sagemaker:ListTags",
    "sqs:ListQueues",
    "sqs:GetQueueAttributes",
    "sqs:ListDeadLetterSourceQueues",
    "sqs:ListQueueTags",
    "tag:GetResources",
    "eks:ListClusters",
    "eks:ListNodegroups",
    "eks:DescribeNodegroup",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

> `--live-pricing` richiede in più `pricing:GetProducts` (AWS Pricing API). **Non** serve per il pricing statico di default.

<details>
<summary><strong>Sviluppo</strong> — modalità watch, test per libreria, lint, typecheck</summary>

### Sviluppo

```sh
# Avvia la CLI in modalità watch (ricompila automaticamente)
pnpm nx serve cli

# Esegui tutti i test
pnpm nx run-many -t test

# Esegui i test di una singola libreria
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

Il logging diagnostico è opt-in tramite `DEBUG=cloudrift:*` (es. `DEBUG=cloudrift:* cloudrift analyze ...`), disattivato di default. Scrive su stderr, separato dal report — ma il suo output include ID di risorse AWS (volume ID, instance ID, ecc.) del tuo account. Non incollare l'output di `DEBUG` in una issue GitHub pubblica né condividerlo fuori dalla tua organizzazione senza prima controllarlo.

</details>

### Rilascio

La pubblicazione di `@cloudrift/cli` su npm è automatica tramite un workflow attivato dai tag. Vedi [rilascio.md](rilascio.md) per il processo completo (setup una tantum org npm / `NPM_TOKEN`, come pubblicare una release, verifica in locale).

### Architettura

cloudrift usa un'architettura DDD a strati (Ports & Adapters) con un modello a plugin: ogni tipo di risorsa è un'implementazione di `WasteScannerPort` e il use case coordinatore è generico sugli scanner registrati — le dipendenze puntano sempre verso l'interno, dalla CLI attraverso il layer applicativo fino al domain. Vedi [architettura.md](architettura.md) per la scomposizione in layer, il razionale delle scelte e il percorso multi-cloud.

### Documentazione tecnica

Tutta la documentazione è nella cartella [`docs/`](../) — italiano in [`docs/it/`](.), inglese in [`docs/en/`](../en/):

| File (IT)                                                | Contenuto                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| [architettura.md](architettura.md)                        | Scelte architetturali, layer del sistema, percorso multi-cloud    |
| [scelte-tecniche.md](scelte-tecniche.md)                   | Nx, pnpm, TypeScript, AWS SDK v3, Result pattern, jest             |
| [funzionamento.md](funzionamento.md)                       | Flusso di esecuzione end-to-end, spiegazione del codice           |
| [aggiungere-risorsa.md](aggiungere-risorsa.md)             | Guida passo per passo per aggiungere un nuovo tipo di risorsa     |
| [test.md](test.md)                                         | Piramide dei test, dove vive ogni livello, verifica manuale AWS   |
| [policy-as-code.md](policy-as-code.md)                     | Guida OPA da zero per le policy di esempio in `policy/`           |
| [rilascio.md](rilascio.md)                                 | Come `@cloudrift/cli` viene buildato e pubblicato su npm           |
| [scanner-verticali-guida.md](scanner-verticali-guida.md)   | Gli scanner verticali di Phase 6 (Serverless, Aurora, SageMaker, Dev/PR, EKS) — cosa rilevano, i loro limiti, come configurarli |

## Licenza

Apache License 2.0 — vedi [LICENSE.md](../../LICENSE.md). Libero da usare, modificare e distribuire, anche commercialmente.
