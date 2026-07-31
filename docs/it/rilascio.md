# Rilascio di `@cloudrift/cli`

> 🇬🇧 [English version](../en/releasing.md)

Questo documento descrive come il pacchetto npm viene buildato e pubblicato. È pensato per i manutentori — agli utenti basta il [Leggimi](leggimi.md#guida-rapida).

## Cosa viene pubblicato

La CLI è pubblicata su npm come **`@cloudrift/cli`** (il comando installato è `cloudrift`). Il pacchetto è **bundlato**: esbuild inlina le librerie del workspace (`shared-kernel`, `cloud-cost-*`) in un unico `main.js`, mentre i pacchetti di terze parti (AWS SDK, pdfkit, chalk, commander, cli-table3) restano esterni. Il tarball pubblicato contiene quindi solo:

```
main.js          # la CLI bundlata ed eseguibile (con lo shebang #!/usr/bin/env node)
package.json     # generato: dichiara solo le dipendenze runtime di terze parti
README.md
LICENSE.md
```

`apps/cli/package.json` è il manifest di **sviluppo** (dipendenze workspace, target nx, metadati npm). Il manifest **pubblicato** viene generato in `apps/cli/dist/package.json` da `apps/cli/scripts/make-dist-package.mjs`, che ricava i `require()` esterni reali dal bundle — così si auto-mantiene quando si aggiungono nuovi SDK.

## Setup una tantum

1. Crea l'**org `@cloudrift`** su npm (lo scope deve esistere e devi possederlo).
2. Genera un **automation token** npm e aggiungilo come secret del repo GitHub con nome **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).

Il workflow di release usa `--provenance`, che richiede `id-token: write` (già impostato in [`release.yml`](../../.github/workflows/release.yml)) e un repository pubblico.

## Pubblicare una release

1. Aggiorna la versione in `apps/cli/package.json` — `apps/cli/src/cli-version.ts` la re-esporta in fase di build (`require('../package.json').version`), quindi l'output di `--version` in `main.ts` combacia sempre senza dover modificare un secondo file.
2. Mergia su `main`.
3. Crea il tag e pusha:

   ```sh
   git tag v0.5.0          # deve essere uguale alla versione di @cloudrift/cli
   git push origin v0.5.0
   ```

Il [workflow di release](../../.github/workflows/release.yml), sul tag `v*`:

1. verifica che il tag combaci con la versione del pacchetto,
2. esegue lint + test sul workspace,
3. `pnpm nx package cli` (build + generazione di `dist/package.json`),
4. genera un SBOM CycloneDX e uno SPDX via `npm sbom` (eseguito da `apps/cli/dist`, così riflette solo le dipendenze runtime del tarball pubblicato, non `nx`/`eslint`/ecc. del monorepo — `npm sbom` legge l'albero delle dipendenze installate, non solo `package.json`, quindi questo step lancia prima un `npm install` semplice in `apps/cli/dist`; innocuo, dato che `npm publish` non include mai `node_modules` indipendentemente da cosa c'è su disco),
5. `npm publish --provenance` da `apps/cli/dist` (usando `NPM_TOKEN`),
6. crea una GitHub Release con note generate automaticamente e allega entrambi i file SBOM.

## Verifica in locale prima del tag

```sh
pnpm nx package cli                      # build + genera apps/cli/dist/package.json
cd apps/cli/dist && npm pack --dry-run   # ispeziona il contenuto esatto del tarball
```

Per uno smoke test end-to-end dell'artefatto pubblicato:

```sh
cd apps/cli/dist
npm pack                                 # produce cloudrift-cli-<versione>.tgz
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install /percorso/assoluto/cloudrift-cli-<versione>.tgz
npx cloudrift --version                  # deve stampare la nuova versione
```

## Compatibilità Node

