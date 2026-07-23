# Utilizzo

> 🇬🇧 [English version](../en/usage.md)

Flag, esempi, report PDF, gestione errori parziali, e prezzi per regione per `cloudrift analyze`, più i comandi `cost`/`trend`/`dead-resources` e il wizard interattivo.

**Wizard interattivo:** lanciando `cloudrift` senza **nessun sottocomando** in un vero terminale (fuori da CI) parte un wizard che ti fa scegliere cosa fare — "Trova risorse sprecate" / "Confronta la spesa col mese scorso" / "Vedi il trend mensile di spesa" / "Trova risorse morte/inutilizzate" — e poi pochi prompt (regioni, quali scanner, formato di output). Richiama esattamente lo stesso codice di `analyze`/`cost`/`trend`/`dead-resources` guidato dai flag qui sotto, quindi non va mai fuori sincrono con loro. Qualunque sottocomando esplicito, qualunque flag, CI, o stdout non interattivo saltano del tutto il wizard — script e pipeline non ne sono toccati. Vedi [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

## `analyze` — trova risorse sprecate

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

---

## `cost` / `trend` — confronto e trend di spesa

> ⚠️ **Questi due comandi chiamano AWS Cost Explorer, che fattura $0.01 a richiesta** — gli unici comandi di cloudrift che possono generare un costo AWS (ogni scanner di `analyze` usa solo chiamate describe/list gratuite). Entrambi chiedono conferma interattiva prima della prima chiamata, a meno di passare `-y`/`--yes`, `--silent`, o di girare fuori da un TTY/in CI. I periodi di fatturazione chiusi vengono cachati su disco (`~/.cloudrift/cache/cost-explorer/`) così rilanciare lo stesso comando per le stesse date non fattura di nuovo — vedi [ADR-0069](../adr/0069-cost-explorer-integration-billed-api-confirmation.md) / [ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md).

Cost Explorer è un endpoint globale unico — a differenza di `analyze`, nessuno dei due comandi ha un flag `--regions`.

```sh
node apps/cli/dist/main.js cost [opzioni]
node apps/cli/dist/main.js trend [opzioni]
```

**`cost`** — spesa corrente (dal 1° del mese a oggi) confrontata con lo stesso intervallo di giorni del mese scorso, per servizio.

| Opzione | Descrizione | Default |
| --- | --- | --- |
| `--account-id <id>` | Override dell'account ID (auto-rilevato via STS se omesso) | auto-rilevato |
| `--config <path>` | Percorso del file di config | auto-rilevato |
| `--format <format>` | Formato di stdout: `table` o `json` | `table` |
| `--fail-on-increase <pct>` | Esce con codice 2 se la spesa è aumentata più di questa percentuale rispetto al periodo precedente (ha precedenza su `config.costIncreaseAlertPercent`) | off |
| `--refresh-cache` | Ignora la cache locale di Cost Explorer e rifà il fetch dei periodi chiusi da AWS | off |
| `-y, --yes` | Salta la conferma "questo costa $0.01" | — |
| `--pdf [filename]` | Scrive anche un report PDF (default `reports/cloudrift-cost-YYYY_MM_DD.pdf`) | — |
| `--silent` | Sopprime tutto l'output su stdout | off |

**`trend`** — spesa mensile negli ultimi N mesi solari (incluso quello corrente, parziale), mostrata come grafico a barre ANSI di default.

| Opzione | Descrizione | Default |
| --- | --- | --- |
| `--account-id <id>` | Override dell'account ID | auto-rilevato |
| `--config <path>` | Percorso del file di config | auto-rilevato |
| `--months <n>` | Numero di mesi solari da mostrare (1–36) | `6` |
| `--services <nomi...>` | Limita a questi servizi (scorciatoie tipo `ec2 s3 rds`, oppure il nome esatto usato da Cost Explorer) | tutti i servizi |
| `--format <format>` | Formato di stdout: `table` (grafico a barre ANSI) o `json` | `table` |
| `--refresh-cache` | Ignora la cache locale di Cost Explorer | off |
| `-y, --yes` | Salta la conferma di fatturazione | — |
| `--pdf [filename]` | Scrive anche un report PDF (default `reports/cloudrift-trend-YYYY_MM_DD.pdf`) | — |
| `--silent` | Sopprime tutto l'output su stdout | off |

**Esempi:**

```sh
# Confronta la spesa di questo mese (finora) con gli stessi giorni del mese scorso
node apps/cli/dist/main.js cost

# Fallisce in CI se la spesa è aumentata più del 20% rispetto al periodo precedente
node apps/cli/dist/main.js cost --fail-on-increase 20 --format json

# Ultimi 12 mesi, solo EC2 e S3, salta la conferma (già in uno script)
node apps/cli/dist/main.js trend --months 12 --services ec2 s3 --yes

# Rifà il fetch anche dei periodi già in cache
node apps/cli/dist/main.js trend --refresh-cache
```

---

## `dead-resources` — hygiene per risorse morte/inutilizzate

Un dominio di hygiene separato dal modello cost-waste di `analyze`, deliberatamente — vedi [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md). Trova cose lasciate morte o inutilizzate nell'account con **costo AWS diretto pari a $0** (quindi invisibili ai criteri cost-based di `analyze`): key pair EC2 e security group inutilizzati, Reserved Instance in scadenza, utenti/ruoli IAM inattivi, access key non ruotate, policy IAM non collegate, log group CloudWatch vuoti, certificati ACM inutilizzati, hosted zone Route53 vuote, stack CloudFormation bloccati, bucket S3 vuoti, e alarm CloudWatch orfani — 13 check in totale. I finding portano una `severity` (`info` / `warning` / `critical`) invece di una stima `$/mese`.

```sh
node apps/cli/dist/main.js dead-resources [opzioni]
```

| Opzione                       | Descrizione                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare (ignorato dai check a scope globale — vedi sotto)                                    | `us-east-1`        |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                      | auto-rilevato      |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate (`ec2-ri-expiring-soon` non lo usa — vedi sotto) | `7` |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report                                                            | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Esegue solo questi check (separati da spazio, es. `ec2-keypair-unused iam-user-inactive`)                       | tutti i check       |
| `--format <format>`          | Formato di stdout: `table` o `json`                                                                             | `table`            |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `reports/cloudrift-dead-resources-YYYY_MM_DD.pdf`)                | —                  |
| `--silent`                   | Sopprime tutto l'output su stdout (banner, report). Gli errori restano visibili.                                | off                |
| `-h, --help`                 | Mostra l'help                                                                                                    | —                  |

