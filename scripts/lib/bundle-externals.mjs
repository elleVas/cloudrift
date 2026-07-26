// Helper condiviso tra gli script "make-*-package.mjs" (apps/cli e i pacchetti
// pubblicati esternamente da libs/shared): estrae dal bundle esbuild reale i
// pacchetti di terze parti rimasti esterni (thirdParty: false) e ne risolve
// la versione, così i manifest di pubblicazione non vanno tenuti a mano.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isBuiltin } from 'node:module';

// Un bundle esterno puo' referenziare un pacchetto in due forme letterali,
// a seconda del format di output: CJS/dynamic import usano una call
// `require("spec")`/`import("spec")`, ESM statico usa `from "spec"` (sia
// `import` che `export ... from`). Serve intercettare entrambe.
const EXTERNAL_SPEC_PATTERN = /\b(?:require|import)\(["']([^"']+)["']\)|(?:^|\s)from\s+["']([^"']+)["']/g;

export function extractExternals(bundleSource) {
  const externals = new Set();
  for (const match of bundleSource.matchAll(EXTERNAL_SPEC_PATTERN)) {
    const spec = match[1] ?? match[2];
    if (spec.startsWith('.') || spec.startsWith('/') || isBuiltin(spec)) continue;
    externals.add(packageNameOf(spec));
  }
  return [...externals].sort();
}

export function resolveExternalVersions(externals, { pkg, rootPkg, workspaceRoot }) {
  const dependencies = {};
  for (const name of externals) {
    dependencies[name] = resolveVersion(name, { pkg, rootPkg, workspaceRoot });
  }
  return dependencies;
}

function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function resolveVersion(name, { pkg, rootPkg, workspaceRoot }) {
  const fromPkg = pkg.dependencies?.[name];
  if (fromPkg && !fromPkg.startsWith('workspace:')) return fromPkg;

  const fromRoot = rootPkg.dependencies?.[name] ?? rootPkg.devDependencies?.[name];
  if (fromRoot) return fromRoot;

  try {
    const installed = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'node_modules', name, 'package.json'), 'utf8'),
    );
    return `^${installed.version}`;
  } catch {
    throw new Error(
      `Cannot resolve a version for external dependency "${name}". ` +
        `Add it to the root or the package's own package.json.`,
    );
  }
}
