# Test

> 🇬🇧 [English version](../en/testing.md)

Questo documento descrive la piramide dei test di cloudrift: cosa copre ciascun livello, dove trovare esempi concreti, come lanciare l'harness e2e su LocalStack e come verificare manualmente gli scanner contro un account AWS sandbox reale.

## La piramide

```
        ┌─────────────────────────┐
        │   CLI e2e (apps/cli)    │   a livello comando: formato, exit code, artefatti
        ├─────────────────────────┤
        │  Infra (contract test)  │   fixture di risposte reali riprodotte: shape → findings, 43/43
        ├─────────────────────────┤
        │  Infra (scanner spec)   │   SDK AWS mockato: forma della query, paginazione, errori
        ├─────────────────────────┤
        │  Dominio (entity/policy)│   logica pura: regole di spreco, boundary, niente I/O
        └─────────────────────────┘
        ┌─────────────────────────┐
        │  e2e LocalStack (free)  │   scripts/e2e-localstack.mjs (questo doc), 17/43 scanner
        ├─────────────────────────┤
        │  Verifica manuale AWS   │   scripts/verify-against-aws.mjs (questo doc)
        ├─────────────────────────┤
        │  Verifica AWS reale     │   harness CDK esterno (vedi sotto), 36/43 scanner
        └─────────────────────────┘
```

### Dominio — entità e policy

Unit test puri, senza mock. Uno spec per entità, che verifica i campi esposti, il valore calcolato specifico dell'entità, `kind`, `wasteReason` e `costEstimate`:

