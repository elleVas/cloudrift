import { readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Result } from 'shared-kernel';
import { AwsRegion, EbsVolume } from 'cloud-cost-domain';
import type { WastedResource, WastedResourcesSummary } from 'cloud-cost-domain';
import { ConfigError, type CloudriftConfig } from '../config/cloudrift.config';
import {
  analyzeWasteCommand,
  type AnalyzeDeps,
  type AnalyzeWasteOptions,
} from './analyze-waste.command';

const region = AwsRegion.create('us-east-1');

function wasteVolume(id: string, monthlyCostUsd: number): EbsVolume {
  return new EbsVolume({
    volumeId: id,
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-16'),
    tags: {},
    monthlyCostUsd,
  });
}

function summaryOf(
  findings: WastedResource[],
  totalWasteMonthlyUsd: number,
): WastedResourcesSummary {
  return { findings, totalWasteMonthlyUsd, totalOptimizationMonthlyUsd: 0, scanErrors: [] };
}

/** Fake deps: no AWS. Lets us drive config + canned findings into the command. */
function makeDeps(opts: {
  config?: CloudriftConfig;
  summary?: WastedResourcesSummary;
} = {}): AnalyzeDeps {
  return {
    loadConfig: async () => Result.ok(opts.config ?? {}),
    resolveAccountId: async () => undefined,
    createAnalysis: async () => ({
      useCase: { execute: async () => Result.ok(opts.summary ?? summaryOf([], 0)) },
      pricesAsOf: '2025-06',
    }),
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
  process.exitCode = undefined; // don't leak a non-zero exit to the jest process
});

function run(options: Partial<AnalyzeWasteOptions>, deps: AnalyzeDeps): Promise<void> {
  return analyzeWasteCommand({ regions: ['us-east-1'], ...options }, deps);
}

describe('analyzeWasteCommand (CLI end-to-end)', () => {
  it('rejects an invalid --format before doing any work (exit 1)', async () => {
    await run({ format: 'xml' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--format must be one of');
  });

  it('table format: banner and report go to stdout', async () => {
    await run({ format: 'table' }, makeDeps({
      summary: summaryOf([wasteVolume('vol-1', 8)], 8),
    }));
    expect(stdout).toContain('Scanning us-east-1');
    expect(stdout).toContain('Total waste:');
    expect(stdout).toContain('$8.00/month');
  });

  it('json format: stdout is pure parseable JSON, no human chrome', async () => {
    await run({ format: 'json' }, makeDeps({
      summary: summaryOf([wasteVolume('vol-1', 8)], 8),
    }));
    expect(stdout).not.toContain('Scanning'); // banner suppressed
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.totalWasteMonthlyUsd).toBe(8);
    expect(parsed.findings).toHaveLength(1);
  });

  it('markdown format: stdout is the markdown report', async () => {
    await run({ format: 'markdown' }, makeDeps({
      summary: summaryOf([wasteVolume('vol-1', 8)], 8),
    }));
    expect(stdout).toContain('## ☁️ cloudrift');
    expect(stdout).not.toContain('Scanning');
  });

  it('exits 2 when waste exceeds the configured threshold', async () => {
    await run({ format: 'json' }, makeDeps({
      config: { costAlertThresholdUsd: 5 },
      summary: summaryOf([wasteVolume('vol-1', 8)], 8),
    }));
    expect(process.exitCode).toBe(2);
    // stdout stays clean JSON; the alert goes to stderr
    expect(() => JSON.parse(stdout.trim())).not.toThrow();
    expect(stderr).toContain('Waste threshold exceeded');
  });

  it('does not exit 2 when waste is under the threshold', async () => {
    await run({ format: 'json' }, makeDeps({
      config: { costAlertThresholdUsd: 100 },
      summary: summaryOf([wasteVolume('vol-1', 8)], 8),
    }));
    expect(process.exitCode).toBeUndefined();
  });

  it('fails (exit 1) when the config is invalid', async () => {
    const deps: AnalyzeDeps = {
      ...makeDeps(),
      loadConfig: async () => Result.fail(new ConfigError('Invalid config: bad')),
    };
    await run({}, deps);
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('Invalid config');
  });

  it('fails (exit 1) when all regions are excluded by config', async () => {
    await run({ regions: ['us-east-1'] }, makeDeps({
      config: { excludeRegions: ['us-east-1'] },
    }));
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('No regions left to scan');
  });

  it('writes a JSON artifact to disk with --json <file>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-cli-'));
    const file = join(dir, 'out.json');
    try {
      await run({ format: 'table', json: file }, makeDeps({
        summary: summaryOf([wasteVolume('vol-1', 8)], 8),
      }));
      const written = JSON.parse(await readFile(file, 'utf8'));
      expect(written.totalWasteMonthlyUsd).toBe(8);
      expect(written.findings[0].id).toBe('vol-1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a PDF artifact to disk with --pdf <file>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-cli-'));
    const file = join(dir, 'out.pdf');
    try {
      await run({ format: 'table', pdf: file }, makeDeps({
        summary: summaryOf([wasteVolume('vol-1', 8)], 8),
      }));
      const written = await readFile(file);
      expect(written.length).toBeGreaterThan(0);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a partial scan without crashing, exit code dictated only by the cost threshold', async () => {
    const summary: WastedResourcesSummary = {
      ...summaryOf([], 0),
      scanErrors: [
        { kind: 'ebs-volume', region: 'us-east-1', error: new Error('AccessDenied') },
      ],
    };
    await run({ format: 'table' }, makeDeps({ summary }));
    expect(process.exitCode).toBeUndefined();
    expect(stdout).toContain('partial results');
  });
});
