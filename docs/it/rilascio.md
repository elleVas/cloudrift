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

1. Aggiorna la versione in `apps/cli/package.json` **e** la stringa `.version(...)` in `apps/cli/src/main.ts` (devono combaciare; altrimenti il workflow fallisce).
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

## Homebrew (dopo il primo publish npm)

Nessun tap Homebrew esiste ancora. Documentato in anticipo così la Fase B non riparte da zero, ma nulla di questo è ancora costruito o automatizzato:

1. La convenzione di naming dei tap Homebrew richiede un repository GitHub **separato** chiamato `homebrew-cloudrift` (es. `elleVas/homebrew-cloudrift`) — una formula non può vivere in questo repo ed essere installabile via `brew install elleVas/cloudrift/cloudrift`.
2. La formula dovrebbe usare il pattern npm-install di `Language::Node` di Homebrew (l'approccio standard per CLI pubblicate su npm — nessun build separato, `depends_on "node"`, `def install; system "npm", "install", *std_npm_args; end`), puntando `url` al tarball npm pubblicato (`https://registry.npmjs.org/@cloudrift/cli/-/cli-<versione>.tgz`) con il suo `sha256`. Il tarball esiste — e il suo checksum è calcolabile — solo dopo che la versione corrispondente è effettivamente su npm.
3. Ogni rilascio successivo al primo richiede di aggiornare `url`/`sha256`/`version` della formula nel tap — a mano o con un piccolo script di follow-up; non ancora costruito.
4. Valida in locale con `brew audit --strict cloudrift` e `brew test cloudrift` prima di pubblicare modifiche al tap.
