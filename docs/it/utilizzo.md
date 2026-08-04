# Utilizzo

> 🇬🇧 [English version](../en/usage.md)

Flag, esempi, report PDF, gestione errori parziali, e prezzi per regione per `cloudrift analyze`, più i comandi `cost`/`trend`/`dead-resources`/`resource-security`/`history` e il wizard interattivo.

**Wizard interattivo:** lanciando `cloudrift` senza **nessun sottocomando** in un vero terminale (fuori da CI) parte un wizard che ti fa scegliere cosa fare — "Trova risorse sprecate" / "Confronta la spesa col mese scorso" / "Vedi il trend mensile di spesa" / "Trova risorse morte/inutilizzate" / "Scansiona rischi di postura di sicurezza" / "Vedi lo storico locale delle scansioni" — e poi pochi prompt (regioni, quali scanner, formato di output). Richiama esattamente lo stesso codice di `analyze`/`cost`/`trend`/`dead-resources`/`resource-security`/`history` guidato dai flag qui sotto, quindi non va mai fuori sincrono con loro. Qualunque sottocomando esplicito, qualunque flag, CI, o stdout non interattivo saltano del tutto il wizard — script e pipeline non ne sono toccati. Vedi [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

**Scansione cross-account:** ogni comando qui sotto (`analyze`, `cost`, `trend`, `dead-resources`, `resource-security`) accetta `--assume-role-arn <arn>` (opzionalmente con `--external-id <id>`) per scansionare un account diverso da quello a cui appartengono le tue credenziali correnti — cloudrift assume quel ruolo via STS prima di fare qualsiasi chiamata AWS, e l'intero comando fallisce subito se il ruolo non può essere assunto, invece di ricadere silenziosamente sulle tue credenziali. Non esiste una modalità integrata "scansiona tutta la mia organizzazione": per coprire più account, lancia cloudrift una volta per ogni role ARN (un loop di shell o una matrice CI), ogni esecuzione produce un report indipendente. Vedi [ADR-0096](../adr/0096-cross-account-scanning-assume-role.md) (in inglese) e la sezione "Scansione cross-account" di [docs/it/permessi-iam.md](permessi-iam.md) per la trust policy richiesta sul ruolo target.

```sh
# Scansiona un account diverso assumendo un ruolo al suo interno
node apps/cli/dist/main.js analyze --assume-role-arn arn:aws:iam::222222222222:role/cloudrift-scanner --external-id il-mio-secret-condiviso

# Scansiona più account da un loop di shell, un report indipendente per ciascuno
for account in 111111111111 222222222222; do
  node apps/cli/dist/main.js dead-resources \
    --assume-role-arn "arn:aws:iam::${account}:role/cloudrift-scanner" \
    --format json > "report-${account}.json"
done
```

## `analyze` — trova risorse sprecate

```sh
node apps/cli/dist/main.js analyze [opzioni]
```

| Opzione                      | Descrizione                                                                                                          | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare                                                                                           | `us-east-1`        |
| `--format <format>`          | Formato di stdout: `table`, `json`, `markdown` (per CI / commenti PR) o `csv`                                       | `table`            |
| `--config <path>`            | Percorso del file di config (default: `cloudrift.config.json` / `.cloudriftrc` nella cwd)                          | auto-rilevato      |
| `--live-pricing`             | Recupera i prezzi di listino correnti dall'AWS Pricing API (fallback alla tabella statica; i prezzi del config vincono) | off (tabella statica) |
| `--scanners <kinds...>`      | Esegue solo questi servizi (elenco di resource kind separati da spazio, es. `ebs-volume elastic-ip`); salta il picker interattivo | — |
| `--all-services`             | Esegue tutti gli scanner senza il picker interattivo                                                                  | on in CI / non-TTY |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                            | auto-rilevato      |
| `--assume-role-arn <arn>`    | Assume questo ruolo IAM via STS prima di scansionare, per l'accesso cross-account                                   | —                  |
| `--external-id <id>`        | External ID da passare quando si assume `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede)   | —                  |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate (ha precedenza sul config)              | `7`                |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report (ha precedenza sul config)                                     | `cloudrift:ignore` |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `cloudrift-reports/AWS_report_YYYY_MM_DD.pdf`)                                    | —                  |
| `--json [filename]`          | Scrive anche un report JSON su disco (default `cloudrift-reports/AWS_report_YYYY_MM_DD.json`)                                 | —                  |
| `--csv [filename]`           | Scrive anche un report CSV su disco (default `cloudrift-reports/AWS_report_YYYY_MM_DD.csv`)                                   | —                  |
| `--silent`                   | Sopprime tutto l'output su stdout (banner, report, conferme) — usalo con `--pdf`/`--json`/`--csv` per ottenere solo il file | off                |
| `--notify-slack`             | Invia una notifica Slack se lo spreco supera `costAlertThresholdUsd` (o qualsiasi spreco, se non impostato). Legge `SLACK_WEBHOOK_URL` dall'env | off |
| `--notify-webhook`           | Invia via POST un riepilogo JSON a un webhook, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_WEBHOOK_URL` dall'env | off |
| `--notify-email <indirizzo>` | Invia via email un riepilogo a questo indirizzo, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`FROM` dall'env | off |
| `-h, --help`                 | Mostra l'help                                                                                                        | —                  |

> **stdout vs. file:** `--format` controlla cosa va su **stdout** (il report). `--json` / `--pdf` / `--csv` scrivono **file aggiuntivi** su disco, indipendenti da `--format` — di default il `--format` scelto continua comunque a essere stampato su stdout *in aggiunta* alla scrittura di quei file (quindi es. `--pdf` da solo mostra comunque la tabella). Aggiungi `--silent` per ottenere solo il file, senza nulla stampato a terminale. Nei formati machine-readable (`json`, `markdown`, `csv`) tutti i messaggi umani vanno su stderr, così su stdout resta solo il report — ideale per il piping. Errori e l'alert della soglia di costo vanno sempre su stderr, anche con `--silent`.
>
> **Ordine dei flag con `--pdf`/`--json`/`--csv`:** il filename è un valore *opzionale* (`--pdf [filename]`), quindi viene raccolto solo se segue immediatamente il flag — `--pdf --silent ./report.pdf` fallisce ("too many arguments") perché `--silent` impedisce a `--pdf` di vedere il filename, lasciando `./report.pdf` senza nulla a cui agganciarsi. Tieni il filename subito dopo il flag (`--pdf ./report.pdf --silent`), oppure usa `=` per rendere l'ordine irrilevante: `--pdf=./report.pdf --silent --format json`.
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

# Esporta un report PDF con nome automatico (cloudrift-reports/AWS_report_YYYY_MM_DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Come sopra, ma senza nulla stampato a terminale — solo il file
node apps/cli/dist/main.js analyze --pdf ./report.pdf --silent

# Esporta un report CSV (es. da aprire in un foglio di calcolo)
node apps/cli/dist/main.js analyze --csv ./report.csv --silent

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
- **Pagine di dettaglio** — una tabella per ogni tipo di risorsa trovata (EBS, Elastic IP, RDS, Load Balancer, EC2, Snapshot, NAT Gateway), ogni riga termina con una colonna `Link` — clicca ovunque nella cella per aprire la risorsa esatta nella console AWS (alcuni tipi senza un URL derivabile la lasciano vuota invece di indovinare, vedi [ADR-0091](../adr/0091-aws-console-deep-links-in-reports.md), in inglese). La stessa URL è disponibile come campo `consoleUrl` su ogni finding in `--format json` / `--json`.
- **Scan warnings** — elencati se alcuni tipi di risorsa non hanno potuto essere scansionati

```sh
# Dopo aver eseguito con --pdf vedrai:
#   Generating PDF report... saved to /path/to/cloudrift-reports/AWS_report_2026_06_09.pdf
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

  Total waste (measured): $40.00/month
```

**Comportamento in caso di errori parziali:**

Se la scansione di un tipo di risorsa fallisce (es. permessi mancanti su CloudWatch per i NAT Gateway), il tool:

- restituisce comunque tutti gli altri risultati disponibili
- mostra una sezione "Scan Warnings" con i dettagli dell'errore
- indica il totale come `(incomplete — see warnings above)`

```
  ⚠ Scan Warnings
  • NAT Gateways: Access denied to CloudWatch metrics

  Total waste (measured): $56.20/month (incomplete — see warnings above)
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
| `--assume-role-arn <arn>` | Assume questo ruolo IAM via STS prima di scansionare, per l'accesso cross-account | — |
| `--external-id <id>` | External ID da passare quando si assume `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede) | — |
| `--config <path>` | Percorso del file di config | auto-rilevato |
| `--format <format>` | Formato di stdout: `table`, `json` o `csv` | `table` |
| `--fail-on-increase <pct>` | Esce con codice 2 se la spesa è aumentata più di questa percentuale rispetto al periodo precedente (ha precedenza su `config.costIncreaseAlertPercent`) | off |
| `--refresh-cache` | Ignora la cache locale di Cost Explorer e rifà il fetch dei periodi chiusi da AWS | off |
| `-y, --yes` | Salta la conferma "questo costa $0.01" | — |
| `--pdf [filename]` | Scrive anche un report PDF (default `cloudrift-reports/cloudrift-cost-YYYY_MM_DD.pdf`) | — |
| `--csv [filename]` | Scrive anche un report CSV (default `cloudrift-reports/cloudrift-cost-YYYY_MM_DD.csv`) | — |
| `--silent` | Sopprime tutto l'output su stdout | off |

