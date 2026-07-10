# Scelte Tecniche

> 🇬🇧 [English version](../en/technical-choices.md)

Questo documento spiega il perché di ogni scelta tecnologica nel progetto, con i trade-off considerati.

---

## Nx Monorepo

**Scelta:** gestire tutto il codice in un unico repository Nx con workspace pnpm.

**Perché:**
- Permette di condividere `shared-kernel` tra tutti i bounded context senza pubblicarlo su npm
- I target Nx (`build`, `test`, `typecheck`) vengono eseguiti solo sui progetti modificati (`nx affected`)
- Il caching locale (e opzionalmente Nx Cloud) evita di rieseguire operazioni costose
- I `moduleNameMapper` nei jest config permettono di importare le sorgenti TypeScript direttamente, senza buildare le dipendenze prima di testare

**Trade-off:** la complessità di configurazione iniziale di Nx è più alta rispetto a un singolo progetto, ma ripaga appena si hanno più di due librerie da orchestrare.

---

## pnpm come package manager

**Scelta:** pnpm invece di npm o yarn.

**Perché:**
- Usa hard link invece di copiare i pacchetti: installazione più veloce e meno spazio su disco
- Il `pnpm-workspace.yaml` definisce esplicitamente quali cartelle sono pacchetti del workspace
- Le dipendenze tra librerie interne usano `"cloud-cost-domain": "workspace:*"`, risolte con link simbolici

> Il repository ha **un solo lockfile**: `pnpm-lock.yaml`. Non vanno committati lockfile di altri package manager (`package-lock.json`, `yarn.lock`).

---

## TypeScript con `module: ESNext` e `moduleResolution: bundler`

**Scelta:** `"module": "ESNext"` e `"moduleResolution": "bundler"` nel `tsconfig.base.json`.

**Perché:**
- `moduleResolution: bundler` è la modalità raccomandata quando la risoluzione finale è delegata a un bundler (esbuild): permette **import relativi senza estensione** (`import { Entity } from './entity.base'`)
- Le import cross-package usano il nome del pacchetto (`import x from 'shared-kernel'`), risolto in sviluppo dalla condizione custom `@cloudrift/source` nel campo `exports` dei `package.json`

**Convenzione del repo: niente estensioni nelle import relative.** Tutto il codice usa `'./entity.base'`, mai `'./entity.base.js'`. La coerenza è garantita dal fatto che la CLI viene **bundlata**.

**Conseguenza importante (CLI bundlata):** l'output `tsc` delle librerie preserva le import senza estensione, che **non sono caricabili da Node in ESM puro**. Per questo il build della CLI usa esbuild con `bundle: true` e `thirdParty: false`: il codice delle librerie workspace viene inlinato nell'eseguibile (esbuild risolve le import senza estensione), mentre i pacchetti npm (AWS SDK, pdfkit, chalk, commander) restano `require()` esterni. Risultato: `node apps/cli/dist/main.js` funziona senza passi aggiuntivi. Se in futuro le librerie dovessero essere consumate direttamente come ESM da Node (fuori da un bundler), bisognerà emettere le estensioni o usare un build step dedicato.

**Per i test:** i `tsconfig.spec.json` usano `"module": "CommonJS"` e `"moduleResolution": "Node"` perché jest gira in CJS. I config jest sono `jest.config.cjs` (non `.ts`: `ts-node` non è installato, quindi jest non potrebbe caricarli).

---

## AWS SDK v3

**Scelta:** client modulari `@aws-sdk/client-ec2`, `client-rds`, `client-elastic-load-balancing-v2`, `client-cloudwatch`, `client-sts`, `client-pricing`.