**Check:**

| Kind | Scope | Cosa viene segnalato | Severity | Soglia |
| --- | --- | --- | --- | --- |
| `ec2-keypair-unused` | regionale | Key pair EC2 non referenziata dal `KeyName` di nessuna istanza in esecuzione/ferma | `info` | Periodo di grazia di 7 giorni (`--min-age-days`) dalla data di creazione della key pair |
| `ec2-ri-expiring-soon` | regionale | Reserved Instance attiva il cui termine scade entro la soglia | `warning` | 30 giorni (non configurabile via flag oggi — vedi [ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md) per il perché non riusa `--min-age-days`) |
| `ec2-security-group-unused` | regionale | Security group non referenziato da nessuna network interface (il gruppo `default` dell'account/VPC è sempre escluso) | `info` | nessuna — l'API non espone una data di creazione su cui basare un periodo di grazia |
| `logs-loggroup-empty` | regionale | Log group CloudWatch che non ha mai memorizzato eventi (`storedBytes === 0`) | `info` | Periodo di grazia di 7 giorni (`--min-age-days`) |
| `acm-certificate-unused` | regionale | Certificato ACM non attaccato a nessuna risorsa AWS (`InUse` calcolato da AWS stessa) | `info` | Periodo di grazia di 7 giorni (`--min-age-days`) |
| `cloudformation-stack-stuck` | regionale | Stack bloccato in `CREATE_FAILED` / `ROLLBACK_FAILED` / `DELETE_FAILED` / `UPDATE_ROLLBACK_FAILED` | `critical` | Periodo di grazia di 7 giorni (`--min-age-days`) |
| `cloudwatch-alarm-orphaned` | regionale | Alarm bloccato in `INSUFFICIENT_DATA` — di solito la risorsa sottostante alla metrica è stata eliminata | `warning` | Periodo di grazia di 7 giorni (`--min-age-days`), misurato dall'ultimo aggiornamento di configurazione dell'alarm |
| `iam-user-inactive` | globale | Nessun login console e nessun uso di access key entro la soglia (o mai) | `warning` | 90 giorni (la stessa cifra del CIS AWS Foundations Benchmark), periodo di grazia di 7 giorni dalla creazione |
| `iam-policy-unattached` | globale | Policy IAM customer-managed con zero attachment (le policy AWS-managed sono escluse server-side — tanto non si possono eliminare) | `info` | Periodo di grazia di 7 giorni (`--min-age-days`) |
| `iam-role-unused` | globale | Nessuna assunzione del ruolo entro la soglia (o mai); i ruoli service-linked AWS sono esclusi | `warning` | 90 giorni, periodo di grazia di 7 giorni dalla creazione |
| `iam-access-key-stale` | globale | Access key attiva non ruotata entro la soglia — il controllo di rotazione del CIS AWS Foundations Benchmark | `warning` | 90 giorni |
| `route53-hostedzone-empty` | globale | Hosted zone senza record oltre alla coppia NS/SOA di default (`ResourceRecordSetCount <= 2`) | `info` | nessuna — l'API non espone una data di creazione su cui basare un periodo di grazia |
| `s3-bucket-empty` | globale | Bucket con zero oggetti | `info` | Periodo di grazia di 7 giorni (`--min-age-days`) |

> **IAM, Route53 e (per questo comando) S3 sono servizi AWS globali.** I sei check `globale` sopra girano **una sola volta per scansione**, mai una volta per regione richiesta — a differenza dei sette check `regionale`. Vedi [ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md).

**Esempi:**

```sh
# Tutti i check, regione di default
node apps/cli/dist/main.js dead-resources

# Più regioni — influisce solo sui check regionali, non su quelli globali
node apps/cli/dist/main.js dead-resources -r us-east-1 eu-west-1

# Solo i check IAM
node apps/cli/dist/main.js dead-resources --scanners iam-user-inactive iam-policy-unattached

# Output machine-readable
node apps/cli/dist/main.js dead-resources --format json | jq '.findings[] | select(.severity=="warning")'

# Report PDF, nulla stampato a terminale
node apps/cli/dist/main.js dead-resources --pdf ./hygiene.pdf --silent
```

**Permessi IAM:** questo comando richiede `ec2:DescribeKeyPairs`, `ec2:DescribeReservedInstances`, `ec2:DescribeSecurityGroups`, `iam:ListUsers`, `iam:ListAccessKeys`, `iam:GetAccessKeyLastUsed`, `iam:ListPolicies`, `iam:ListRoles`, `logs:DescribeLogGroups`, `acm:ListCertificates`, `route53:ListHostedZones`, `cloudformation:DescribeStacks`, `s3:ListAllMyBuckets`, `s3:ListBucket`, `cloudwatch:DescribeAlarms` in aggiunta alla policy di `analyze` — vedi [docs/it/permessi-iam.md](permessi-iam.md).