**`trend`** — spesa mensile negli ultimi N mesi solari (incluso quello corrente, parziale), mostrata come grafico a barre ANSI di default.

| Opzione | Descrizione | Default |
| --- | --- | --- |
| `--account-id <id>` | Override dell'account ID | auto-rilevato |
| `--assume-role-arn <arn>` | Assume questo ruolo IAM via STS prima di scansionare, per l'accesso cross-account | — |
| `--external-id <id>` | External ID da passare quando si assume `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede) | — |
| `--config <path>` | Percorso del file di config | auto-rilevato |
| `--months <n>` | Numero di mesi solari da mostrare (1–36) | `6` |
| `--services <nomi...>` | Limita a questi servizi (scorciatoie tipo `ec2 s3 rds`, oppure il nome esatto usato da Cost Explorer) | tutti i servizi |
| `--format <format>` | Formato di stdout: `table` (grafico a barre ANSI), `json` o `csv` | `table` |
| `--refresh-cache` | Ignora la cache locale di Cost Explorer | off |
| `-y, --yes` | Salta la conferma di fatturazione | — |
| `--pdf [filename]` | Scrive anche un report PDF (default `cloudrift-reports/cloudrift-trend-YYYY_MM_DD.pdf`) | — |
| `--csv [filename]` | Scrive anche un report CSV (default `cloudrift-reports/cloudrift-trend-YYYY_MM_DD.csv`) | — |
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

Un dominio di hygiene separato dal modello cost-waste di `analyze`, deliberatamente — vedi [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md). Trova cose lasciate morte o inutilizzate nell'account con **costo AWS diretto pari a $0** (quindi invisibili ai criteri cost-based di `analyze`): key pair EC2 e security group inutilizzati, Reserved Instance in scadenza, utenti/ruoli IAM inattivi, access key non ruotate, policy IAM e instance profile non collegati, log group CloudWatch vuoti, alarm CloudWatch orfani, certificati ACM inutilizzati, hosted zone Route53 vuote, stack CloudFormation bloccati, bucket S3 vuoti, topic SNS senza subscription, regole EventBridge senza target, repository ECR vuoti, e state machine Step Functions mai eseguite — 18 check in totale. I finding portano una `severity` (`info` / `warning` / `critical`) invece di una stima `$/mese`.

```sh
node apps/cli/dist/main.js dead-resources [opzioni]
```

| Opzione                       | Descrizione                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare (ignorato dai check a scope globale — vedi sotto)                                    | `us-east-1`        |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                      | auto-rilevato      |
| `--assume-role-arn <arn>`    | Assume questo ruolo IAM via STS prima di scansionare, per l'accesso cross-account                             | —                  |
| `--external-id <id>`        | External ID da passare quando si assume `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede) | — |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate (`ec2-ri-expiring-soon` non lo usa — vedi sotto) | `7` |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report                                                            | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Esegue solo questi check (separati da spazio, es. `ec2-keypair-unused iam-user-inactive`)                       | tutti i check       |
| `--format <format>`          | Formato di stdout: `table`, `json` o `csv`                                                                       | `table`            |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `cloudrift-reports/cloudrift-dead-resources-YYYY_MM_DD.pdf`)                | —                  |
| `--csv [filename]`           | Scrive anche un report CSV su disco (default `cloudrift-reports/cloudrift-dead-resources-YYYY_MM_DD.csv`)                | —                  |
| `--silent`                   | Sopprime tutto l'output su stdout (banner, report). Gli errori restano visibili.                                | off                |
| `--notify-slack`             | Invia una notifica Slack se lo scan ha finding critical/warning. Legge `SLACK_WEBHOOK_URL` dall'env             | off                |
| `--notify-webhook`           | Invia via POST un riepilogo JSON a un webhook, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_WEBHOOK_URL` dall'env | off |
| `--notify-email <indirizzo>` | Invia via email un riepilogo a questo indirizzo, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`FROM` dall'env | off |
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

# Report CSV, es. da aprire in un foglio di calcolo
node apps/cli/dist/main.js dead-resources --csv ./hygiene.csv --silent
```

