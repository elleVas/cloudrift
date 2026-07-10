// Genera apps/cli/dist/package.json per la pubblicazione npm.
//
// La CLI è bundlata (esbuild bundle:true): le lib del workspace sono già
// inlinate in main.js, mentre i pacchetti di terze parti restano `require()`
// esterni. Il manifest di pubblicazione deve quindi dichiarare SOLO quei
// pacchetti esterni — non le dipendenze workspace:* del manifest di sviluppo.
//
// Gli esterni vengono ricavati dal bundle reale (i `require("...")`), così lo
// script si auto-mantiene se in futuro si aggiungono nuovi SDK.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const workspaceRoot = resolve(appDir, '..', '..');
const distDir = resolve(appDir, 'dist');

const appPkg = readJson(resolve(appDir, 'package.json'));
const rootPkg = readJson(resolve(workspaceRoot, 'package.json'));
const bundle = readFileSync(resolve(distDir, 'main.js'), 'utf8');

// 1. Estrai i nomi dei pacchetti esterni dai require() del bundle.
const externals = new Set();
for (const match of bundle.matchAll(/require\(["']([^"']+)["']\)/g)) {
  const spec = match[1];
  if (spec.startsWith('.') || spec.startsWith('/') || isBuiltin(spec)) continue;
  externals.add(packageNameOf(spec));
}

// 2. Risolvi la versione di ciascun esterno (app → root → versione installata).
const dependencies = {};
for (const name of [...externals].sort()) {
  dependencies[name] = resolveVersion(name);
}

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

function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function resolveVersion(name) {
  const fromApp = appPkg.dependencies?.[name];
  if (fromApp && !fromApp.startsWith('workspace:')) return fromApp;

  const fromRoot = rootPkg.dependencies?.[name] ?? rootPkg.devDependencies?.[name];
  if (fromRoot) return fromRoot;

  try {
    const installed = readJson(resolve(workspaceRoot, 'node_modules', name, 'package.json'));
    return `^${installed.version}`;
  } catch {
    throw new Error(
      `Cannot resolve a version for external dependency "${name}". ` +
        `Add it to the root or apps/cli package.json.`,
    );
  }
}
