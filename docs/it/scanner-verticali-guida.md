# Scanner verticali (Phase 6)

> 🇬🇧 [English version](../en/vertical-scanners.md)

La Phase 6 ha aggiunto 9 `ResourceKind` distribuiti su 5 verticali, sopra i 29 scanner generalisti già esistenti: igiene event-driven (SQS/Lambda), Aurora Serverless v2, la suite SageMaker, ambienti Dev/PR fantasma, e visibilità sui costi EKS. Motivazioni e alternative valutate sono in [ADR-0065](../adr/0065-vertical-premium-scanners-phase-6-strategy.md) (strategia generale) e [ADR-0066](../adr/0066-eks-scanners-aws-api-only-kubeconfig-deferred.md) (EKS nello specifico). Questo documento è il riferimento pratico: cosa rileva ogni scanner, il suo limite di accuratezza, e come configurarlo — la tabella [Cosa rileva](leggimi.md#cosa-rileva) ha il riepilogo in una riga e la formula del costo per ciascuno.

Esegui uno qualsiasi standalone con `--scanners <kind>`, es.:

```sh
node apps/cli/dist/main.js analyze --scanners eks-node-overprovisioned --live-pricing
```

## Orfani serverless

**`sqs-dlq-abandoned`** — una coda SQS identificata come Dead Letter Queue (tramite `RedrivePolicy`, essendo referenziata come target della redrive policy di un'altra coda, o un nome che matcha `*-dlq`/`*-dead-letter`) il cui messaggio più vecchio non consumato ha più di 14 giorni. È una segnalazione di igiene a `$0`, stessa logica dello scanner `eni-orphaned`: SQS non ha costo di storage, il valore è intercettare errori ignorati e integrazioni morte, non un risparmio in dollari.

**`lambda-loggroup-orphaned`** — un CloudWatch Log Group sotto `/aws/lambda/` la cui funzione Lambda non esiste più. Distinto dallo scanner generalista `log-group`, che segnala la *retention mancante* su log group ancora appartenenti a una funzione viva; questo segnala log group la cui funzione proprietaria è del tutto sparita. Il costo è il dato di log memorizzato alla tariffa standard di storage di CloudWatch Logs.

Nessuna soglia di configurazione dedicata oltre allo standard `--min-age-days` / tag `cloudrift:ignore`.

## Aurora Serverless v2

**`aurora-serverless-overprovisioned`** — un cluster Aurora Serverless v2 il cui floor `MinACU` è molto superiore al picco di `ServerlessDatabaseCapacity` osservato realmente in una finestra di 7 giorni. Il Min ACU suggerito è `ceil(picco * 1.2)` — 20% di margine sopra il picco osservato, non esattamente al limite. Il risparmio è `(MinACU − MinACU suggerito) × $87,60/ACU-mese` (la chiave di prezzo statica `aurora-acu`, `$0,12/ACU-ora`).

Config: `thresholds.auroraMinAcuUtilizationPercent` (default `50`) — segnalato quando il picco ACU è sotto questa percentuale del floor Min ACU.

**Rischio:** un picco settimanale raro che cade fuori dalla finestra di 7 giorni sembra sovradimensionamento permanente. Il margine del 20% sul floor suggerito è la mitigazione, non una garanzia — verifica con una finestra di osservazione più lunga per workload a picchi prima di abbassare il Min ACU.

## Suite SageMaker

Tre scanner, pensati per essere letti insieme — una vista sul ciclo di vita del modello (notebook → endpoint → artefatto orfano):

**`sagemaker-notebook-idle`** (richiede `--live-pricing`) — un'istanza notebook `InService` con CPU massima ≤ `thresholds.sagemakerNotebookCpuPercent` (default `2`) in una finestra di 7 giorni.

> **Nota:** solo CPU. Le istanze notebook GPU possono costare centinaia o migliaia di dollari al giorno e questo check non dice nulla sull'utilizzo GPU — non distingue nemmeno un "kernel idle" da "qualcuno che legge il notebook senza eseguire celle". Tratta un finding come "vai a controllare", non come spreco confermato.

**`sagemaker-endpoint-idle`** (richiede `--live-pricing`) — un endpoint `InService` con zero `Invocations` sommate in una finestra di 7 giorni. Il costo è il costo pieno instance-hour su tutte le istanze di ogni production variant.

**`sagemaker-training-orphaned`** — un Model SageMaker registrato non referenziato da nessuna Endpoint Config (`sagemaker:ListModels` incrociato con `sagemaker:ListEndpointConfigs`). È igiene del namespace, non un costo SageMaker diretto (la risorsa Model in sé è gratuita) — il costo stimato è lo storage S3 Standard di `ModelDataUrl`, valorizzato con la chiave esistente `s3-standard`.

**Rischio:** un modello tenuto deliberatamente per rollback/backup appare identico a uno davvero abbandonato dal punto di vista AWS-API-only; il periodo di grazia (`--min-age-days`) è l'unica mitigazione.

## Ambienti Dev/PR fantasma

**`environment-ghost`** — raggruppa risorse (EC2, RDS, Lambda, Load Balancer) per valore di tag o per match su naming pattern, poi segnala un gruppo come "ambiente fantasma" solo quando *tutte* le risorse al suo interno sono inattive da `environmentDetection.inactivityDays` (default `7`) o più.

Config (`cloudriftrc` / `cloudrift.config.json`):

```json
{
  "environmentDetection": {
    "tagKeys": ["Environment", "env", "branch"],
    "namingPatterns": ["*-pr-*", "*-preview-*", "*-dev-*", "*-feat-*"],
    "inactivityDays": 7
  }
}
```

`tagKeys` viene provato per primo (`resourcegroupstaggingapi:GetResources`, raggruppato per valore di tag); `namingPatterns` è il fallback per risorse senza tag corrispondente. È lo scanner più sperimentale della Phase 6 — dipende interamente dalla disciplina di tagging/naming del tuo account, e un team senza nessuna delle due non vedrà nulla. Inizia aggiungendo un `tagKeys` che rispecchi come la tua organizzazione effettivamente tagga gli ambienti effimeri, prima di fidarti del fallback sui naming pattern.

## Visibilità costi EKS

Entrambi gli scanner sono **AWS-API-only** — nessun kubeconfig, nessuna connettività interna al cluster, mai. Vedi [ADR-0066](../adr/0066-eks-scanners-aws-api-only-kubeconfig-deferred.md) per il perché: richiedere accesso RBAC in lettura al cluster romperebbe il modello di fiducia "solo un ruolo IAM" che è centrale nel modo in cui cloudrift viene usato. Il compromesso è un vero limite di accuratezza — leggi entrambe le note prima di agire su uno dei due finding.

**`eks-node-overprovisioned`** (richiede `--live-pricing`) — un Node Group EKS il cui rapporto CPU richiesta/allocabile, secondo gli aggregati **a livello di nodo** di CloudWatch Container Insights (`node_cpu_request`/`node_cpu_limit`, namespace `ContainerInsights`), è sotto `thresholds.eksNodeUtilizationPercent` (default `30`) in una finestra di 7 giorni. Il numero di nodi suggerito scala verso un target di utilizzo del 70%, mai sotto 1 nodo e mai sopra il conteggio attuale (`suggestNodeCount` nello scanner). Il risparmio è `(nodeCount − nodeCount suggerito) × <prezzo mensile instance type>`.

Se Container Insights non è attivo su un cluster, lo scanner degrada in modo controllato — emette un warning di scan e non produce **nessun finding** per quel cluster, invece di indovinare da dati mancanti.

> **Nota:** legge solo aggregati a livello di Node Group, mai le `resources.requests`/`resources.limits` dei singoli Pod — non può dirti *quali* Pod sono sovradimensionati, solo che il gruppo nel suo complesso appare sovradimensionato. Un `KubernetesDataPort` per l'accuratezza a livello di Pod è un punto di estensione esplicito, non ancora definito, per una fase futura (ADR-0066) — non aspettartelo da questo scanner oggi.

**`eks-orphan-pvc`** — un volume EBS creato per una PersistentVolumeClaim Kubernetes (identificato tramite il tag del CSI driver `kubernetes.io/created-for/pvc/name`) che è:
- non attaccato (`state: available`), oppure
- ancora taggato per un cluster EKS che non esiste più, tramite il tag legacy del provisioner in-tree `kubernetes.io/cluster/<nome>` correlato con `eks:ListClusters`.

Il costo usa la stessa tabella di prezzi EBS statica dello scanner `ebs-volume` (non serve `--live-pricing`).

> **Nota:** il tag col nome del cluster è una convenzione legacy del provisioner in-tree. I volumi creati dal moderno EBS CSI driver senza `--extra-tags` non portano un nome cluster recuperabile — quei volumi vengono intercettati solo dal check "non attaccato", mai da quello sul cluster cancellato. Non è un bug da correggere; è un limite intrinseco di leggere i tag invece di parlare con la Kubernetes API.

## Permessi IAM

Le azioni richieste da tutti e 9 gli scanner sono già incluse nel blocco di policy [Permessi IAM necessari](permessi-iam.md): `sqs:ListQueues`/`GetQueueAttributes`/`ListDeadLetterSourceQueues`/`ListQueueTags`, `rds:DescribeDBClusters`, `tag:GetResources`, `eks:ListClusters`/`ListNodegroups`/`DescribeNodegroup`, più le azioni `sagemaker:*` in lettura già preesistenti. `eks-node-overprovisioned` e gli scanner idle di SageMaker richiedono inoltre `pricing:GetProducts` quando eseguiti con `--live-pricing`, come ogni altro scanner con prezzo per-instance-type.
