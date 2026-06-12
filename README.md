# cloudrift

> 🇮🇹 [Italiano](#-italiano) · 🇬🇧 [English](#-english)

---

## 🇬🇧 English

**cloudrift** is a command-line tool that scans AWS accounts for wasted resources and estimates the monthly cost of that waste.

### What it detects

| Resource           | Waste condition                             | Estimated cost (us-east-1)                              |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| **EBS Volumes**    | Unattached (`state: available`)             | gp3: $0.08/GB-mo · gp2: $0.10/GB-mo · io1: $0.125/GB-mo |
| **Elastic IPs**    | Unassociated (no EC2/NAT binding)           | $3.60/month fixed                                       |
| **RDS Instances**  | Stopped (still billed for storage)          | gp2/gp3: $0.115/GB-month                                |
| **Load Balancers** | No registered targets (ALB/NLB)             | ~$16.20/month fixed                                     |
| **EC2 Instances**  | Stopped — attached EBS volumes keep billing | Sum of attached EBS volumes                             |
| **EBS Snapshots**  | Source volume deleted (orphan snapshots)    | $0.05/GB-month                                          |
| **NAT Gateways**   | Zero outbound traffic in the last 48h       | ~$32.40/month fixed                                     |

**False-positive guards (waste policies):**

- **Grace period** — resources younger than 7 days (configurable via `--min-age-days`) are never reported. For EC2 the stop time is reconstructed from `StateTransitionReason`; for NAT Gateways and Load Balancers the creation time is used.
- **Exclusion tag** — any resource tagged `cloudrift:ignore` (configurable via `--ignore-tag`) is skipped.
- **AMI-bound snapshots** — orphan snapshots referenced by a registered AMI are not reported (they cannot be deleted anyway).

> Prices vary by region. The tool uses region-specific pricing for: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Every report states the date the price table was last verified (`prices as of`).

### Prerequisites

- **Node.js 20+** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`, check with `pnpm --version`
- **AWS credentials** with read-only permissions (see [Required IAM permissions](#required-iam-permissions) below)

---

### Quick Start

Follow these steps in order to go from zero to seeing output.

#### Step 1 — Clone and install

```sh
git clone <repo-url>
cd cloudrift
pnpm install
```

#### Step 2 — Configure AWS credentials

Three options, in order of preference:

**Option A — AWS CLI (recommended if you already have it installed)**

```sh
aws configure
# enter: Access Key ID, Secret Access Key, default region (e.g. us-east-1), output format (json)
```

This creates `~/.aws/credentials` with the `default` profile.

**Option B — Edit `~/.aws/credentials` manually**

```ini
[default]
aws_access_key_id     = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Option C — Environment variables**

```sh
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

> **Verify:** `aws sts get-caller-identity` should return your account ID without errors.

#### Step 3 — Make sure you have the right IAM permissions

The AWS user/role must have the policy listed in [Required IAM permissions](#required-iam-permissions) below. If using an IAM user, attach it from the [IAM Console](https://console.aws.amazon.com/iam/) → User → Add permissions → Create inline policy.

#### Step 4 — Build

```sh
pnpm nx build cli
```

Output is compiled to `apps/cli/dist/`.

#### Step 5 — Run

```sh
# Scan us-east-1 (default) — the account ID is auto-detected via STS
node apps/cli/dist/main.js analyze

# Scan multiple regions
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1
```

If everything is configured correctly you'll see tables listing the wasted resources found and an estimated total cost. If the account has no wasted resources you'll see "No wasted resources found".

---

### Usage

```sh
node apps/cli/dist/main.js analyze [options]
```

| Option                       | Description                                                                                                    | Default            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan                                                                                            | `us-east-1`        |
| `--account-id <id>`          | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted)                               | auto-detected      |
| `--min-age-days <days>`      | Grace period: resources younger than this many days are not reported                                           | `7`                |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report                                                       | `cloudrift:ignore` |
| `--pdf [filename]`           | Export a PDF report; if no filename is given, saves `cloudrift-report-YYYY-MM-DD.pdf` in the current directory | —                  |
| `--json [filename]`          | Output the report as JSON; with no filename, prints JSON to stdout (suppresses the table output)               | —                  |
| `-h, --help`                 | Show help                                                                                                      | —                  |

**Examples:**

```sh
# Scan the default region (us-east-1)
node apps/cli/dist/main.js analyze

# Scan multiple regions at once
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disable the grace period (report resources of any age)
node apps/cli/dist/main.js analyze --min-age-days 0

# Export a PDF report with auto-generated filename (cloudrift-report-YYYY-MM-DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Machine-readable output (e.g. to feed a dashboard or CI check)
node apps/cli/dist/main.js analyze --json | jq '.totalMonthlyCostUsd'

# Save the JSON report to a file alongside the console output
node apps/cli/dist/main.js analyze --json report.json
```

**PDF report:**

The `--pdf` flag generates a PDF alongside the normal console output. The report contains:

- **Executive summary** — monthly and annual waste totals, resource count, per-type breakdown
- **Top recommendations** — up to 8 items sorted by monthly savings potential, with estimated annual saving
- **Detail pages** — one table per resource type found (EBS volumes, Elastic IPs, RDS, Load Balancers, EC2, Snapshots, NAT Gateways)
- **Scan warnings** — listed if any resource type could not be scanned

```sh
# After running with --pdf you will see:
#   Generating PDF report... saved to /path/to/cloudrift-report-2026-06-09.pdf
```

**Partial failure handling:**

If scanning a resource type fails (e.g. missing CloudWatch permissions for NAT Gateways), the tool:

- still returns all other results
- displays a "Scan Warnings" section with the error details
- marks the total as `(incomplete — see warnings above)`

```
  ⚠ Scan Warnings
  • NAT Gateways: Access denied to CloudWatch metrics

  Total estimated waste: $56.20/month (incomplete — see warnings above)
```

**Per-region pricing:**

Prices are region-aware (defined in `prices.json` in the infrastructure layer). Regions with explicit pricing: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. All other regions fall back to us-east-1 defaults.

### Required IAM permissions

The AWS principal needs the following read-only permissions:

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
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

### Development

```sh
# Start CLI in watch mode (auto-rebuild on change)
pnpm nx serve cli

# Run all tests
pnpm nx run-many -t test

# Run a single library's tests
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

### Architecture

The project uses a DDD layered architecture (Ports & Adapters) with a plugin model: every resource type is a `WasteScannerPort` implementation, and the coordinator use case is generic over the registered scanners.

```
apps/cli/                          → CLI entry point (Commander.js), presenters
libs/shared/kernel/                → Reusable base classes (Entity, ValueObject, Result)
libs/cloud-cost/domain/            → Entities, value objects, waste policies, ports
libs/cloud-cost/application/       → Generic use case + serializable report DTO
libs/cloud-cost/infrastructure/
  aws-adapter/                     → AWS SDK v3 scanners, pricing, STS account resolver
```

Dependencies always point inward: CLI → Application → Domain ← AWS Adapter.

### Technical documentation

Full documentation is in the [`docs/`](./docs/) folder — English in [`docs/en/`](./docs/en/), Italian in [`docs/it/`](./docs/it/):

| File (EN)                                                       | Content                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [docs/en/architecture.md](./docs/en/architecture.md)            | Architectural decisions, layers, multi-cloud path      |
| [docs/en/technical-choices.md](./docs/en/technical-choices.md)  | Nx, pnpm, TypeScript, AWS SDK v3, Result pattern, jest |
| [docs/en/how-it-works.md](./docs/en/how-it-works.md)            | End-to-end execution flow, code walkthrough            |
| [docs/en/adding-a-resource.md](./docs/en/adding-a-resource.md)  | Step-by-step guide to adding a new resource type       |

### Adding a new resource type

See [docs/en/adding-a-resource.md](./docs/en/adding-a-resource.md) for a complete walkthrough. In short:

1. Add the new kind to the `ResourceKind` union (`wasted-resource.ts`) — the compiler then points to every spot that needs updating
2. Add the entity to `libs/cloud-cost/domain/src/entities/` implementing `WastedResource`
3. Add a waste policy in `libs/cloud-cost/domain/src/policies/` (grace period and ignore tag come for free from the base class)
4. Add pricing to `PricingPort`, `StaticPriceTableAdapter` and `prices.json`
5. Implement the scanner in `libs/cloud-cost/infrastructure/aws-adapter/src/scanners/` (implements `WasteScannerPort`)
6. Add the presenter entry in `apps/cli/src/formatters/resource-presenters.ts` and register the scanner in `analyze-waste.command.ts`

No changes to `AnalyzeCloudWasteUseCase`, the summary, or the report DTO are needed.

## 🇮🇹 Italiano

**cloudrift** è uno strumento da riga di comando che scansiona account AWS alla ricerca di risorse inutilizzate e stima il costo mensile di eventuali sprechi.

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

**Protezioni contro i falsi positivi (waste policies):**

- **Periodo di grazia** — le risorse più giovani di 7 giorni (configurabile con `--min-age-days`) non vengono mai segnalate. Per le EC2 la data di stop è ricostruita da `StateTransitionReason`; per NAT Gateway e Load Balancer si usa la data di creazione.
- **Tag di esclusione** — qualunque risorsa con il tag `cloudrift:ignore` (configurabile con `--ignore-tag`) viene saltata.
- **Snapshot legati ad AMI** — gli snapshot orfani referenziati da un'AMI registrata non vengono segnalati (non sarebbero comunque cancellabili).

> I prezzi variano per regione. Il tool usa prezzi specifici per: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Ogni report indica la data di ultima verifica del listino (`prices as of`).

### Prerequisiti

- **Node.js 20+** — verifica con `node --version`
- **pnpm** — installa con `npm install -g pnpm`, poi verifica con `pnpm --version`
- **Credenziali AWS** con permessi in sola lettura (vedi sezione [Permessi IAM](#permessi-iam-necessari) qui sotto)

---

### Guida rapida

Segui questi passi nell'ordine per passare da zero all'output del tool.

#### Passo 1 — Clona il repository e installa le dipendenze

```sh
git clone <repo-url>
cd cloudrift
pnpm install
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

#### Passo 4 — Build

```sh
pnpm nx build cli
```

L'output viene compilato in `apps/cli/dist/`.

#### Passo 5 — Esegui

```sh
# Scansione su us-east-1 (default) — l'account ID viene rilevato automaticamente via STS
node apps/cli/dist/main.js analyze

# Scansione su più regioni
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1
```

Se tutto è configurato correttamente vedrai tabelle con le risorse sprecate trovate e il totale stimato. Se un account non ha risorse sprecate vedrai un messaggio "No wasted resources found".

---

### Utilizzo

```sh
node apps/cli/dist/main.js analyze [opzioni]
```

| Opzione                      | Descrizione                                                                                                          | Default            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare                                                                                           | `us-east-1`        |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                            | auto-rilevato      |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate                                          | `7`                |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report                                                                 | `cloudrift:ignore` |
| `--pdf [filename]`           | Esporta un report PDF; se non si specifica un nome, salva `cloudrift-report-YYYY-MM-DD.pdf` nella directory corrente | —                  |
| `--json [filename]`          | Output del report in JSON; senza filename stampa il JSON su stdout (sopprime l'output tabellare)                     | —                  |
| `-h, --help`                 | Mostra l'help                                                                                                        | —                  |

**Esempi:**

```sh
# Scansione nella regione di default (us-east-1)
node apps/cli/dist/main.js analyze

# Più regioni contemporaneamente
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disattiva il periodo di grazia (segnala risorse di qualsiasi età)
node apps/cli/dist/main.js analyze --min-age-days 0

# Esporta un report PDF con nome automatico (cloudrift-report-YYYY-MM-DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Output machine-readable (es. per una dashboard o un check CI)
node apps/cli/dist/main.js analyze --json | jq '.totalMonthlyCostUsd'

# Salva il report JSON su file mantenendo l'output console
node apps/cli/dist/main.js analyze --json report.json
```

**Report PDF:**

Il flag `--pdf` genera un PDF in aggiunta all'output console. Il report contiene:

- **Executive summary** — totale spreco mensile e annuale, numero di risorse, breakdown per tipo
- **Top raccomandazioni** — fino a 8 voci ordinate per impatto mensile, con risparmio annuale stimato
- **Pagine di dettaglio** — una tabella per ogni tipo di risorsa trovata (EBS, Elastic IP, RDS, Load Balancer, EC2, Snapshot, NAT Gateway)
- **Scan warnings** — elencati se alcuni tipi di risorsa non hanno potuto essere scansionati

```sh
# Dopo aver eseguito con --pdf vedrai:
#   Generating PDF report... saved to /path/to/cloudrift-report-2026-06-09.pdf
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
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

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

### Architettura

Il progetto usa un'architettura DDD a strati (Ports & Adapters) con un modello a plugin: ogni tipo di risorsa è un'implementazione di `WasteScannerPort` e il use case coordinatore è generico sugli scanner registrati.

```
apps/cli/                          → Entry point CLI (Commander.js), presenter
libs/shared/kernel/                → Base classes riusabili (Entity, ValueObject, Result)
libs/cloud-cost/domain/            → Entità, value objects, waste policies, port
libs/cloud-cost/application/       → Use case generico + DTO serializzabile del report
libs/cloud-cost/infrastructure/
  aws-adapter/                     → Scanner AWS SDK v3, pricing, resolver account STS
```

Le dipendenze puntano sempre verso l'interno: CLI → Application → Domain ← AWS Adapter.

### Documentazione tecnica

Tutta la documentazione è nella cartella [`docs/`](./docs/) — italiano in [`docs/it/`](./docs/it/), inglese in [`docs/en/`](./docs/en/):

| File (IT)                                                            | Contenuto                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [docs/it/architettura.md](./docs/it/architettura.md)                 | Scelte architetturali, layer del sistema, percorso multi-cloud    |
| [docs/it/scelte-tecniche.md](./docs/it/scelte-tecniche.md)           | Nx, pnpm, TypeScript, AWS SDK v3, Result pattern, jest            |
| [docs/it/funzionamento.md](./docs/it/funzionamento.md)               | Flusso di esecuzione end-to-end, spiegazione del codice           |
| [docs/it/aggiungere-risorsa.md](./docs/it/aggiungere-risorsa.md)     | Guida passo per passo per aggiungere un nuovo tipo di risorsa     |

---

