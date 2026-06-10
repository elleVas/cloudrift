# Scelte Tecniche

Questo documento spiega il perché di ogni scelta tecnologica nel progetto, con i trade-off considerati.

---

## Nx Monorepo

**Scelta:** gestire tutto il codice in un unico repository Nx con workspace pnpm.

**Perché:**
- Permette di condividere `shared-kernel` tra tutti i bounded context senza pubblicarlo su npm
- I target Nx (`build`, `test`, `typecheck`) vengono eseguiti solo sui progetti che sono stati modificati (`nx affected`)
- Il caching locale (e opzionalmente su Nx Cloud) evita di rieseguire operazioni costose
- I `moduleNameMapper` nei jest config permettono di importare le sorgenti TypeScript direttamente, senza dover buildare le dipendenze prima di testare

**Trade-off:** la complessità di configurazione iniziale di Nx è più alta rispetto a un singolo progetto, ma ripaga subito appena si hanno più di due librerie da orchestrare.

---

## pnpm come package manager

**Scelta:** pnpm invece di npm o yarn.

**Perché:**
- Usa hard link invece di copiare i pacchetti: installazione più veloce e meno spazio su disco
- Il `pnpm-workspace.yaml` definisce esplicitamente quali cartelle sono pacchetti del workspace (fondamentale per il funzionamento dei link `workspace:*`)
- Le dipendenze tra librerie interne usano `"cloud-cost-domain": "workspace:*"`, che pnpm risolve con link simbolici al codice sorgente

---

## TypeScript con `module: ESNext` e `moduleResolution: bundler`

**Scelta:** usare `"module": "ESNext"` e `"moduleResolution": "bundler"` nel `tsconfig.base.json`.

**Perché:**
- `moduleResolution: bundler` è la modalità raccomandata da TypeScript quando si usa un bundler (esbuild in questo caso): permette import senza estensione esplicita (`import { Entity } from './entity.base'` invece di `'./entity.base.js'`)
- Mantiene la compatibilità con esbuild che gestisce la risoluzione dei moduli autonomamente
- Le import cross-package usano il nome del pacchetto (`import x from 'shared-kernel'`); le import intra-package usano path relativi senza estensione

**Conseguenza tecnica:** i `tsconfig.spec.json` usano `"module": "CommonJS"` e `"moduleResolution": "Node"` perché jest gira in ambiente CJS — questo override locale è separato dalla configurazione di produzione e non richiede modifiche. I file di configurazione jest sono `jest.config.cjs` con `module.exports = {}` per la stessa ragione.

**Nota:** la condizione TypeScript personalizzata `@cloudrift/source` nel campo `exports` dei `package.json` delle librerie permette a TypeScript (in modalità `bundler`) di risolvere gli import al sorgente `.ts` durante sviluppo e test, saltando la cartella `dist/`.

---

## AWS SDK v3

**Scelta:** `@aws-sdk/client-ec2`, `@aws-sdk/client-rds`, `@aws-sdk/client-elastic-load-balancing-v2` invece di AWS SDK v2.

**Perché:**
- L'SDK v3 è modulare: si importa solo il client necessario, riducendo il bundle size
- Client specifici per regione: ogni adapter crea un client passando `{ region: region.code }` e lo distrugge nel `finally`
- Tipizzazione migliore e supporto nativo a ESM

**Pattern usato negli adapter:**
```typescript
const client = new EC2Client({ region: region.code });
try {
  const response = await client.send(new DescribeVolumesCommand({ ... }));
  // mapping
} catch (err) {
  return Result.fail(new AwsAdapterError('EBS', err as Error));
} finally {
  client.destroy(); // libera connessioni HTTP
}
```

---

## ts-jest per i test

**Scelta:** `ts-jest` con `@swc/core` come compilatore per i test.

**Perché:**
- `ts-jest` permette di eseguire i file `.spec.ts` senza pre-compilarli
- La configurazione `diagnostics: false` nel preset disabilita il type-checking durante i test (già garantito da `typecheck` separato), rendendo i test più veloci
- Il `tsconfig.spec.json` usa `"module": "CommonJS"` perché jest gira in ambiente CJS

