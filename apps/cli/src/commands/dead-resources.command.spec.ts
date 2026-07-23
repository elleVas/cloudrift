// SPDX-License-Identifier: Apache-2.0
import { readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Result } from 'shared-kernel';
import { AwsRegion, Ec2KeyPairUnused } from 'dead-resources-domain';
import type { DeadResourcesSummary, FindDeadResourcesUseCasePort } from 'dead-resources-domain';
import { deadResourcesCommand, type DeadResourcesCommandOptions } from './dead-resources.command';
import type { DeadResourcesDeps, DeadResourceAnalysisContext } from './dead-resources.composition';

const region = AwsRegion.create('us-east-1');

function makeKeyPair(id: string): Ec2KeyPairUnused {
  return new Ec2KeyPairUnused({
    keyPairId: id,
    keyName: `key-${id}`,
    region,
    accountId: '123456789012',
    createdAt: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
  });
}

function makeDeps(
  opts: { summary?: DeadResourcesSummary; onCreateAnalysis?: (ctx: DeadResourceAnalysisContext) => void } = {},
): DeadResourcesDeps {
  const summary: DeadResourcesSummary = opts.summary ?? {
    findings: [],
    countBySeverity: { info: 0, warning: 0, critical: 0 },
    scanErrors: [],
  };
  const useCase: FindDeadResourcesUseCasePort = {
    execute: async () => Result.ok(summary),
  };
  return {
    resolveAccountId: async () => undefined,
    createAnalysis: async (ctx) => {
      opts.onCreateAnalysis?.(ctx);
      return { useCase };
    },
  };
}

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  jest.spyOn(console, 'log').mockImplementation((...args) => {
    stdout += args.join(' ') + '\n';
  });
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    stderr += args.join(' ') + '\n';
  });
  process.exitCode = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = undefined;
});

function run(options: Partial<DeadResourcesCommandOptions>, deps: DeadResourcesDeps): Promise<void> {
  return deadResourcesCommand({ regions: ['us-east-1'], ...options }, deps);
}

describe('deadResourcesCommand (CLI end-to-end)', () => {
  it('rejects an invalid --format before doing any work (exit 1)', async () => {
    await run({ format: 'xml' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--format must be one of');
  });

  it('rejects an invalid --min-age-days', async () => {
    await run({ minAgeDays: '-3' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--min-age-days must be a non-negative integer');
  });

  it('rejects an invalid region', async () => {
    await run({ regions: ['not-a-region'] }, makeDeps());
    expect(process.exitCode).toBe(1);
  });

  it('table format: renders "No dead/unused resources found" when there are no findings', async () => {
    await run({ format: 'table' }, makeDeps());
    expect(stdout).toContain('No dead/unused resources found');
  });

  it('table format: renders a finding with its severity', async () => {
    await run(
      { format: 'table' },
      makeDeps({
        summary: {
          findings: [makeKeyPair('key-1')],
          countBySeverity: { info: 1, warning: 0, critical: 0 },
          scanErrors: [],
        },
      }),
    );
    expect(stdout).toContain('key-key-1');
    expect(stdout).toContain('0 critical, 0 warning, 1 info');
  });

  it('json format: stdout is pure parseable JSON', async () => {
    await run(
      { format: 'json' },
      makeDeps({
        summary: {
          findings: [makeKeyPair('key-2')],
          countBySeverity: { info: 1, warning: 0, critical: 0 },
          scanErrors: [],
        },
      }),
    );
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].kind).toBe('ec2-keypair-unused');
    expect(parsed.countBySeverity).toEqual({ info: 1, warning: 0, critical: 0 });
  });

  it('--silent suppresses stdout entirely', async () => {
    await run({ format: 'table', silent: true }, makeDeps());
    expect(stdout).toBe('');
  });

  it('passes scannerKinds through to createAnalysis unchanged', async () => {
    let received: DeadResourceAnalysisContext | undefined;
    await run(
      { scannerKinds: ['ec2-keypair-unused'] },
      makeDeps({ onCreateAnalysis: (ctx) => (received = ctx) }),
    );
    expect(received?.scannerKinds).toEqual(['ec2-keypair-unused']);
  });

  it('rejects an unknown --scanners value', async () => {
    await run({ scanners: ['not-a-real-check'] }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('unknown check');
  });

  it('resolves --scanners into scannerKinds, taking precedence over the programmatic field', async () => {
    let received: DeadResourceAnalysisContext | undefined;
    await run(
      { scanners: ['iam-user-inactive'], scannerKinds: ['ec2-keypair-unused'] },
      makeDeps({ onCreateAnalysis: (ctx) => (received = ctx) }),
    );
    expect(received?.scannerKinds).toEqual(['iam-user-inactive']);
  });

  it('writes a PDF artifact to disk with --pdf <file>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-cli-'));
    const file = join(dir, 'out.pdf');
    try {
      await run(
        { format: 'table', pdf: file },
        makeDeps({
          summary: {
            findings: [makeKeyPair('key-1')],
            countBySeverity: { info: 1, warning: 0, critical: 0 },
            scanErrors: [],
          },
        }),
      );
      const written = await readFile(file);
      expect(written.length).toBeGreaterThan(0);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--silent suppresses stdout while still writing the requested PDF artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-cli-'));
    const file = join(dir, 'out.pdf');
    try {
      await run({ format: 'table', pdf: file, silent: true }, makeDeps());
      expect(stdout).toBe('');
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a scan failure', async () => {
    const failingDeps: DeadResourcesDeps = {
      resolveAccountId: async () => undefined,
      createAnalysis: async () => ({
        useCase: { execute: async () => Result.fail(new Error('boom')) },
      }),
    };
    await run({}, failingDeps);
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('boom');
  });
});
