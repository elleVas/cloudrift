# Scelte Tecniche

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

**Scelta:** client modulari `@aws-sdk/client-ec2`, `client-rds`, `client-elastic-load-balancing-v2`, `client-cloudwatch`, `client-sts`.

**Perché:**
- Modulare: si importa solo il client necessario
- Client per-regione: ogni scanner crea un client con `{ region: region.code }` e lo distrugge nel `finally`
- Tipizzazione migliore e supporto nativo a ESM

**Pattern usato negli scanner:**
```typescript
const client = new EC2Client({ region: region.code });
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
- Scanner diversi (API diverse) → in parallelo
- Stesso scanner su più regioni → in sequenza
- Fan-out interno a uno scanner (es. una chiamata CloudWatch per NAT Gateway) → `mapWithConcurrency` con limite (5)

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

---

## Commander.js per la CLI

**Scelta:** `commander` per il parsing degli argomenti.

**Perché:** API dichiarativa, help automatico, `parseAsync` per handler async, leggero.

---

## chalk e cli-table3 per l'output console

**Scelta:** `chalk` per i colori e `cli-table3` per le tabelle.

**Perché:** gestione automatica del supporto colori; tabelle allineate e leggibili. Con `--json` senza filename l'output tabellare viene soppresso per non sporcare lo stdout machine-readable.

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

**Scelta:** constructor injection manuale; il composition root è `analyze-waste.command.ts`.

**Perché:** il grafo è piatto — la CLI istanzia pricing, policy e scanner e li passa al use case. Un container DI (InversifyJS, tsyringe) aggiungerebbe configurazione e `emitDecoratorMetadata` senza benefici a questa scala. Il modello a plugin (`WasteScannerPort[]`) rende l'array di scanner l'unico "registro" necessario.

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

**Manutenzione:** aggiornare i prezzi = aggiornare `prices.json` **e** il campo `pricesAsOf`. Un'evoluzione naturale è un adapter sull'AWS Pricing API con fallback sul listino statico: il `PricingPort` lo consente senza toccare scanner o domain.