**Perché non `@swc/jest` direttamente?** `ts-jest` offre un'integrazione più semplice con i `moduleNameMapper` e i path personalizzati usati in questo progetto.

**Nota critica:** `ts-node` NON è installato. Jest non può quindi caricare i file `jest.config.ts`. Per questo i config jest sono `.cjs`. Se si convertissero in `.ts`, bisognerebbe installare `ts-node`.

---

## Result<T, E> — Railway-Oriented Programming

**Scelta:** usare un tipo `Result` esplicito invece di eccezioni per gli errori attesi.

**Perché:**
- Le eccezioni JavaScript non hanno tipizzazione: non si sa staticamente cosa può lanciare una funzione
- Con `Result`, il chiamante è **obbligato** dal type system a gestire entrambi i casi (`ok` e `fail`)
- Il codice di gestione degli errori è inline e leggibile, non disperso in `try/catch` annidati
- Facilita la composizione: un use case che riceve un `Result.fail` può semplicemente restituirlo senza wrapparlo

**Esempio:**
```typescript
const result = await this.ebsRepository.findUnattachedVolumes(region);
if (!result.ok) return result; // propaga l'errore senza wrappare
allVolumes.push(...result.value); // TypeScript sa che value è definito
```

---

## Commander.js per la CLI

**Scelta:** `commander` per il parsing degli argomenti.

**Perché:**
- API dichiarativa e semplice per definire comandi, opzioni e help automatico
- Supporto nativo a `parseAsync` per gestire async/await nei command handler
- Sufficientemente leggero per uno strumento CLI

---

## chalk e cli-table3 per l'output console

**Scelta:** `chalk` per i colori e `cli-table3` per le tabelle nel terminale.

**Perché:**
- `chalk` gestisce automaticamente il supporto ai colori (disabilita i colori se il terminale non li supporta)
- `cli-table3` genera tabelle allineate con intestazioni colorate, rendendo leggibili report con molte colonne

---

## pdfkit per il report PDF

**Scelta:** `pdfkit` per la generazione del PDF con `--pdf`.

**Perché:**
- Libreria Node.js pura: nessun browser headless, nessun processo figlio, nessuna dipendenza binaria — funziona ovunque giri Node.js
- API imperativa a basso livello (`rect`, `text`, `moveTo`/`lineTo`): verbosa ma prevedibile, permette controllo preciso del layout senza HTML/CSS intermedi
- Stream-based: scrive direttamente su `fs.createWriteStream`, senza bufferizzare l'intero PDF in memoria

**Alternativa scartata — puppeteer/playwright:** convertirebbe HTML in PDF (layout più semplice da scrivere), ma richiederebbe un browser Chromium (~300 MB), incompatibile con un tool CLI leggero.

**Trade-off noto:** le tabelle pdfkit sono disegnate a mano con primitive grafiche. Se le righe overflow la pagina, il testo viene tagliato — attualmente non gestito (limite accettabile per il numero di risorse tipiche in un account). Se il numero di risorse per tipo supera una pagina, si dovrà aggiungere la gestione del salto pagina nel loop di `drawTable`.

---

## Nessun framework di dependency injection

**Scelta:** dependency injection manuale (constructor injection) invece di un container DI come `InversifyJS` o `tsyringe`.

**Perché:**
- Il grafo di dipendenze è semplice: la CLI istanzia gli adapter e li passa al use case
- Un container DI aggiungerebbe configurazione e complessità senza benefici concreti a questa scala
- I decorator di `tsyringe`/`InversifyJS` richiedono `emitDecoratorMetadata` che complica la toolchain

---

## Stima dei costi

Le stime mensili sono calcolate sulle tariffe AWS ufficiali (regione `us-east-1`, valide a giugno 2026):

| Risorsa | Prezzo |
|---|---|
| EBS gp3 | $0.08/GB-month |
| EBS gp2 | $0.10/GB-month |
| EBS io1/io2 | $0.125/GB-month |
| Elastic IP non associato | $0.005/hr = $3.60/month |
| RDS storage gp2/gp3 | $0.115/GB-month |
| ALB/NLB (base) | $0.0225/hr = ~$16.20/month |

I prezzi variano per regione. Le stime sono orientative e possono differire dalla fattura AWS effettiva per via di sconti, reserved pricing e variazioni regionali.
