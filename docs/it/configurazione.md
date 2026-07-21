# File di configurazione

> 🇬🇧 [English version](../en/configuration.md)

Campi di `cloudrift.config.json`, override, tuning falsi positivi.

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