**Permessi IAM:** questo comando richiede `ec2:DescribeKeyPairs`, `ec2:DescribeReservedInstances`, `ec2:DescribeSecurityGroups`, `iam:ListUsers`, `iam:ListAccessKeys`, `iam:GetAccessKeyLastUsed`, `iam:ListPolicies`, `iam:ListRoles`, `logs:DescribeLogGroups`, `acm:ListCertificates`, `route53:ListHostedZones`, `cloudformation:DescribeStacks`, `s3:ListAllMyBuckets`, `s3:ListBucket`, `cloudwatch:DescribeAlarms` in aggiunta alla policy di `analyze` — vedi [docs/it/permessi-iam.md](permessi-iam.md).

---

## `resource-security` — scansione della postura di sicurezza

Un dominio separato sia dal modello cost-waste di `analyze` sia dal modello hygiene di `dead-resources` — vedi [ADR-0081](../adr/0081-resource-security-parallel-domain.md). Trova **configurazioni** rischiose su risorse effettivamente in uso (a differenza di `dead-resources`, che trova risorse abbandonate): MFA disabilitata su root/utenti, rotazione delle access key in ritardo, access key attive sull'account root, password policy debole o assente, security group con ingress aperto su internet su porte sensibili, security group di default permissivi, bucket S3 ed EBS snapshot pubblici, volumi EBS e istanze RDS non cifrati, bucket S3 senza cifratura di default, istanze RDS pubblicamente accessibili, account senza un trail CloudTrail multi-regione, GuardDuty/AWS Config/Security Hub non abilitati, VPC con Flow Logs disabilitati, chiavi KMS con rotazione disabilitata, S3 Block Public Access a livello account disabilitato, bucket S3 con versioning o MFA Delete disabilitati, cluster Redshift pubblicamente accessibili, utenti IAM con una policy admin wildcard attaccata direttamente, certificati ACM in scadenza, e resource policy pubbliche su funzioni Lambda, topic SNS, code SQS, repository ECR e secret di Secrets Manager — 29 check in totale, tutti basati su chiamate API di sola lettura (`Describe*`/`Get*`/`List*`). I finding portano una `severity` (`info` / `warning` / `critical`), stessa forma di `dead-resources`; non c'è un grace period `--min-age-days` — una configurazione di sicurezza errata è un rischio dal momento in cui esiste, non dopo che invecchia.