- [`libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts)

Le policy vivono in un unico file, [`libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts`](../../libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts), che copre per ogni policy: waste vs non-waste, il periodo di grazia, l'`ignoreTag`, `excludeTagValues`, e il boundary esatto di ogni soglia (età `===` `minAgeDays`, CPU `===` soglia, ops `===` `maxOps`) — i boundary contano perché periodo di grazia e confronti CPU/ops usano operatori con stretta opposta (`<` contro `>=`/`>`), quindi un errore di uno cambia silenziosamente quali risorse vengono segnalate.

### Infra — scanner

Uno spec per scanner in [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), con il client SDK AWS mockato. Ognuno copre: il filtro dei candidati (es. `DescribeVolumes` con `Filters=[status=available]`), paginazione, concorrenza, errori dell'SDK e `destroy()` sul client. Ventiquattro scanner sono basati su CloudWatch — i nove originali (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`), dieci aggiunti nella Fase 5.5 (`aws-fsx-idle`, `aws-redshift-idle`, `aws-opensearch-idle`, `aws-msk-idle`, `aws-documentdb-idle`, `aws-neptune-idle`, `aws-mq-idle`, `aws-vpn-connection-idle`, `aws-transit-gateway-idle`, `aws-kinesis-idle`; `aws-workspaces-idle` è l'unico scanner della Fase 5.5 a non basarsi su CloudWatch, interroga invece `DescribeWorkspacesConnectionStatus`), più cinque aggiunti nella Fase 6 (`aws-sqs-dlq-abandoned`, `aws-aurora-serverless-idle`, `aws-sagemaker-notebook-idle`, `aws-sagemaker-endpoint-idle`, `aws-eks-node-overprovisioned`) — e asseriscono in più l'esatto `Namespace`, `Period`, `Statistics` e `Dimensions` inviati a `GetMetricStatistics`. 23 di questi 24 estendono il template method condiviso `CloudWatchIdleScanner` ([ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md), testato indipendentemente in [`cloudwatch-idle.scanner.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/cloudwatch-idle.scanner.spec.ts) contro una sottoclasse concreta finta); `aws-s3-no-lifecycle` è l'unica eccezione (un periodo CloudWatch fisso di 1 giorno indipendente dalla finestra di lookback non entra nel template) e chiama direttamente le funzioni pure di basso livello in [`cloudwatch-metrics.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/utils/cloudwatch-metrics.ts) (anch'esse testate indipendentemente). Poiché ogni scanner migrato ha mantenuto esattamente gli stessi argomenti di `GetMetricStatisticsCommand`, nessuno dei 19 scanner spec originali ha richiesto modifiche quando è stata introdotta la base class. È il contratto su cui si appoggiano sia lo script di verifica manuale descritto sotto (che attualmente ne copre quattro: `aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`) sia l'harness e2e su LocalStack; [l'ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md)/[l'ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) hanno rilevato e poi risolto il fallimento di `GetMetricStatistics` contro LocalStack 4.0 per tutti e diciannove i (allora) scanner basati su CloudWatch, quindi l'harness e2e oggi esercita davvero il percorso request/response di CloudWatch, non solo la forma della richiesta verificata dagli unit test.

**Guardie sui campi richiesti.** Ogni scanner (basato su CloudWatch o no) scarta le entry della risposta AWS senza un campo identificativo richiesto (es. `VolumeId`) tramite un `.filter()` a restringimento di tipo invece di una non-null assertion, loggando lo scarto via `DEBUG=cloudrift:*` — vedi [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md). Gli scanner spec esistenti, che mockano risposte SDK ben formate, esercitano questo come pass-through; oggi non c'è un test dedicato "risposta malformata" per ogni scanner.

### Infra — contract test (replay di fixture)

Gli scanner spec qui sopra costruiscono payload minimi a mano, quindi non possono dire se la shape che uno scanner *si aspetta* corrisponde ancora a quella che AWS *restituisce* davvero. [`scanner-contract.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/scanner-contract.spec.ts) chiude questo gap per tutti i 43 scanner ([ADR-0053](../adr/0053-contract-tests-fixture-replay.md)): ogni kind ha una fixture JSON in [`src/testing/contract-fixtures/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/testing/contract-fixtures/) con le risposte raw complete — `$metadata`, cursori di paginazione e tutto — indicizzate per nome del Command, più i findings esatti prodotti dall'esecuzione live; lo spec riproduce le pagine attraverso l'intera pipeline dello scanner (list → type-narrowing → metrica → `toEntity` → policy) e verifica che escano gli stessi findings. Le classi Command restano reali (nessun `jest.mock` dei moduli SDK): l'unico seam è il metodo `send` della classe base `Client` condivisa dall'SDK. Un test di copertura fallisce se un `ResourceKind` arriva mai senza fixture, e la fixture `ebs-snapshot` fa anche da contratto di paginazione (il finding atteso vive a pagina 2, raggiungibile solo seguendo `NextToken`).

La provenienza di ogni fixture è registrata nel suo campo `source`: 14 sono state catturate da LocalStack seedato con [`scripts/capture-contract-fixtures.mjs`](../../scripts/capture-contract-fixtures.mjs) (rilanciarlo per rigenerarle dopo un bump dell'SDK o un cambio di query di uno scanner — non sovrascrive mai quelle trascritte), e 29 sono state trascritte dalla reference API AWS per i kind che LocalStack Community non può ospitare (elbv2/RDS/EFS/FSx rifiutati per licenza, i 10 scanner `--live-pricing` perché la Pricing API è un endpoint reale firmato; `ebs-snapshot` è trascritta invece che catturata perché moto pre-popola >1000 snapshot pubbliche di catalogo) — più i 5 scanner aggiunti il 2026-07-22 (`ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, `rds-manual-snapshot-old`, `secretsmanager-unused`), nessuno dei quali ancora coperto dallo script di cattura.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) pilota il comando con un `AnalyzeDeps` fake (niente AWS), verificando la scelta del formato (table/json/markdown), gli exit code (0/1/2), gli artefatti `--json <file>` e `--pdf <file>`, e che uno scan parziale (`summary.scanErrors` non vuoto) non faccia crashare il comando — l'exit code resta dettato solo dalla soglia di costo, mai dagli errori di scan, e la nota di scan incompleto (prodotta dai formatter, vedi [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) arriva fino a stdout. `analyze-waste.composition.ts` — l'implementazione `defaultAnalyzeDeps` che il fake sostituisce — non ha un suo spec per scelta: si limita a cablare insieme gli adapter AWS reali (stesso pattern di `aws-account-id.resolver.ts`), ed è esattamente quel cablaggio che il fake serve a bypassare nei test unitari.

## Harness e2e su LocalStack

Gli spec sopra mockano l'SDK AWS, quindi verificano la *forma* di una query ma non lanciano mai davvero il binario CLI buildato contro qualcosa. [`scripts/e2e-localstack.mjs`](../../scripts/e2e-localstack.mjs) chiude questo gap senza costi né credenziali AWS reali: avvia un container [LocalStack](https://www.localstack.cloud/) (`docker-compose.localstack.yml`), semina una risorsa sprecata/ottimizzabile per ogni kind (`scripts/seed-localstack.mjs`), lancia `cloudrift analyze` buildato contro quel container, verifica che ogni kind atteso produca un finding, e smonta il container — anche in caso di fallimento. Passa `--all-services` esplicitamente così l'esecuzione copre sempre tutti gli scanner indipendentemente dalla logica di trigger del [picker interattivo](../adr/0041-interactive-scanner-selection-wizard.md) — cintura e bretelle, dato che lo stdout in pipe di `spawnSync` non è comunque mai un TTY.

Lo scope è 17 dei 43 scanner (vedi [ADR-0002](../adr/0002-localstack-e2e-scope.md), [ADR-0036](../adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md) e [ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md)):

- `rds-instance`, `rds-underutilized`, `elasticache-idle`, `efs-unused` (il piano Hobby gratuito di LocalStack non emula RDS/ElastiCache/EFS) ed `ec2-underutilized` (il match con la Pricing API di cui ha bisogno non è affidabile sul piano Hobby) sono esclusi del tutto e restano coperti solo dallo script di verifica manuale AWS più sotto.
- I 7 scanner della Fase 5.5 che richiedono `--live-pricing` (`redshift-idle-cluster`, `opensearch-idle-domain`, `msk-idle-cluster`, `documentdb-idle-instance`, `neptune-idle-instance`, `mq-idle-broker`, `workspaces-idle`) sono esclusi anch'essi del tutto: la Pricing API AWS è un endpoint reale firmato che non funziona con le credenziali fittizie di LocalStack.
- `fsx-idle-filesystem` è escluso del tutto: LocalStack Community rifiuta ogni chiamata FSx (`"API for service 'fsx' not yet implemented or pro feature"`).
- `aurora-serverless-overprovisioned` (Fase 6.2) e `sqs-dlq-abandoned` (Fase 6.1, [ADR-0065](../adr/0065-vertical-premium-scanners-phase-6-strategy.md)) sono esclusi del tutto: non realisticamente seminabili/copribili su LocalStack Community, restano entrambi sulla verifica manuale.
- `sagemaker-notebook-idle`, `sagemaker-endpoint-idle` e `sagemaker-training-orphaned` (Fase 6.3, [ADR-0068](../adr/0068-sagemaker-scanners-excluded-from-localstack-e2e.md)) sono esclusi del tutto: LocalStack Community non espone affatto il servizio `sagemaker` — confermato empiricamente, non solo assunto per analogia con il precedente RDS/ElastiCache/EFS dell'ADR-0002.
- `load-balancer` e `nat-gateway` sono nella lista dei kind attesi ma trattati come soft-missing — `load-balancer` perché il piano Hobby di LocalStack rifiuta del tutto le chiamate `elbv2` con un errore di licenza; lo stato soft di `nat-gateway` precede ed è indipendente dall'incompatibilità CloudWatch descritta sotto.
- I 3 scanner always-on della Fase 5.5 rimasti (`vpn-connection-idle`, `transit-gateway-idle-attachment`, `kinesis-provisioned-idle-stream`) erano soft-missing perché `GetMetricStatistics` falliva del tutto su LocalStack 4.0 per ogni scanner basato su CloudWatch, vecchi e nuovi — vedi [ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md). Risolto in [ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) aggiornando l'immagine fissata a `localstack/localstack:4.14.0`: questi 3, più i preesistenti `ebs-idle`, `lambda-underutilized`, `dynamodb-overprovisioned` e `s3-no-lifecycle`, sono di nuovo hard-required.

**Setup (una tantum):** registra un account gratuito su [app.localstack.cloud](https://app.localstack.cloud) e prendi il tuo Auth Token dalla dashboard — anche il piano Hobby gratuito ne richiede uno, il container si rifiuta di partire senza.

```sh
export LOCALSTACK_AUTH_TOKEN=<il-tuo-token>
pnpm nx run cli:build
pnpm nx run cli:e2e-localstack   # oppure: pnpm e2e:localstack
```

Richiede Docker. Non è cablato in `lint`/`test`/`build`/`typecheck` — è un target Nx opt-in con un suo job CI dedicato (`e2e-localstack` in `.github/workflows/ci.yml`), che legge il token dal secret di repository `LOCALSTACK_AUTH_TOKEN`.

### Ispezione manuale (tabella / PDF) contro LocalStack

`scripts/e2e-localstack.mjs` cattura il JSON solo per le sue asserzioni, poi smonta il container — non mostra mai una tabella né genera un PDF. Per guardare davvero un report con i dati di LocalStack, pilota i singoli pezzi a mano invece dell'harness:

```sh
# 0. Una tantum, se non già buildato
pnpm nx run cli:build

# 1. Token di autenticazione (lo stesso usato dall'harness)
export LOCALSTACK_AUTH_TOKEN=<il-tuo-token>

# 2. Avvia LocalStack e aspetta che sia healthy
docker compose -f docker-compose.localstack.yml up -d --wait

# 3. Punta l'SDK AWS verso LocalStack per questa sessione di shell
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1

# 4. Semina le risorse sprecate (seed-localstack.mjs è eseguibile da solo)
node scripts/seed-localstack.mjs

# 5. Ispeziona come tabella a terminale (--all-services salta il picker
#    interattivo di selezione scanner, che qui comparirebbe altrimenti
#    dato che questo gira in un vero terminale)...
node apps/cli/dist/main.js analyze --regions us-east-1 --min-age-days 0 --format table --all-services

# 6. ...oppure come PDF
node apps/cli/dist/main.js analyze --regions us-east-1 --min-age-days 0 --pdf ./report.pdf --all-services

# 7. Ripeti il passo 5/6 quante volte vuoi — container e dati seedati
#    restano lì finché non li smonti

# 8. Smonta tutto quando hai finito
docker compose -f docker-compose.localstack.yml down -v
```

## Verifica manuale contro un account AWS reale

Le chiamate SDK mockate verificano la *forma* di una query; non possono verificare che quella forma corrisponda davvero a ciò che AWS restituisce per risorse reali. [`scripts/verify-against-aws.mjs`](../../scripts/verify-against-aws.mjs) chiude questo gap: esegue 11 dei 18 scanner — tutto ciò che è stato pubblicato prima della v0.4.0 — contro un account AWS reale e stampa cosa trovano, accanto al descrittore statico della query già asserito in CI dallo spec dello scanner corrispondente. Gli scanner aggiunti dalla v0.4.0 in poi non sono mai stati cablati in questo script; la copertura più ampia su AWS reale da allora arriva invece dal giro di verifica separato descritto sotto.

**Non** viene eseguito da `pnpm test` né dalla CI — chiama API AWS reali e va lanciato a mano contro un account **sandbox**.

### Checklist di seeding

Crea questi elementi nell'account sandbox prima di lanciare lo script (qualsiasi regione, default `us-east-1`):

| Risorsa | Cosa creare | Finding atteso |
| --- | --- | --- |
| Volume EBS | un volume **non attaccato**, più vecchio di 7 giorni | `ebs-volume` |
| Elastic IP | un EIP **non associato** | `elastic-ip` |
| NAT Gateway | un gateway con **zero traffico** per 48h | `nat-gateway` |
| Istanza EC2 | un'istanza **ferma** da più di 7 giorni | `ec2-instance` |
| Istanza EC2 | un'istanza **running** con CPU bassa per 14+ giorni | `ec2-underutilized` |
| Volume EBS (gp2) | un volume gp2 **attaccato** | `ebs-gp2-upgrade` |
| Volume EBS | un volume **attaccato** con zero I/O per 48h | `ebs-idle` |
| Snapshot EBS | uno snapshot il cui volume sorgente è stato cancellato | `ebs-snapshot` |
| Istanza RDS | un'istanza **ferma** | `rds-instance` |
| Istanza RDS | un'istanza **available** con CPU bassa per 14+ giorni | `rds-underutilized` |
| Load balancer | un ALB/NLB senza target registrati | `load-balancer` |

### Lanciarlo

```sh
pnpm nx run-many -t build
CLOUDRIFT_VERIFY_AWS_SANDBOX=1 pnpm verify:aws -- --region us-east-1
```

Lo script si rifiuta di partire senza `CLOUDRIFT_VERIFY_AWS_SANDBOX=1` (per evitare un run accidentale contro un profilo default/produzione) e senza credenziali AWS risolvibili (verificate via STS `GetCallerIdentity`).

Per ogni scanner stampa: il kind, il numero di finding, il costo mensile stimato totale, i primi 5 finding (id + motivo + costo) ed eventuali errori. Da controllare a occhio: `region`, `monthlyCostUsd`, `wasteReason`.

### Quando va eseguito

Una volta all'atterraggio della fase 3 (la piramide dei test completa), poi solo quando cambiano i parametri dei filtri CloudWatch (`Namespace`, `Dimensions`, `Period`, `Statistics`) o le query di pricing — sono le parti che nessun mock può validare contro il comportamento reale di AWS.

## Stato della verifica su AWS reale (più ampia di `verify-against-aws.mjs`)

Con la crescita del numero di scanner ben oltre quanto copre `verify-against-aws.mjs`, la verifica su AWS reale si è spostata su un ciclo separato di deploy/validate/destroy contro un account AWS reale (uno stack CDK di test in un repo gemello, `cloudrift-cdk-test`, non parte di questo repository). È manuale, ad hoc, e non cablato in CI — esiste per intercettare la classe di bug che nessun mock o fixture LocalStack può vedere (filtri `productFamily`/`instanceType` sbagliati nella Pricing API, shape SDK con `String` boxed, ecc.), a un costo reale in dollari per ogni run.

**Copertura attuale: 36 dei 43 scanner hanno trovato uno spreco reale su un account AWS live** (33 originali + `ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, confermati il 2026-07-22 tramite l'harness `cloudrift-cdk-test`). I restanti 7 si dividono in due tipi di gap diversi:

- `rds-manual-snapshot-old` e `secretsmanager-unused` sono girati end-to-end sullo stesso account reale senza nessun errore SDK/IAM/parsing, ma senza trovare nulla da segnalare: nessuno snapshot RDS manuale era presente nell'account di test da listare, e il secret di test era più giovane del grace period di 30 giorni (`unusedDays`). La chiamata SDK e la shape della risposta sono confermate live; il percorso finding+policy non ancora, perché nulla ha soddisfatto la condizione di spreco. Da rilanciare quando esiste uno snapshot manuale reale / il secret supera i 30 giorni.
- `rds-underutilized`, `aurora-serverless-overprovisioned`, `sqs-dlq-abandoned`, `eks-node-overprovisioned` ed `environment-ghost` richiedono tutti risorse rimaste attive con pattern d'uso reali e organici per 7–14 giorni — non qualcosa che uno stack CDK sintetico di breve durata può produrre. Serve un account reale in stile produzione, non più budget sullo stesso tipo di stack di test.

I run reali fatti finora hanno trovato e sistemato diversi bug invisibili ai mock — in particolare un bug nella costruzione condivisa del `PricingClient` e un bug di parsing su `String` boxed (`instanceof String`, non `typeof === 'string'`) in `AwsPricingApiAdapter` che azzerava silenziosamente ogni prezzo on-demand (`--live-pricing`). Vedi [ADR-0058](../adr/0058-aws-client-request-timeout.md)/[ADR-0064](../adr/0064-per-client-requesthandler-not-shared.md) per il pattern per-client-handler collegato a questa classe di bug.
