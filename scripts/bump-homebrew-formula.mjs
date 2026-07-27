// Genera Formula/cloudrift.rb per il tap elleVas/homebrew-cloudrift a partire
// dal tarball npm appena pubblicato di @cloudrift/cli.
//
// Il registry npm può impiegare qualche minuto a propagare un pacchetto
// appena pubblicato (~6 minuti osservati al primo rilascio pubblico, vedi
// docs/en/releasing.md) — per questo il download del tarball ha un retry
// con backoff fisso invece di fallire al primo tentativo.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@cloudrift/cli';
const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 20; // ~10 minuti di margine per la propagazione del registry

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, '..');

const [, , versionArg, outputPathArg] = process.argv;
const outputPath = outputPathArg;
if (!outputPath) {
  console.error('Usage: bump-homebrew-formula.mjs <version> <output-formula-path>');
  process.exit(1);
}
const version = versionArg || readWorkspaceVersion();

const tarballUrl = `https://registry.npmjs.org/${PACKAGE_NAME}/-/cli-${version}.tgz`;
const sha256 = await sha256OfTarball(tarballUrl);

writeFileSync(outputPath, renderFormula({ version, tarballUrl, sha256 }));
console.log(`Wrote formula for cloudrift@${version} (sha256 ${sha256}) to ${outputPath}`);

function readWorkspaceVersion() {
  const pkg = JSON.parse(readFileSync(resolve(workspaceRoot, 'apps/cli/package.json'), 'utf8'));
  return pkg.version;
}

async function sha256OfTarball(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return createHash('sha256').update(buffer).digest('hex');
    }
    console.log(
      `Attempt ${attempt}/${MAX_ATTEMPTS}: tarball not ready yet (HTTP ${response.status}), retrying in ${RETRY_DELAY_MS / 1000}s...`,
    );
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error(`Tarball never became available at ${url} after ${MAX_ATTEMPTS} attempts`);
}

function renderFormula({ version, tarballUrl, sha256 }) {
  return `class Cloudrift < Formula
  desc "Local-only AWS cost & security scanner"
  homepage "https://github.com/elleVas/cloudrift"
  url "${tarballUrl}"
  sha256 "${sha256}"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
  end

  test do
    assert_match "${version}", shell_output("#{bin}/cloudrift --version")
  end
end
`;
}