```sh
node apps/cli/dist/main.js resource-security [opzioni]
```

| Opzione                       | Descrizione                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | Regioni AWS da scansionare (ignorato dai check a scope globale — vedi sotto)                                   | `us-east-1`        |
| `--account-id <id>`          | Override dell'account ID AWS (auto-rilevato via `sts:GetCallerIdentity` se omesso)                             | auto-rilevato      |
| `--assume-role-arn <arn>`    | Assume questo ruolo IAM via STS prima di scansionare, per l'accesso cross-account                             | —                  |
| `--external-id <id>`        | External ID da passare quando si assume `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede) | — |
| `--ignore-tag <tag>`         | Le risorse con questo tag sono escluse dal report                                                              | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Esegue solo questi check (separati da spazio, es. `iam-root-mfa-disabled s3-bucket-public`)                    | tutti i check       |
| `--format <format>`          | Formato di output su stdout: `table`, `json` o `csv`                                                             | `table`            |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `cloudrift-reports/cloudrift-resource-security-YYYY_MM_DD.pdf`)             | —                  |
| `--csv [filename]`           | Scrive anche un report CSV su disco (default `cloudrift-reports/cloudrift-resource-security-YYYY_MM_DD.csv`)             | —                  |
| `--silent`                   | Sopprime tutto l'output stdout (banner, report). Gli errori restano visibili.                                   | off                |
| `--notify-slack`             | Invia una notifica Slack se lo scan ha finding critical/warning. Legge `SLACK_WEBHOOK_URL` dall'env             | off                |
| `--notify-webhook`           | Invia via POST un riepilogo JSON a un webhook, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_WEBHOOK_URL` dall'env | off |
| `--notify-email <indirizzo>` | Invia via email un riepilogo a questo indirizzo, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`FROM` dall'env | off |
| `-h, --help`                 | Mostra l'help                                                                                                   | —                  |

