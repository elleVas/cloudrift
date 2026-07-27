# Livello di sforzo per tipo di risorsa

> 🇬🇧 [English version](../en/remediation-effort.md)

Ogni `ResourceKind` di spreco ha un valore `effort` (`low` / `medium` / `high`) accanto ai metadati `category`/`estimated`. Alimenta la classifica "Top quick wins" del report PDF — ordinata per un punteggio costo/sforzo, non per il solo costo mensile — così le prime voci che il lettore vede sono quelle economiche da risolvere, non semplicemente le più costose.

**Criterio:**

- **low** — cancellazione o scollegamento puro di una risorsa non referenziata da nulla, zero dipendenti per costruzione, reversibile o a rischio quasi nullo.
- **medium** — richiede una verifica prima di agire (la classificazione "inattiva"/"non usata" dello scan potrebbe essere sbagliata), oppure è una modifica di configurazione senza downtime ma con qualche effetto secondario.
- **high** — richiede downtime, migrazione dei dati, o coordinamento con un altro team/servizio che potrebbe dipendere silenziosamente dalla risorsa.

| Kind | Effort | Perché |
|---|---|---|
| `ebs-volume` | low | Volume già scollegato, zero dipendenti |
| `elastic-ip` | low | IP già non associato |
| `rds-instance` | **high** | Database: rischio di perdita dati, richiede snapshot, verifica e coordinamento |
| `load-balancer` | medium | Verificare che nessun client punti ancora al nome DNS |
| `ec2-instance` | medium | Verificare prima di terminare l'istanza; reversibile tramite un'AMI |
| `ebs-snapshot` | low | Snapshot vecchio o ridondante |
| `nat-gateway` | medium | Se mal classificato, impatta il percorso di rete di un'intera subnet |
| `ebs-gp2-upgrade` | low | Modifica del tipo di volume in-place, zero downtime |
| `ebs-idle` | low | Stesso ragionamento di `ebs-volume` |
| `ec2-underutilized` | medium | Il ridimensionamento richiede uno stop/start, breve downtime |
| `rds-underutilized` | **high** | Il ridimensionamento di RDS di solito richiede una finestra di manutenzione |
| `log-group` | low | Nessun impatto sul funzionamento in produzione |
| `eni-orphaned` | low | Interfaccia di rete già scollegata |
| `s3-no-lifecycle` | low | Aggiungere una regola di lifecycle è solo configurazione, zero downtime |
| `lambda-underutilized` | low | La modifica della memoria è configurazione, zero downtime |
| `efs-unused` | medium | Verificare eventuali mount intermittenti prima di cancellare |
| `dynamodb-overprovisioned` | low | Modifica del throughput online, zero downtime |
| `elasticache-idle` | medium | Le cache sono spesso condivise silenziosamente da altre applicazioni |
| `redshift-idle-cluster` | **high** | Data warehouse — verificare che nessuno strumento di BI ne dipenda |
| `opensearch-idle-domain` | medium | Verificare le applicazioni dipendenti; reversibile tramite snapshot |
| `msk-idle-cluster` | **high** | L'infrastruttura di messaggistica ha spesso consumer nascosti |
| `fsx-idle-filesystem` | medium | Verificare i mount prima di cancellare |
| `documentdb-idle-instance` | **high** | Database, stesso ragionamento di `rds-instance` |
| `neptune-idle-instance` | **high** | Database a grafo, stesso ragionamento |
| `mq-idle-broker` | medium | Verificare le applicazioni dipendenti dalla coda |
| `workspaces-idle` | low | Impatto basso per singolo utente, facilmente ri-approvvigionabile |
| `vpn-connection-idle` | medium | Connettività di rete, richiede il parere del team di rete |
| `transit-gateway-idle-attachment` | medium | Instradamento di rete, richiede verifica |
| `kinesis-provisioned-idle-stream` | medium | Verificare produttori e consumatori prima di cancellare |
| `sqs-dlq-abandoned` | low | Coda a costo zero, pura pulizia |
| `lambda-loggroup-orphaned` | low | Nessun impatto sul funzionamento in produzione |
| `aurora-serverless-overprovisioned` | medium | La modifica del Min ACU è online ma incide sulla soglia minima di scaling |
| `sagemaker-notebook-idle` | low | Notebook di sviluppo isolato, a uso di un solo utente |
| `sagemaker-endpoint-idle` | **high** | Endpoint di serving — se mal classificato, interrompe un'integrazione ML in produzione |
| `sagemaker-training-orphaned` | low | Modello senza endpoint attivo, rischio nullo |
| `environment-ghost` | medium | Più risorse insieme, ma già inattivo per definizione |
| `eks-node-overprovisioned` | **high** | Incide sulla capacità di scheduling dell'intero cluster |
| `eks-orphan-pvc` | low | Nessun pod lo referenzia per costruzione |
| `ami-unused` | low | AMI non usata, zero dipendenti |
| `ecr-image-untagged` | low | Nessun deployment referenzia digest senza tag |
| `s3-multipart-upload-abandoned` | low | Pulizia pura, rischio nullo |
| `rds-manual-snapshot-old` | low | Snapshot vecchio, stesso ragionamento di `ebs-snapshot` |
| `secretsmanager-unused` | medium | Un secret può avere dipendenti indiretti difficili da verificare |
| `codepipeline-pipeline-stale` | low | Nessun impatto sul funzionamento in produzione, ricreabile dal codice sorgente |