**Perché:**
- Modulare: si importa solo il client necessario
- Client per-regione: ogni scanner crea un client con `{ ...AWS_CLIENT_DEFAULTS, region: region.code }` e lo distrugge nel `finally`
- `AWS_CLIENT_DEFAULTS` (`utils/client-config.ts`) imposta `maxAttempts: 3`, attivando il retry/backoff nativo dell'SDK per throttling (429) ed errori 5xx transitori, più un `NodeHttpHandler` con timeout di 5s per la connessione / 30s per la richiesta così un socket bloccato non può far restare uno scan appeso indefinitamente ([ADR-0058](../adr/0058-aws-client-request-timeout.md))
- Tipizzazione migliore e supporto nativo a ESM

**Pattern usato negli scanner:**
```typescript
const client = new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
try {
  const candidates = await paginate(/* DescribeVolumesCommand … */);
  const findings = candidates
    .map(mapToEntity)
    .filter((r) => this.policy.evaluate(r, now).isWaste);
  return Result.ok(findings);
} catch (err) {
  return Result.fail(new AwsAdapterError('EBS', err as Error));
} finally {
  client.destroy(); // libera connessioni HTTP
}
```

**Rate limiting — regole di concorrenza coerenti:**
- Coppie (scanner, regione) → worker pool con un unico limite globale (12 scan in-flight di default, qualsiasi mix), accodate scanner-major così il primo batch si spalma sulle regioni — vedi [ADR-0052](../adr/0052-global-scan-worker-pool.md)
- Fan-out interno a uno scanner (es. una chiamata CloudWatch per NAT Gateway) → `mapWithConcurrency` con limite (5)

**Validazione dei campi richiesti:** gli scanner non leggono mai un campo richiesto dalla risposta AWS con una non-null assertion nuda (`v.VolumeId!`). Invece, un tipo intersezione locale più un `.filter()` a restringimento di tipo subito dopo il fetch esclude le entry malformate e logga quante ne sono state scartate (`DEBUG=cloudrift:*`) — vedi [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md).

---

## `CloudWatchIdleScanner` — template method condiviso per gli scanner CloudWatch

**Scelta:** 18 dei 29 scanner estendono la classe astratta `CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity>` (`scanners/cloudwatch-idle.scanner.ts`) invece di scrivere il proprio `scan()`.

**Perché:** questi 18 scanner condividono la stessa forma — creano un client, elencano i candidati, recuperano una metrica CloudWatch per candidato (alcuni risolvono in più un prezzo live per-tipo), mappano a un'entità, applicano la policy, wrappano gli errori, distruggono il client. La base class possiede quel lifecycle; uno scanner concreto implementa solo `createPrimaryClient`/`destroyPrimaryClient`/`listResources`/`fetchMetric`/`toEntity`, più un `resolvePrices` opzionale per i 9 gated da `--live-pricing`. Vedi [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md).

**Non tutti gli scanner ci entrano:** `s3-no-lifecycle` resta standalone — la sua chiamata CloudWatch ha un periodo fisso di 1 giorno indipendente dalla finestra di lookback e una dimensione extra, il che avrebbe forzato il template a piegarsi per un solo outlier. Gli 11 scanner non-CloudWatch (`ebs-volume`, `ebs-snapshot`, `elastic-ip`, `eni-orphaned`, `gp2-upgrade`, `load-balancer`, `log-group`, `rds-instance`, `workspaces-idle`, `ec2-instance`, `s3-no-lifecycle`) mantengono il proprio `scan()`.

---

## STS per l'account ID

**Scelta:** l'account ID viene risolto automaticamente con `sts:GetCallerIdentity` (`resolveAwsAccountId()`); `--account-id` resta come override.

**Perché:** le stesse credenziali della scansione conoscono già l'account; chiedere all'utente di digitarlo era ridondante e soggetto a errori di battitura in report che poi circolano. Se STS non è raggiungibile il tool degrada a `'unknown'` senza fallire.

---

## Waste policy parametriche invece di euristiche hardcoded

**Scelta:** le condizioni di spreco vivono in policy di dominio (`WastePolicy<T>`) con due parametri trasversali esposti dalla CLI: `--min-age-days` (default 7) e `--ignore-tag` (default `cloudrift:ignore`).