**Check:**

| Kind | Scope | Cosa viene segnalato | Severity |
| --- | --- | --- | --- |
| `iam-root-mfa-disabled` | globale | Account root senza alcun dispositivo MFA abilitato | `critical` |
| `iam-user-mfa-disabled` | globale | Utente IAM senza alcun dispositivo MFA registrato | `warning` |
| `iam-access-key-rotation-overdue` | globale | Access key attiva più vecchia di 90 giorni (CIS 1.14) | `warning` |
| `iam-root-access-key-active` | globale | L'account root ha almeno una access key attiva | `critical` |
| `iam-password-policy-weak` | globale | Password policy dell'account assente, o sotto la baseline CIS | `warning` |
| `ec2-security-group-open-ingress` | regionale | Security group con ingress aperto a `0.0.0.0/0`/`::/0` su una porta sensibile (SSH, RDP, porte database comuni) | `critical` |
| `ec2-default-security-group-permissive` | regionale | Il security group `default` di una VPC ha ancora regole | `warning` |
| `s3-bucket-public` | globale | Bucket raggiungibile da internet via ACL e/o bucket policy | `critical` |
| `ec2-snapshot-public` | regionale | Snapshot EBS con `createVolumePermission` concesso al gruppo `all` | `critical` |
| `ec2-volume-unencrypted` | regionale | Volume EBS non cifrato a riposo | `warning` |
| `rds-instance-unencrypted` | regionale | Storage dell'istanza RDS non cifrato a riposo | `warning` |
| `s3-bucket-encryption-missing` | globale | Bucket senza cifratura lato server di default configurata | `warning` |
| `rds-instance-publicly-accessible` | regionale | Istanza RDS raggiungibile dall'esterno della sua VPC | `critical` |
| `cloudtrail-not-multiregion` | globale | Nessun trail CloudTrail configurato con logging multi-regione | `warning` |