Il pacchetto punta a **Node 20+** (`engines`). Il bundle è CommonJS, quindi ogni dipendenza esterna deve essere `require()`-abile: per questo `chalk` è fissato a **v4** (la v5 è solo-ESM e lancerebbe `ERR_REQUIRE_ESM` su Node < 22). La CI builda/pubblica solo su Node 24.x — il floor `>=20` è un minimo dichiarato, non verificato da un job CI dedicato; da alzare (o affiancare con un job di test su Node 20) se questo gap dovesse mai contare.

## GitHub Action

[`action.yml`](../../action.yml) nella root del repo è un'azione composita che installa `@cloudrift/cli` da npm ed esegue `cloudrift analyze`, quindi `uses: elleVas/cloudrift@v<versione>` funziona una volta che la versione referenziata è pubblicata su npm. Dopo un rilascio, verificala con un run `workflow_dispatch` in un workflow usa-e-getta prima di puntarci consumer reali — oggi nessuna CI esercita `action.yml`.

## Homebrew

Il tap vive in un repository **separato**, `elleVas/homebrew-cloudrift` (convenzione di naming di Homebrew — una formula non può vivere in questo repo ed essere installabile via `brew install elleVas/cloudrift/cloudrift`). La formula usa il pattern npm-install `Language::Node` di Homebrew: `depends_on "node"`, `def install; system "npm", "install", *std_npm_args; bin.install_symlink Dir["#{libexec}/bin/*"]; end` (lo step di symlink è necessario — `std_npm_args` da solo installa in `libexec` ma non collega il binario in `bin`), `url` che punta al tarball npm pubblicato (`https://registry.npmjs.org/@cloudrift/cli/-/cli-<versione>.tgz`) con il suo `sha256`. In più la formula porta un blocco `bottle do ... end` (vedi sotto), quindi un semplice `brew install cloudrift` scarica una bottle precompilata invece di eseguire `npm install`/richiedere gli Xcode Command Line Tools sulla macchina dell'utente.

**Il tap viene aggiornato automaticamente, in tre fasi, tutte dentro `release.yml`:**

1. **job `publish`** — dopo `npm publish`, esegue `scripts/bump-homebrew-formula.mjs`, che scarica il tarball npm appena pubblicato (ritentando per qualche minuto se il registry non l'ha ancora propagato — vedi nota sotto), ne calcola lo `sha256` e scrive una `Formula/cloudrift.rb` "nuda" (url/sha256/versione, ancora senza blocco bottle) come artifact. Se la formula nuda è identica a quella già su `main` del tap (es. un rerun dello stesso tag), la pipeline si ferma qui — nessuna bottle viene buildata inutilmente.
2. **job `build-bottles`** — una matrice `macos-14` (arm64) e `ubuntu-latest` (Linux/Linuxbrew), una per piattaforma bottle. Deliberatamente **nessuna leg Intel (`macos-13`)**: cloudrift non ha dipendenze native/compilate (puro Node, `node:sqlite` per il trend store), quindi un Mac Intel senza bottle fa semplicemente il fallback al normale percorso "install da sorgente" di Homebrew — lo stesso `npm install` che la formula esegue già, solo in locale. I runner `macos-13` sono il pool GitHub-hosted più scarso e sono stati osservati in coda a lungo; non c'è nessun vantaggio a costruire una bottle per un fallback che funziona già. Gli step condivisi di ogni leg vivono in `.github/actions/build-homebrew-bottle` (un'azione composita) e: tappano localmente la formula nuda (`brew tap elleVas/cloudrift "$PWD"` + `brew trust ellevas/cloudrift` — sui runner Linux Homebrew viene installato prima, dato che solo le immagini macOS lo includono già), eseguono `brew install --formula --build-bottle cloudrift`, poi `brew bottle --json --root-url=.../releases/download/cloudrift-<versione> cloudrift` e caricano il `.bottle.tar.gz`/`.bottle.json` risultante.
3. **job `publish-bottles`** — scarica entrambi gli artifact bottle, esegue `brew bottle --merge --write --no-commit *.bottle.json` per unire le righe `sha256` delle due piattaforme in un unico blocco `bottle do`, pubblica i tarball come asset di una GitHub Release `cloudrift-<versione>` **nel repo del tap** (il `root_url` del blocco bottle), poi pusha la formula completa di bottle su un branch, apre una PR e abilita l'auto-merge.

