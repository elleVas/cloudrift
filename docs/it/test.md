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

Ogni policy vive nel proprio file sotto [`libs/cloud-cost/domain/src/policies/`](../../libs/cloud-cost/domain/src/policies/) (chiamato come l'entità che giudica, es. `ebs-volume.policy.ts`), sullo stesso pattern un-file-per-entità visto sopra. I loro test sono consolidati in un unico spec, [`libs/cloud-cost/domain/src/policies/waste-policies.spec.ts`](../../libs/cloud-cost/domain/src/policies/waste-policies.spec.ts), che copre per ogni policy: waste vs non-waste, il periodo di grazia, l'`ignoreTag`, `excludeTagValues`, e il boundary esatto di ogni soglia (età `===` `minAgeDays`, CPU `===` soglia, ops `===` `maxOps`) — i boundary contano perché periodo di grazia e confronti CPU/ops usano operatori con stretta opposta (`<` contro `>=`/`>`), quindi un errore di uno cambia silenziosamente quali risorse vengono segnalate.

### Infra — scanner

Uno spec per scanner in [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), con il client SDK AWS mockato. Ognuno copre: il filtro dei candidati (es. `DescribeVolumes` con `Filters=[status=available]`), paginazione, concorrenza, errori dell'SDK e `destroy()` sul client. Ventiquattro scanner sono basati su CloudWatch — i nove originali (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`), dieci aggiunti nella Fase 5.5 (`aws-fsx-idle`, `aws-redshift-idle`, `aws-opensearch-idle`, `aws-msk-idle`, `aws-documentdb-idle`, `aws-neptune-idle`, `aws-mq-idle`, `aws-vpn-connection-idle`, `aws-transit-gateway-idle`, `aws-kinesis-idle`; `aws-workspaces-idle` è l'unico scanner della Fase 5.5 a non basarsi su CloudWatch, interroga invece `DescribeWorkspacesConnectionStatus`), più cinque aggiunti nella Fase 6 (`aws-sqs-dlq-abandoned`, `aws-aurora-serverless-idle`, `aws-sagemaker-notebook-idle`, `aws-sagemaker-endpoint-idle`, `aws-eks-node-overprovisioned`) — e asseriscono in più l'esatto `Namespace`, `Period`, `Statistics` e `Dimensions` inviati a `GetMetricStatistics`. 23 di questi 24 estendono il template method condiviso `CloudWatchIdleScanner` ([ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md), testato indipendentemente in [`cloudwatch-idle.scanner.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/cloudwatch-idle.scanner.spec.ts) contro una sottoclasse concreta finta); `aws-s3-no-lifecycle` è l'unica eccezione (un periodo CloudWatch fisso di 1 giorno indipendente dalla finestra di lookback non entra nel template) e chiama direttamente le funzioni pure di basso livello in [`cloudwatch-metrics.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/utils/cloudwatch-metrics.ts) (anch'esse testate indipendentemente). Poiché ogni scanner migrato ha mantenuto esattamente gli stessi argomenti di `GetMetricStatisticsCommand`, nessuno dei 19 scanner spec originali ha richiesto modifiche quando è stata introdotta la base class. È il contratto su cui si appoggiano sia lo script di verifica manuale descritto sotto (che attualmente ne copre quattro: `aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`) sia l'harness e2e su LocalStack; [l'ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md)/[l'ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) hanno rilevato e poi risolto il fallimento di `GetMetricStatistics` contro LocalStack 4.0 per tutti e diciannove i (allora) scanner basati su CloudWatch, quindi l'harness e2e oggi esercita davvero il percorso request/response di CloudWatch, non solo la forma della richiesta verificata dagli unit test.

**Guardie sui campi richiesti.** Ogni scanner (basato su CloudWatch o no) scarta le entry della risposta AWS senza un campo identificativo richiesto (es. `VolumeId`) tramite un `.filter()` a restringimento di tipo invece di una non-null assertion, loggando lo scarto via `DEBUG=cloudrift:*` — vedi [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md). Gli scanner spec esistenti, che mockano risposte SDK ben formate, esercitano questo come pass-through; oggi non c'è un test dedicato "risposta malformata" per ogni scanner.

### Infra — contract test (replay di fixture)

Gli scanner spec qui sopra costruiscono payload minimi a mano, quindi non possono dire se la shape che uno scanner *si aspetta* corrisponde ancora a quella che AWS *restituisce* davvero. [`scanner-contract.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/scanner-contract.spec.ts) chiude questo gap per tutti i 43 scanner ([ADR-0053](../adr/0053-contract-tests-fixture-replay.md)): ogni kind ha una fixture JSON in [`src/testing/contract-fixtures/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/testing/contract-fixtures/) con le risposte raw complete — `$metadata`, cursori di paginazione e tutto — indicizzate per nome del Command, più i findings esatti prodotti dall'esecuzione live; lo spec riproduce le pagine attraverso l'intera pipeline dello scanner (list → type-narrowing → metrica → `toEntity` → policy) e verifica che escano gli stessi findings. Le classi Command restano reali (nessun `jest.mock` dei moduli SDK): l'unico seam è il metodo `send` della classe base `Client` condivisa dall'SDK. Un test di copertura fallisce se un `ResourceKind` arriva mai senza fixture, e la fixture `ebs-snapshot` fa anche da contratto di paginazione (il finding atteso vive a pagina 2, raggiungibile solo seguendo `NextToken`).

La provenienza di ogni fixture è registrata nel suo campo `source`: 14 sono state catturate da LocalStack seedato con [`scripts/capture-contract-fixtures.mjs`](../../scripts/capture-contract-fixtures.mjs) (rilanciarlo per rigenerarle dopo un bump dell'SDK o un cambio di query di uno scanner — non sovrascrive mai quelle trascritte), e 29 sono state trascritte dalla reference API AWS per i kind che LocalStack Community non può ospitare (elbv2/RDS/EFS/FSx rifiutati per licenza, i 10 scanner `--live-pricing` perché la Pricing API è un endpoint reale firmato; `ebs-snapshot` è trascritta invece che catturata perché moto pre-popola >1000 snapshot pubbliche di catalogo) — più i 5 scanner aggiunti il 2026-07-22 (`ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, `rds-manual-snapshot-old`, `secretsmanager-unused`), nessuno dei quali ancora coperto dallo script di cattura.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) pilota il comando con un `AnalyzeDeps` fake (niente AWS), verificando la scelta del formato (table/json/markdown), gli exit code (0/1/2), gli artefatti `--json <file>` e `--pdf <file>`, e che uno scan parziale (`summary.scanErrors` non vuoto) non faccia crashare il comando — l'exit code resta dettato solo dalla soglia di costo, mai dagli errori di scan, e la nota di scan incompleto (prodotta dai formatter, vedi [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) arriva fino a stdout. `analyze-waste.composition.ts` — l'implementazione `defaultAnalyzeDeps` che il fake sostituisce — non ha un suo spec per scelta: si limita a cablare insieme gli adapter AWS reali (stesso pattern di `aws-account-id.resolver.ts`), ed è esattamente quel cablaggio che il fake serve a bypassare nei test unitari.

