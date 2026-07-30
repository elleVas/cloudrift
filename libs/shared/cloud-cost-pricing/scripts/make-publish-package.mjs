// Genera libs/shared/cloud-cost-pricing/dist-pkg/package.json per la
// pubblicazione su GitHub Packages, ad uso di repo privati esterni (es. il
// modulo drift-detector Terraform) che non fanno parte di questo workspace
// pnpm/Nx. Stesso meccanismo di libs/shared/aws-infra-utils (ADR-0085).
//
// Il pacchetto interno (libs/shared/cloud-cost-pricing/package.json) resta
// "private" e con nome non-scoped ("cloud-cost-pricing") esattamente com'era:
// questo script non lo tocca, produce solo un manifest di pubblicazione
// parallelo con un nome diverso (scoped, richiesto da GitHub Packages) a
// partire dal bundle esbuild (bundle:true, thirdParty:false — le lib del
// workspace come shared-kernel sono già inlinate in index.js).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExternals, resolveExternalVersions } from '../../../../scripts/lib/bundle-externals.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(scriptDir, '..');
const workspaceRoot = resolve(libDir, '..', '..', '..');
const distDir = resolve(libDir, 'dist-pkg');

const libPkg = readJson(resolve(libDir, 'package.json'));
const rootPkg = readJson(resolve(workspaceRoot, 'package.json'));
const bundle = readFileSync(resolve(distDir, 'index.js'), 'utf8');

const externals = extractExternals(bundle);
const dependencies = resolveExternalVersions(externals, { pkg: libPkg, rootPkg, workspaceRoot });

const publishManifest = {
  name: '@ellevas/cloud-cost-pricing',
  version: libPkg.version,
  license: rootPkg.license,
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  publishConfig: {
    registry: 'https://npm.pkg.github.com',
  },
  dependencies,
};

writeFileSync(
  resolve(distDir, 'package.json'),
  JSON.stringify(publishManifest, null, 2) + '\n',
);

// npm risolve il progetto dalla directory corrente: quando si pubblica da
// dentro dist-pkg/ (che ha un proprio package.json), l'.npmrc della root del
// workspace non viene letto. Serve una copia locale con lo stesso auth
// token via env var, altrimenti `npm publish` da qui fallisce con 401.
writeFileSync(
  resolve(distDir, '.npmrc'),
  '//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_CLOUDRIFT_TOKEN}\n',
);

console.log(`Wrote ${publishManifest.name}@${publishManifest.version} dist-pkg/package.json with ${Object.keys(dependencies).length} runtime dependencies:`);
for (const [name, version] of Object.entries(dependencies)) {
  console.log(`  ${name}@${version}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