> **IAM, S3 (elenco bucket) e CloudTrail sono trattati come globali per questo comando.** Gli undici check `globale` sopra girano **una sola volta per scansione**, mai una volta per regione richiesta — a differenza dei diciotto check `regionale`. Vedi [ADR-0081](../adr/0081-resource-security-parallel-domain.md).

**Esempi:**

```sh
# Ogni check, regione di default
node apps/cli/dist/main.js resource-security

# Più regioni — impatta solo i check regionali, non quelli globali
node apps/cli/dist/main.js resource-security -r us-east-1 eu-west-1

# Solo i check IAM
node apps/cli/dist/main.js resource-security --scanners iam-root-mfa-disabled iam-user-mfa-disabled

# Output leggibile da macchina
node apps/cli/dist/main.js resource-security --format json | jq '.findings[] | select(.severity=="critical")'

# Report PDF, niente stampato a terminale
node apps/cli/dist/main.js resource-security --pdf ./sicurezza.pdf --silent

# Report CSV, es. da aprire in un foglio di calcolo
node apps/cli/dist/main.js resource-security --csv ./sicurezza.csv --silent
```

**Permessi IAM:** questo comando richiede `iam:GetAccountSummary`, `iam:ListMFADevices`, `iam:GetAccountPasswordPolicy`, `s3:GetBucketAcl`, `s3:GetBucketPolicyStatus`, `s3:GetPublicAccessBlock`, `s3:GetBucketEncryption`, `ec2:DescribeSnapshotAttribute`, `cloudtrail:DescribeTrails` in aggiunta alla policy di `analyze` (altri check riusano action già concesse per `analyze`/`dead-resources`) — vedi [docs/it/permessi-iam.md](permessi-iam.md).

## `mcp` — esegui cloudrift come server MCP locale