### Cost analytics — `cost`/`trend`

Stessa forma di `analyze`, un layer alla volta, nessuno dei quali tocca AWS o soldi veri:

- **Domain/application**: [`compare-cost.use-case.spec.ts`](../../libs/cloud-cost/application/src/use-cases/compare-cost.use-case.spec.ts) copre la logica della finestra giorno-per-giorno (periodo corrente vs. precedente), il clipping del periodo precedente invece di sconfinare nel mese corrente quando è più corto, la propagazione invariata di un fallimento di `CostExplorerPort`, e la regressione trovata durante la verifica su AWS reale: `changePercent` riporta `null` invece di una percentuale astronomica quando il periodo precedente arrotonda a $0.00. [`cost-trend.use-case.spec.ts`](../../libs/cloud-cost/application/src/use-cases/cost-trend.use-case.spec.ts) copre la mappatura bucket→mese, il filtro per servizio, e la richiesta di esattamente `months` mesi solari incluso quello corrente parziale.
- **Infra — cache**: [`cost-explorer-cache.adapter.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/cost-explorer/cost-explorer-cache.adapter.spec.ts) copre la cache su disco di `CachedCostExplorerAdapter` ([ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md)): servire richieste identiche ripetute su un range chiuso dalla cache invece di richiamare (e rifatturare) Cost Explorer, non cachare mai un range che tocca il periodo corrente ancora aperto, `--refresh-cache` che bypassa ma comunque aggiorna la cache, chiavi di cache per account, e la propagazione di un fallimento senza cacharlo. `AwsCostExplorerAdapter` stesso (la vera chiamata `GetCostAndUsageCommand`) non ha un suo spec — stesso pattern "wiring AWS reale sottile, bypassato dal fake in ogni altro test" di `analyze-waste.composition.ts` sopra.
- **CLI e2e**: [`cost.command.spec.ts`](../../apps/cli/src/commands/cost.command.spec.ts) e [`trend.command.spec.ts`](../../apps/cli/src/commands/trend.command.spec.ts) pilotano i comandi con un `CostAnalyticsDeps` fake (niente AWS, nessun addebito Cost Explorer), verificando la scelta del formato (table/json), la validazione dell'input (`--format`, `--fail-on-increase`, `--months`), il gate `--fail-on-increase`/`costIncreaseAlertPercent` (il flag esplicito sovrascrive la config; exit 2 su un picco di spesa; nessun gate se nessuno dei due è impostato), la risoluzione dello shorthand di `trend` (`ec2` → il nome di servizio Cost Explorer documentato; uno shorthand non risolto passa invariato), e `--silent` che sopprime interamente lo stdout. Entrambi i comandi chiamano `confirmCostExplorerCharge()` direttamente (non fa parte del seam iniettabile `CostAnalyticsDeps`), ma sotto Jest `isInteractiveTty()` è false, quindi va sempre in cortocircuito su "procedi" prima di raggiungere la chiamata `confirm` di `@clack/prompts` — il prompt di conferma in sé non ha uno spec dedicato e non è verificato fuori dall'uso manuale.

### Dead resources — `dead-resources`

Un dominio separato da `WastedResource` ([ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md)), testato allo stesso modo, layer per layer:

- **Dominio**: uno spec di entità + uno di policy per kind — i 4 originali (`ec2-keypair-unused`, `ec2-ri-expiring-soon`, `iam-user-inactive`, `iam-policy-unattached`), 9 aggiunti il 2026-07-23 mattina (`iam-role-unused`, `iam-access-key-stale`, `ec2-security-group-unused`, `logs-loggroup-empty`, `acm-certificate-unused`, `route53-hostedzone-empty`, `cloudformation-stack-stuck`, `s3-bucket-empty`, `cloudwatch-alarm-orphaned`), più altri 5 aggiunti lo stesso giorno (`sns-topic-unsubscribed`, `iam-instance-profile-unattached`, `eventbridge-rule-no-targets`, `ecr-repository-empty`, `stepfunctions-statemachine-unused`) — 18 kind totali, in `libs/dead-resources/domain/src/{entities,policies}/`, stessa forma degli spec di `cloud-cost-domain` sopra: boundary del grace period, ignore tag, e la soglia specifica per kind di ogni policy dove presente. Cinque kind (`ec2-security-group-unused`, `route53-hostedzone-empty`, `sns-topic-unsubscribed`, `eventbridge-rule-no-targets`) saltano del tutto il meccanismo del grace period — le loro API AWS di list non espongono un creation timestamp, quindi le policy applicano solo le esclusioni tag condivise e flaggano incondizionatamente; i loro spec verificano proprio questo invece di un caso limite di grace period.
- **Infra — scanner**: uno spec per scanner in `libs/dead-resources/infrastructure/aws-adapter/src/scanners/`, SDK mockato come negli spec scanner di `cloud-cost-infrastructure-aws-adapter`. `aws-iam-user-inactive.scanner.spec.ts` copre in più il fan-out `ListAccessKeys`→`GetAccessKeyLastUsed` (il solo login con password basta a escludere un utente senza access key); `aws-s3-bucket-empty.scanner.spec.ts`/`aws-ecr-repository-empty.scanner.spec.ts` coprono il caso di un'ispezione fallita su una singola risorsa, che viene saltata invece di far fallire l'intera scansione. `aws-iam-instance-profile-unattached.scanner.spec.ts` è l'unico veramente diverso in questo dominio: mocka sia `IAMClient` che `EC2Client`, cattura la regione a cui ogni `EC2Client` è legato dalla sua config di costruzione (il mock di `send` fa branch su `command instanceof X` più quella regione catturata), e verifica che un instance profile attaccato a un'istanza in una regione abilitata *non di default* venga correttamente **non** flaggato — il comportamento vero che l'incrocio account-wide su tutte le regioni deve garantire, non solo l'happy path a singola regione che ogni altro test di scanner copre. `aws-stepfunctions-statemachine-unused.scanner.spec.ts` verifica che una state machine di tipo `EXPRESS` esca in cortocircuito prima di qualunque chiamata `ListExecutions`.
- **Infra — contract test**: [`dead-resources-contract.spec.ts`](../../libs/dead-resources/infrastructure/aws-adapter/src/scanners/dead-resources-contract.spec.ts) rispecchia `scanner-contract.spec.ts` (ADR-0053) per questo dominio — una fixture hand-transcribed per kind in `src/testing/contract-fixtures/`, riprodotta attraverso l'intera pipeline di ogni scanner. Tutte e 18 sono trascritte a mano, nessuna catturata da LocalStack (vedi sotto); ogni soglia specifica per kind è azzerata nelle factory di scanner del test stesso (`minAgeDays: 0`, un `expiringWithinDays`/`inactivityDays` molto grande) così le date fisse delle fixture non invecchiano mai. Dieci dei client SDK oltre a `EC2Client`/`IAMClient` (`CloudWatchLogsClient`, `ACMClient`, `Route53Client`, `CloudFormationClient`, `S3Client`, `CloudWatchClient`, `SNSClient`, `EventBridgeClient`, `ECRClient`, `SFNClient`) hanno ciascuno una propria entry nella lista di base-object `@smithy/core` che il test monkey-patcha, senza assumere che condividano quella di `EC2Client`/`IAMClient` — vedi il commento in quel file per il ragionamento già stabilito empiricamente per ECR/Secrets Manager sul lato cost-waste. La fixture di `iam-instance-profile-unattached` fissa `DescribeRegionsCommand` a restituire esattamente una regione abilitata, così la sua pagina `DescribeInstancesCommand` (anch'essa patchata via la base condivisa di `EC2Client`) viene consumata una sola volta — il comportamento reale di fan-out multi-regione dello scanner è coperto dal suo spec unitario sopra, non dalla contract fixture.
- **Application**: [`find-dead-resources.use-case.spec.ts`](../../libs/dead-resources/application/src/use-cases/find-dead-resources.use-case.spec.ts) copre gli stessi comportamenti del coordinatore già visti nello spec di `AnalyzeCloudWasteUseCase` (aggregazione, isolamento errori per job, limite di concorrenza), più ciò che è realmente nuovo in questo coordinatore: uno scanner `scope: 'global'` riceve esattamente un job indipendentemente da quante regioni sono state richieste, uno scanner globale e uno regionale coesistono correttamente nella stessa esecuzione, e la entry `scanErrors` di uno scanner globale è etichettata `'global'`, non un region code reale (e fuorviante).
- **CLI e2e**: [`dead-resources.command.spec.ts`](../../apps/cli/src/commands/dead-resources.command.spec.ts) pilota il comando con un `DeadResourcesDeps` fake, coprendo la validazione di formato/`--min-age-days`/regione, la validazione di `--scanners` e la sua precedenza sul campo `scannerKinds` del wizard, `--silent`, e un file PDF realmente scritto su disco (verificando i magic byte `%PDF-`, stesso pattern di `analyze-waste.command.spec.ts`). [`dead-resource-presenters.spec.ts`](../../apps/cli/src/formatters/dead-resource-presenters.spec.ts) copre il dispatch a switch esaustivo (ADR-0059) per tutti e 18 i kind, incluso quali presenter omettono la colonna Region (i kind a scope globale). [`dead-resources-report.pdf-formatter.spec.ts`](../../apps/cli/src/formatters/dead-resources-report.pdf-formatter.spec.ts) è uno smoke test (completa senza lanciare eccezioni, byte PDF validi) per un summary multi-kind, uno vuoto, e uno con scan warning — stesso livello di test del PDF di `cost-comparison.pdf-formatter.spec.ts`, non asserzioni a livello di pixel.

**Verifica su AWS reale, 2026-07-23**: quattro esecuzioni separate contro un account reale (583359355881).

I **4 kind originali** sono girati per primi, su una singola regione (`eu-central-1`). `ec2-keypair-unused` ha trovato un finding reale (`eu-central-kp`, creata il 2023-09-13) e renderizzato correttamente end-to-end nel PDF (masthead, metric box, tabella breakdown, top findings, pagina di dettaglio). Gli altri tre (`ec2-ri-expiring-soon`, `iam-user-inactive`, `iam-policy-unattached`) sono girati con zero errori SDK/IAM/parsing (nessuna sezione scan-warnings nel report) ma senza produrre finding su questo account — chiamata e shape della risposta confermate live, ma il percorso finding+policy non verificato per questi tre, stessa distinzione già usata per `rds-manual-snapshot-old`/`secretsmanager-unused` sul lato cost-waste (vedi [Stato della verifica su AWS reale](#stato-della-verifica-su-aws-reale-più-ampia-di-verify-against-awsmjs) sotto). `ec2-ri-expiring-soon` è regionale ed era confermato pulito solo per `eu-central-1` da questa esecuzione, non per ogni regione.

**Tutti e 13 i kind esistenti all'epoca** sono poi girati insieme via wizard interattivo, due regioni (`us-east-1`, `eu-central-1`), output `--pdf`. Zero scan-warnings — ognuno dei 13 check ha completato senza errori SDK/IAM/parsing. Tre hanno prodotto finding reali: `ec2-keypair-unused` (`eu-central-kp`, come sopra), e due dei 9 kind aggiunti quella mattina — **`iam-role-unused`** (ruolo `S3ReadOnly`, mai assunto dalla creazione il 2023-10-23) e **`ec2-security-group-unused`** (gruppo `WebAccess`, `sg-0f7fdd4a079904424`, non referenziato da nessuna ENI). Entrambi renderizzati correttamente nella tabella breakdown del PDF, nella lista top-findings, e nella loro pagina di dettaglio. I restanti 7 di quel gruppo (`iam-access-key-stale`, `logs-loggroup-empty`, `acm-certificate-unused`, `route53-hostedzone-empty`, `cloudformation-stack-stuck`, `s3-bucket-empty`, `cloudwatch-alarm-orphaned`) sono girati puliti senza match su questo account — chiamata e shape della risposta confermate live (nessun errore), ma il percorso finding+policy resta non verificato per questi 7, stessa cautela "shape confermata, match live non confermato" di `ec2-ri-expiring-soon`/`iam-user-inactive`/`iam-policy-unattached` sopra.

**I 5 kind aggiunti più tardi lo stesso giorno** (`sns-topic-unsubscribed`, `iam-instance-profile-unattached`, `eventbridge-rule-no-targets`, `ecr-repository-empty`, `stepfunctions-statemachine-unused`) sono poi girati contro lo stesso account via wizard, tutti e 18 i kind insieme, due regioni. Questa esecuzione ha fatto emergere un bug di robustezza, non di correttezza: l'incrocio su tutte le regioni di `iam-instance-profile-unattached` (vedi il suo commento) apre in burst handshake DNS+TCP+TLS freschi verso ~15-20 endpoint regionali distinti, più stretto di quanto `connectionTimeout` di `createAwsClientConfig` (allora 5s) tollerasse sulla rete di casa del tester — sei job non correlati (`logs-loggroup-empty`×2 regioni, `ec2-security-group-unused`×2 regioni, `iam-access-key-stale`, `iam-policy-unattached`) sono falliti con errori di connection-timeout/socket-hang-up perché stavano girando in concorrenza durante quel burst, riportati onestamente come `scanErrors` invece di essere silenziosamente persi. Corretto lo stesso giorno: `connectionTimeout` alzato da 5s a 10s (in entrambe le copie di `createAwsClientConfig`, cost-waste e dead-resources — beneficio per ogni scanner su una connessione di casa lenta, non solo per questo) e `REGION_SCAN_CONCURRENCY` di `iam-instance-profile-unattached` abbassato da 5 a 3 (meno handshake freschi simultanei verso host diversi, a differenza degli altri fan-out di questo dominio che ripetono chiamate sullo stesso client già connesso). Un'esecuzione successiva ha confermato il fix: **zero scan-warnings**, tutti e 18 i check completati puliti. Due dei 5 kind nuovi hanno prodotto finding reali — **`iam-instance-profile-unattached`** (profilo `S3ReadOnly`, non attaccato in nessuna regione) ed **`ecr-repository-empty`** (2 repository vuoti di bootstrap CDK, uno per regione). I restanti 3 (`sns-topic-unsubscribed`, `eventbridge-rule-no-targets`, `stepfunctions-statemachine-unused`) sono girati puliti senza match su questo account — stessa cautela "shape confermata, match live non confermato" dei kind sopra ancora senza match.

**Deliberatamente non coperto — LocalStack e2e.** L'harness e2e su LocalStack (`scripts/e2e-localstack.mjs`) semina e pilota solo `analyze`; `dead-resources` non è stato aggiunto, ed è stata una decisione, non una dimenticanza (2026-07-23): LocalStack ha dismesso la Community Edition open source standalone a inizio 2026 (ora è un'unica immagine account-based; il piano gratuito esclude i CI credit), e la copertura di emulazione per operazione, in particolare per `DescribeReservedInstances`, non è confermata. Dato che i contract test sopra già verificano la gestione della response-shape di ogni scanner, la copertura e2e su LocalStack è stata giudicata non necessaria per questo dominio. Da riprendere se la situazione LocalStack cambia o emerge un gap concreto che solo l'e2e potrebbe cogliere.

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