**Due step non ovvi esistono solo per aggirare come si comporta `brew tap` contro un path locale** — saltarne uno qualsiasi spedisce in silenzio una bottle rotta o vecchia:
- **Commit locale della formula sovrascritta prima del tap** (mai pushato — solo un `git commit` locale). `brew tap NAME "$PWD"` esegue un vero `git clone` del checkout, che vede solo la storia **committata**. Senza questo, sia `build-bottles` che `publish-bottles` clonerebbero in silenzio la formula della release *precedente* del tap invece di quella in pubblicazione — confermato in produzione: una bottle costruita così riportava `pkg_version` una release indietro rispetto al tag che dichiarava.
- **Copiare indietro la formula bottled dal clone reale del tap di brew.** `brew bottle --merge --write` modifica la formula dentro `$(brew --repository elleVas/cloudrift)` — una directory separata sotto `Library/Taps` di Homebrew, non il checkout del job stesso. Senza copiarla indietro nel checkout prima di `git add`/commit/push, la PR porta sempre e solo la formula nuda (senza bottle). È esattamente quello che è successo al primo run reale (v0.8.0): la formula mergiata sul tap è finita **senza nessun blocco bottle**, in silenzio, nonostante la pipeline segnalasse successo.

La CI del tap stesso (`.github/workflows/test-formula.yml`) esegue poi `brew audit --strict --online` + `brew install --build-from-source` + `brew test` sulla PR (deliberatamente ancora un'installazione da sorgente — è un check di correttezza della formula, non un test del percorso bottle); la branch protection su `main` del tap richiede quel check verde prima di poter mergiare. Quindi un solo `git push --tags` qui pubblica sia su npm sia su Homebrew (con bottle per arm64 + Linux), con il lato Homebrew condizionato sia a un `brew install` reale da sorgente sia a entrambe le build bottle riuscite.

**Non ancora verificato contro una release reale** — i due fix sopra (2026-07-31) sono stati validati riproducendo in locale il comportamento di `brew tap`/clone contro un tap sintetico, non da un vero push di tag. La prossima release taggata è il vero test: verificare che la PR sul tap porti un blocco `bottle do` genuino, e che i metadati `pkg_version`/`tap_git_revision` della bottle combacino col tag, non con la release precedente — un run verde da solo non lo dimostra (vedi le note del progetto [Homebrew tap automation]).

### Setup una tantum (già fatto per il tap attuale, tenuto qui come riferimento)

- Il repo del tap stesso: `gh repo create elleVas/homebrew-cloudrift --public`, `Formula/cloudrift.rb` + `test-formula.yml` scaffoldati, `allow_auto_merge` abilitato, branch protection su `main` che richiede il check `audit`.
- **`HOMEBREW_TAP_TOKEN`**: un PAT GitHub fine-grained con scope limitato a `elleVas/homebrew-cloudrift`, permessi **Contents: Read & write** e **Pull requests: Read & write**, aggiunto come secret con nome `HOMEBREW_TAP_TOKEN` su **questo** repo (`elleVas/cloudrift` → Settings → Secrets and variables → Actions). Senza, lo step "Generate bare Homebrew formula" logga un warning e salta — non fa mai fallire la release npm. Gli stessi permessi coprono anche la creazione della Release bottle e il push del branch della PR finale, nessuno scope aggiuntivo necessario.

### Propagazione del registry

npm può impiegare qualche minuto a rendere fetchabile un tarball appena pubblicato (fino a ~6 minuti osservati al primo rilascio pubblico) — `bump-homebrew-formula.mjs` ritenta ogni 30s per un massimo di ~10 minuti prima di arrendersi, quindi normalmente questo è invisibile.