Espone cloudrift via stdio come server [MCP](https://modelcontextprotocol.io), così un agente AI compatibile con MCP (Claude Desktop/Code, Kiro, VS Code Copilot Chat in Agent mode, ...) può chiamare direttamente `analyze_cloudrift` (o le versioni più mirate `analyze_cloud_waste`/`analyze_dead_resources`/`analyze_resource_security`/`get_cost_trend`), `get_resource_types` e `get_required_iam_permissions` invece che tu lanci la CLI a mano. Eredita le **stesse credenziali AWS** di ogni altro comando — un agente con accesso a questo server vede tutto ciò che quelle credenziali possono vedere, non solo i finding di spreco/risorse morte/sicurezza. Vedi [docs/it/server-mcp.md](server-mcp.md) per l'elenco completo dei tool e la configurazione dei client.

```sh
node apps/cli/dist/main.js mcp
```

È pensato per essere lanciato dalla configurazione di un client MCP (parla JSON-RPC newline-delimited su stdin/stdout, non è qualcosa con cui interagire direttamente da terminale).

**Disabilitarlo:** se non vuoi che questa macchina avvii mai il server MCP — nemmeno per errore, nemmeno fuori da un progetto — imposta `CLOUDRIFT_DISABLE_MCP=1` nel tuo ambiente (profilo della shell, immagine container, o una policy aziendale). `cloudrift mcp` si rifiuta allora di partire, prima ancora di toccare le credenziali AWS o leggere un config file:

```sh
export CLOUDRIFT_DISABLE_MCP=1   # es. in ~/.zshrc o ~/.bashrc
```

Questo è indipendente da `cloudrift.config.json` di proposito: `cloudrift mcp` funziona da qualsiasi cartella, con o senza un progetto sotto — un flag di config per-progetto non coprirebbe il caso "non farlo mai partire su questa macchina".

### Collegare un client MCP

Vedi [docs/it/server-mcp.md](server-mcp.md) per i tool esposti da questo server e come collegare Kiro, VS Code (GitHub Copilot Chat) e Claude Code — ognuno usa un formato di configurazione diverso, un file copiato 1:1 dall'uno all'altro non funzionerà.

## `history` — storico locale delle scansioni

Rilegge il trend store locale: `analyze`, `dead-resources` e `resource-security` aggiungono ciascuno uno snapshot completo del proprio report a un file SQLite per-account (`~/.cloudrift/trends/<account-id>.db`) ad ogni esecuzione, in modalità best-effort e senza mai bloccare la scansione stessa — vedi [ADR-0099](../adr/0099-local-trend-store.md) (in inglese). `history` è il comando read-only che lo interroga. Niente viene mai caricato da nessuna parte: il file non lascia mai la tua macchina.

```sh
node apps/cli/dist/main.js history [options]
```

| Opzione                   | Descrizione                                                                        | Default        |
| -------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| `--account-id <id>`       | Override dell'ID account AWS (auto-rilevato via `sts:GetCallerIdentity` se omesso) — seleziona quale file `.db` locale leggere | auto-rilevato   |
| `--assume-role-arn <arn>` | Assumi questo ruolo IAM via STS prima di risolvere l'ID account, per accesso cross-account | —               |
| `--external-id <id>`     | External ID da passare quando si usa `--assume-role-arn` (serve solo se la trust policy del ruolo lo richiede) | —               |
| `--domain <domain>`      | Mostra solo gli snapshot di questo dominio: `cloud-cost`, `dead-resources`, o `resource-security` | tutti i domini  |
| `--limit <n>`             | Numero massimo di snapshot da mostrare, dal più recente                            | `100`           |
| `--compare <n>`           | Confronta l'ultima esecuzione con quella di `n` esecuzioni fa invece di elencare (richiede `--domain`) | —               |
| `--html [filename]`       | Scrive anche un report HTML autocontenuto con un grafico del trend. Con `--domain` grafica solo quel dominio (default `cloudrift-reports/cloudrift-history-<domain>-YYYY_MM_DD.html`); senza, impila tutti e tre i domini su un'unica pagina (default `cloudrift-reports/cloudrift-history-YYYY_MM_DD.html`) | —               |
| `--format <format>`      | Formato di output su stdout: `table` o `json`                                       | `table`         |
| `--notify-slack`          | Con `--compare`, invia una notifica Slack se il confronto mostra un peggioramento (trend peggiore). Legge `SLACK_WEBHOOK_URL` dall'env | off |
| `--notify-webhook`        | Con `--compare`, invia via POST un riepilogo JSON a un webhook, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_WEBHOOK_URL` dall'env | off |
| `--notify-email <indirizzo>` | Con `--compare`, invia via email un riepilogo a questo indirizzo, stessa condizione di `--notify-slack`. Legge `CLOUDRIFT_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`FROM` dall'env | off |
| `-h, --help`              | Mostra l'help                                                                       | —               |

> **Notifiche (`analyze`/`dead-resources`/`resource-security`/`history --compare`):** `--notify-slack`/`--notify-webhook`/`--notify-email` sono best-effort e non fanno mai fallire lo scan — un webhook rotto o una config SMTP errata loggano un warning e proseguono. Ogni credenziale (`SLACK_WEBHOOK_URL`, `CLOUDRIFT_WEBHOOK_URL`, `CLOUDRIFT_SMTP_*`) viene letta dall'ambiente, mai da un flag, quindi non finisce mai nella shell history o in `ps aux` — impostale nel profilo della tua shell o come secret di CI (es. `secrets.*` di GitHub Actions), mai in un file committato. Il wizard interattivo offre anche di inviare il report via email (solo se l'SMTP è già configurato), ma non chiede mai di Slack/webhook — quelli sono pensati per CI/script, non per un'esecuzione interattiva occasionale.

