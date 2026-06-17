# Rilascio di `@cloudrift/cli`

> 🇬🇧 [English version](../en/releasing.md)

Questo documento descrive come il pacchetto npm viene buildato e pubblicato. È pensato per i manutentori — agli utenti basta il [README](../../README.md#installazione).

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
   git tag v0.3.0          # deve essere uguale alla versione di @cloudrift/cli
   git push origin v0.3.0
   ```

Il [workflow di release](../../.github/workflows/release.yml), sul tag `v*`:

1. verifica che il tag combaci con la versione del pacchetto,
2. esegue lint + test sul workspace,
3. `pnpm nx package cli` (build + generazione di `dist/package.json`),
4. `npm publish --provenance` da `apps/cli/dist` (usando `NPM_TOKEN`),
5. crea una GitHub Release con note generate automaticamente.

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

Il pacchetto punta a **Node 18+** (`engines`). Il bundle è CommonJS, quindi ogni dipendenza esterna deve essere `require()`-abile: per questo `chalk` è fissato a **v4** (la v5 è solo-ESM e lancerebbe `ERR_REQUIRE_ESM` su Node < 22).
