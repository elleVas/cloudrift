# Utilizzo

> 🇬🇧 [English version](../en/usage.md)

Flag, esempi, report PDF, gestione errori parziali, e prezzi per regione per `cloudrift analyze`.

```sh
node apps/cli/dist/main.js analyze [opzioni]
```

| Opzione                      | Descrizione                                                                                                          | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
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