**Perché:** un detector di spreco vale quanto il suo tasso di falsi positivi. Le tre classi di falso positivo eliminate:
- risorse appena create/staccate/fermate (grace period)
- risorse intenzionalmente mantenute (tag di esclusione)
- snapshot referenziati da AMI registrate (non cancellabili)

**Trade-off:** il grace period sugli EBS usa `createTime` come proxy della data di detach (AWS non la espone): un volume vecchio staccato ieri viene comunque segnalato. Accettabile: il caso opposto (volume appena creato segnalato come spreco) era molto più dannoso per la fiducia nel report.

**Soglie per-check.** Tre policy — `EbsIdlePolicy`, `Ec2UnderutilizedPolicy` e `RdsUnderutilizedPolicy` — prendono in più una soglia numerica come parametro del costruttore (non un flag CLI trasversale, dato che non ha senso per le altre policy): `ebsIdleMaxOps` (operazioni I/O CloudWatch totali sotto cui un volume attaccato conta come idle, default 0), `ec2CpuPercent` (CPU massima % sotto cui un'istanza EC2 running conta come sottoutilizzata, default 5) e `rdsCpuPercent` (stessa soglia per un'istanza RDS `available`, default 5). Tutte configurabili solo via `config.thresholds`, non un flag CLI dedicato — sono manopole di tuning per check advisory, non qualcosa che ogni invocazione deve passare.