**Esempi:**

```sh
# Ogni snapshot registrato per l'account auto-rilevato, dal più recente
node apps/cli/dist/main.js history

# Solo lo storico cost-waste, ultime 10 esecuzioni
node apps/cli/dist/main.js history --domain cloud-cost --limit 10

# Output machine-readable, payload completo del report per ogni snapshot espanso in JSON
node apps/cli/dist/main.js history --format json | jq '.[0].payload'

# Quanto spendevo 5 esecuzioni fa rispetto ad ora, incluso uno spreco "presumibilmente risolto" in $/mese
node apps/cli/dist/main.js history --domain cloud-cost --compare 5

# Report HTML autocontenuto con un grafico a linee dello spreco nel tempo
node apps/cli/dist/main.js history --domain cloud-cost --html

# Report HTML combinato: tutti e tre i domini impilati su una pagina, un grafico ciascuno
node apps/cli/dist/main.js history --html
```

**Nessun nuovo permesso AWS necessario:** `history` fa la stessa chiamata `sts:GetCallerIdentity` di ogni altro comando per risolvere l'ID account (saltata del tutto se passi `--account-id` esplicitamente) — il resto è solo lettura di un file locale, nessuna chiamata API AWS.

**Retention:** ogni esecuzione viene conservata per sempre, di proposito — non esiste ancora una pulizia automatica. È una scelta deliberata di semplicità, da rivedere quando esisteranno dati reali sulla crescita del database (vedi le Conseguenze dell'ADR-0099).

**Lo "spreco presumibilmente risolto" di `--compare` è un'inferenza, non un risparmio confermato:** cloudrift è read-only e non rimedia mai nulla, quindi non può sapere *perché* un finding è sparito tra le due esecuzioni confrontate (l'hai sistemato tu, la risorsa è stata eliminata per un motivo non collegato, o era semplicemente fuori dallo scope di `--regions`/`--scanners` di questa run) — vedi [ADR-0100](../adr/0100-history-comparison-and-html-report.md) (in inglese).

**Il grafico di `--html` cambia in base al dominio:** `cloud-cost` mostra una singola linea (spreco mensile in USD), con un punto di previsione lineare tratteggiato una run oltre l'ultima reale ("se il trend continua", non una garanzia — servono almeno 2 run), e una lista "top resource type per spreco" dall'ultima run. `dead-resources`/`resource-security` mostrano invece tre linee — critical/warning/info, la stessa scomposizione per severity e gli stessi colori dei report PDF/tabella — con legenda e una tabella a 3 colonne corrispondente, invece di un unico totale aggregato di "findings"; `resource-security` include anche una narrativa di rischio in linguaggio semplice (nessuna cifra in $ — non esiste un modo onesto di quantificare un finding di sicurezza come invece esistono i prezzi di listino AWS per lo spreco). Il report combinato (senza `--domain`) apre inoltre con 3 stat tile esecutivi (spreco mensile + delta, rischio security, trend dead-resources) pensati per un pubblico CTO/CEO che vuole il titolo prima di scendere nel dettaglio di un singolo dominio.

## `iam-policy` — stampa la policy IAM richiesta

```sh
node apps/cli/dist/main.js iam-policy
```

Stampa la policy IAM read-only completa richiesta da cloudrift (ogni azione usata da `analyze`/`dead-resources`/`resource-security`/`cost`/`trend`) come JSON pronto da incollare — la stessa policy statica documentata a mano in [docs/it/permessi-iam.md](permessi-iam.md) e restituita dal tool MCP `get_required_iam_permissions`. Nessuna chiamata AWS, nessun flag, nessun filtro per comando (oggi non esiste una mappatura IAM per singolo tipo di risorsa, quindi non è disponibile un filtro tipo `--scanners`). Utile per incollarla direttamente nella console AWS, in una risorsa Terraform `aws_iam_policy`, o in un `PolicyDocument.fromJson(...)` CDK.
