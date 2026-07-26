// Genera apps/cli/dist/package.json per la pubblicazione npm.
//
// La CLI è bundlata (esbuild bundle:true): le lib del workspace sono già
// inlinate in main.js, mentre i pacchetti di terze parti restano esterni —
// sia `require("...")` (import statici) sia `import("...")` (dynamic import,
// usato per @clack/prompts e pdfkit per differirne il costo di init). Il
// manifest di pubblicazione deve quindi dichiarare SOLO quei pacchetti
// esterni — non le dipendenze workspace:* del manifest di sviluppo.
//
// Gli esterni vengono ricavati dal bundle reale (require/import letterali),
// così lo script si auto-mantiene se in futuro si aggiungono nuovi SDK o
// nuovi dynamic import.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExternals, resolveExternalVersions } from '../../../scripts/lib/bundle-externals.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const workspaceRoot = resolve(appDir, '..', '..');
const distDir = resolve(appDir, 'dist');

const appPkg = readJson(resolve(appDir, 'package.json'));
const rootPkg = readJson(resolve(workspaceRoot, 'package.json'));
const bundle = readFileSync(resolve(distDir, 'main.js'), 'utf8');

// 1. Estrai i nomi dei pacchetti esterni dai require()/import() letterali del
// bundle — entrambe le forme restano esterne (thirdParty: false), e serve
// prenderle entrambe: un pacchetto caricato solo via dynamic import()
// (@clack/prompts, pdfkit) non produce mai un require(...) nel bundle.
const externals = extractExternals(bundle);

// 2. Risolvi la versione di ciascun esterno (app → root → versione installata).
const dependencies = resolveExternalVersions(externals, { pkg: appPkg, rootPkg, workspaceRoot });

// 3. Comporre il manifest di pubblicazione dai metadati del manifest di sviluppo.
const publishManifest = {
  name: appPkg.name,
  version: appPkg.version,
  description: appPkg.description,
  keywords: appPkg.keywords,
  license: appPkg.license,
  homepage: appPkg.homepage,
  repository: appPkg.repository,
  bugs: appPkg.bugs,
  engines: appPkg.engines,
  type: 'commonjs',
  main: './main.js',
  bin: appPkg.bin,
  files: appPkg.files,
  publishConfig: appPkg.publishConfig,
  dependencies,
};

writeFileSync(
  resolve(distDir, 'package.json'),
  JSON.stringify(publishManifest, null, 2) + '\n',
);

console.log(`Wrote ${appPkg.name}@${appPkg.version} dist/package.json with ${Object.keys(dependencies).length} runtime dependencies:`);
for (const [name, version] of Object.entries(dependencies)) {
  console.log(`  ${name}@${version}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
