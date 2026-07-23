// SPDX-License-Identifier: Apache-2.0
import { readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Result } from 'shared-kernel';
import { IamRootMfaDisabled } from 'resource-security-domain';
import type { ResourceSecuritySummary, FindResourceSecurityFindingsUseCasePort } from 'resource-security-domain';
import { resourceSecurityCommand, type ResourceSecurityCommandOptions } from './resource-security.command';
import type { ResourceSecurityDeps, ResourceSecurityAnalysisContext } from './resource-security.composition';

function makeFinding(accountId: string): IamRootMfaDisabled {
  return new IamRootMfaDisabled({ accountId, mfaEnabled: false, detectedAt: new Date('2026-07-23'), tags: {} });
}

function makeDeps(
  opts: { summary?: ResourceSecuritySummary; onCreateAnalysis?: (ctx: ResourceSecurityAnalysisContext) => void } = {},
): ResourceSecurityDeps {
  const summary: ResourceSecuritySummary = opts.summary ?? {
    findings: [],
    countBySeverity: { info: 0, warning: 0, critical: 0 },
    scanErrors: [],
  };
  const useCase: FindResourceSecurityFindingsUseCasePort = {
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

function run(options: Partial<ResourceSecurityCommandOptions>, deps: ResourceSecurityDeps): Promise<void> {
  return resourceSecurityCommand({ regions: ['us-east-1'], ...options }, deps);
}

describe('resourceSecurityCommand (CLI end-to-end)', () => {
  it('rejects an invalid --format before doing any work (exit 1)', async () => {
    await run({ format: 'xml' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--format must be one of');
  });

  it('rejects an invalid region', async () => {
    await run({ regions: ['not-a-region'] }, makeDeps());
    expect(process.exitCode).toBe(1);
  });

  it('table format: renders "No security-posture risks found" when there are no findings', async () => {
    await run({ format: 'table' }, makeDeps());
    expect(stdout).toContain('No security-posture risks found');
  });

  it('table format: renders a finding with its severity', async () => {
    await run(
      { format: 'table' },
      makeDeps({
        summary: {
          findings: [makeFinding('123456789012')],
          countBySeverity: { info: 0, warning: 0, critical: 1 },
          scanErrors: [],
        },
      }),
    );
    expect(stdout).toContain('123456789012');
    expect(stdout).toContain('1 critical, 0 warning, 0 info');
  });

  it('json format: stdout is pure parseable JSON', async () => {
    await run(
      { format: 'json' },
      makeDeps({
        summary: {
          findings: [makeFinding('123456789012')],
          countBySeverity: { info: 0, warning: 0, critical: 1 },
          scanErrors: [],
        },
      }),
    );
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].kind).toBe('iam-root-mfa-disabled');
    expect(parsed.countBySeverity).toEqual({ info: 0, warning: 0, critical: 1 });
  });

  it('--silent suppresses stdout entirely', async () => {
    await run({ format: 'table', silent: true }, makeDeps());
    expect(stdout).toBe('');
  });

  it('passes scannerKinds through to createAnalysis unchanged', async () => {
    let received: ResourceSecurityAnalysisContext | undefined;
    await run(
      { scannerKinds: ['iam-root-mfa-disabled'] },
      makeDeps({ onCreateAnalysis: (ctx) => (received = ctx) }),
    );
    expect(received?.scannerKinds).toEqual(['iam-root-mfa-disabled']);
  });

  it('rejects an unknown --scanners value', async () => {
    await run({ scanners: ['not-a-real-check'] }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('unknown check');
  });

  it('resolves --scanners into scannerKinds, taking precedence over the programmatic field', async () => {
    let received: ResourceSecurityAnalysisContext | undefined;
    await run(
      { scanners: ['s3-bucket-public'], scannerKinds: ['iam-root-mfa-disabled'] },
      makeDeps({ onCreateAnalysis: (ctx) => (received = ctx) }),
    );
    expect(received?.scannerKinds).toEqual(['s3-bucket-public']);
  });

  it('writes a PDF artifact to disk with --pdf <file>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-cli-'));
    const file = join(dir, 'out.pdf');
    try {
      await run(
        { format: 'table', pdf: file },
        makeDeps({
          summary: {
            findings: [makeFinding('123456789012')],
            countBySeverity: { info: 0, warning: 0, critical: 1 },
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
    const failingDeps: ResourceSecurityDeps = {
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