**Spreco vs. ottimizzazione.** Non ogni detector trova spreco cancellabile: `ebs-gp2-upgrade`, `ec2-underutilized` e `rds-underutilized` sono opportunità di risparmio che mantengono la risorsa (`FindingCategory: 'optimization'`), escluse dal totale waste principale e dal gate CI (vedi [architettura.md](./architettura.md#spreco-vs-ottimizzazione--findingcategory)). `ec2-underutilized` e `rds-underutilized` sono inoltre marcate `estimated: true`: la sola CPU non dimostra che anche RAM/rete (EC2) o storage I/O/connessioni (RDS) siano altrettanto inutilizzati.

---

## ts-jest per i test

**Scelta:** `ts-jest` come transformer dei file `.spec.ts`.

**Perché:**
- Esegue i `.spec.ts` senza pre-compilazione
- `diagnostics: false` nel preset disabilita il type-checking durante i test (già garantito dal target `typecheck` separato), rendendoli più veloci
- Integrazione semplice con i `moduleNameMapper` del workspace

**Nota critica:** `ts-node` NON è installato, quindi i config jest devono restare `.cjs`. Convertirli in `.ts` richiederebbe l'aggiunta di `ts-node`.

---

## Result<T, E> — Railway-Oriented Programming

**Scelta:** un tipo `Result` esplicito invece di eccezioni per gli errori attesi — **incluso l'input utente**.

**Perché:**
- Le eccezioni JavaScript non sono tipizzate; con `Result` il chiamante è obbligato dal type system a gestire entrambi i casi
- Composizione semplice: un fallimento si propaga o si raccoglie come valore

**Coerenza del pattern:** `AwsRegion.parse()` restituisce `Result<AwsRegion, InvalidAwsRegionError>` ed è la via usata dalla CLI per validare `-r`. Esiste anche `AwsRegion.create()` (throwing) **solo** per codici noti a compile time, tipicamente fixture di test: l'input esterno non passa mai da lì.

```typescript
const parsed = AwsRegion.parse(code);
if (!parsed.ok) return fail(parsed.error.message); // messaggio pulito, exit 1, nessuno stack trace
```

**Due gerarchie di errore, non una.** `DomainError` (layer dominio) e `InfrastructureError` (layer infrastruttura, es. `AwsAdapterError`) sono gerarchie sorelle, non genitore/figlio: il domain non deve avere un tipo che implica una conoscenza di AWS che non ha. Vedi [ADR-0049](../adr/0049-infrastructureerror-not-domainerror.md).

---

## Zod per il parsing del config

**Scelta:** `cloudrift.config.json` viene validato con un unico schema Zod (`CloudriftConfigSchema.safeParse(obj)`) invece di un parser scritto a mano con `if`/push-errore.

**Perché:** il vecchio parser erano 308 righe di controlli ripetuti campo per campo, corretti ma senza nulla che legasse la loro forma all'interfaccia TypeScript `CloudriftConfig` — i due potevano divergere silenziosamente. Lo schema è dichiarato `satisfies z.ZodType<CloudriftConfig, unknown>`: se schema e interfaccia divergono, il progetto non compila. Vedi [ADR-0048](../adr/0048-zod-config-parsing.md).

**Risultato:** `cloudrift.config.ts` è passato da 308 a 151 righe; tutti i 26 test di config preesistenti (inclusa l'aggregazione di più errori) passano invariati.

---

## Logger di debug minimale

**Scelta:** `createLogger(namespace)` (`libs/shared/kernel/src/logging/logger.ts`) — zero dipendenze, un solo metodo `debug(message, meta?)`, attivato dalla variabile d'ambiente `DEBUG` (`DEBUG=cloudrift:*` wildcard, match esatto, o pattern multipli separati da virgola), scrive su **stderr** così non si mischia mai con il report su stdout.

**Perché:** non Winston, non Pino — sono framework di structured logging per servizi long-running (transport, livelli multipli, pipeline JSON), niente di cui una CLI ha bisogno. Uno switch di debug per-namespace era l'intero requisito: quanto tempo impiega ogni scanner, e perché uno scanner non trova nulla. Vedi [ADR-0047](../adr/0047-minimal-namespaced-debug-logger.md).

---

## Commander.js per la CLI

**Scelta:** `commander` per il parsing degli argomenti.

**Perché:** API dichiarativa, help automatico, `parseAsync` per handler async, leggero.

---

## @clack/prompts per il picker interattivo degli scanner

**Scelta:** `multiselect` di `@clack/prompts` per il wizard di selezione scanner di `analyze` (vedi [ADR-0041](../adr/0041-interactive-scanner-selection-wizard.md), [funzionamento.md](./funzionamento.md#selezione-degli-scanner-il-wizard-e-le-sue-vie-duscita)).

**Perché:** più leggero di `inquirer` e ha un multiselect a checkbox nativo. È un pacchetto solo ESM, quindi viene caricato con un `import()` dinamico dentro `promptScannerSelection()` invece di un import statico — un import statico rompeva `cli:test` (Jest non fa il parse di un pacchetto ESM di default) e avrebbe anche trascinato il renderer del prompt in ogni processo che importa il modulo del comando, anche quelli non interattivi.

**Trigger, non un flag:** il wizard compare di default in un vero terminale, non dietro un flag opt-in `--interactive` — la richiesta era che la selezione degli scanner fosse l'esperienza normale, con vie d'uscita esplicite (`--scanners <kinds...>`, `--all-services`) per l'uso da script, e un default silenzioso a "tutto" ogni volta che `stdout` non è un TTY, `CI=true`, o è impostato `--silent`, così l'automazione non resta mai bloccata in attesa di input.

---

## chalk e cli-table3 per l'output console

**Scelta:** `chalk` per i colori e `cli-table3` per le tabelle.

**Perché:** gestione automatica del supporto colori; tabelle allineate e leggibili. `--format json` (non `--json`, che è un file artifact indipendente da `--format`) sopprime la tabella per non sporcare lo stdout machine-readable; `--silent` la sopprime per le esecuzioni solo-file indipendentemente dal `--format`.

---

## pdfkit per il report PDF

**Scelta:** `pdfkit` per la generazione del PDF con `--pdf`.

**Perché:**
- Libreria Node.js pura: nessun browser headless (~300 MB di Chromium evitati), nessuna dipendenza binaria
- API a basso livello, verbosa ma prevedibile
- Stream-based: scrive su `fs.createWriteStream` senza bufferizzare l'intero PDF

**Gestione overflow:** `drawTable` implementa il salto pagina — quando le righe superano il margine inferiore, chiude il bordo del segmento, apre una nuova pagina e ridisegna l'intestazione. Le celle troppo lunghe vengono troncate con ellissi (`clip()` via `widthOfString`).

---

## Nessun framework di dependency injection

**Scelta:** constructor injection manuale; il composition root è `analyze-waste.composition.ts`, chiamato da `analyze-waste.command.ts` tramite il seam iniettabile `AnalyzeDeps.createAnalysis`.

**Perché:** il grafo è piatto — il composition root istanzia pricing, policy e scanner e li passa al use case; il comando si limita a orchestrare opzioni e output attorno a quella chiamata. Un container DI (InversifyJS, tsyringe) aggiungerebbe configurazione e `emitDecoratorMetadata` senza benefici a questa scala. Il modello a plugin (`WasteScannerPort[]`) rende l'array di scanner l'unico "registro" necessario.

---

## Stima dei costi

I prezzi vivono **solo** in `prices.json` (infrastruttura), con override per-regione e fallback su `default` (us-east-1). Il file dichiara `pricesAsOf` (data di ultima verifica del listino) e ogni report — tabella, PDF e JSON — la espone, insieme al disclaimer che le stime possono differire dalla fattura reale (sconti, reserved pricing, variazioni regionali).

| Risorsa | Prezzo (us-east-1) |
|---|---|
| EBS gp3 / gp2 / io1-io2 | $0.080 / $0.100 / $0.125 per GB-mese |
| EBS st1 / sc1 / standard | $0.045 / $0.018 / $0.050 per GB-mese |
| EBS snapshot | $0.05/GB-mese |
| Elastic IP non associato | $0.005/h ≈ $3.60/mese |
| RDS storage gp2/gp3 | $0.115/GB-mese |
| ALB/NLB (base) | ~$16.20/mese |
| NAT Gateway (base) | ~$32.40/mese |

**Tre livelli di pricing (il payoff del `PricingPort`).** I prezzi si risolvono per `(regione, chiave)` da, in ordine: gli override `prices` dell'utente nel config (tariffe negoziate/aziendali — massima priorità), l'**AWS Pricing API** (`--live-pricing`, `AwsPricingApiAdapter.warmUp` recupera e materializza una tabella), e il `prices.json` built-in (sempre presente). Tutte e tre condividono la stessa forma `PriceTable`, quindi si compongono con un semplice `mergePriceTables`; i getter restano sincroni (il live fa warmUp prima dello scan). Sostituire/aggiungere una fonte non tocca mai gli scanner né il dominio — esattamente ciò che il port garantisce.

Due proprietà di sicurezza: l'adapter live accetta un prezzo **solo se i filtri risolvono un valore unico** (ambiguo → fallback allo statico, mai un prezzo indovinato sbagliato), e anche i prezzi live sono prezzi di **listino** AWS, non la bolletta reale (Savings Plans / RI / EDP) — gli override `prices` sono l'unico modo per encodare le tariffe vere. `getPricesAsOf()` riflette quale livello è stato usato.

**Manutenzione:** aggiornare il fallback statico = aggiornare `prices.json` **e** il suo campo `pricesAsOf`.

**L'unica eccezione: pricing EC2 per instance type.** `AwsEc2UnderutilizedScanner` non rientra nel modello a tre livelli descritto sopra: la cardinalità degli instance type EC2 è troppo alta per stare in `prices.json` o per essere pre-caricata in `warmUp()`. Chiama invece direttamente `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)`, on demand, per ogni instance type distinto osservato nello scan. La conseguenza è voluta, non una svista: senza `--live-pricing` non c'è alcuna fonte di prezzo per questo check, quindi il composition root semplicemente non registra lo scanner, invece di riportare una stima di risparmio a zero.
