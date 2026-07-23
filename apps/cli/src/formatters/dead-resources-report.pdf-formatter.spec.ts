// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AwsRegion, Ec2KeyPairUnused, IamUserInactive } from 'dead-resources-domain';
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { generateDeadResourcesReportPdf, type DeadResourcesReportPdfMeta } from './dead-resources-report.pdf-formatter';

const region = AwsRegion.create('us-east-1');
const meta: DeadResourcesReportPdfMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-07-23T12:00:00Z'),
};

function makeKeyPair(id: string): Ec2KeyPairUnused {
  return new Ec2KeyPairUnused({
    keyPairId: id,
    keyName: `key-${id}`,
    region,
    accountId: '123456789012',
    createdAt: new Date('2025-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
  });
}

function makeIamUser(id: string): IamUserInactive {
  return new IamUserInactive({
    userId: id,
    userName: `user-${id}`,
    arn: `arn:aws:iam::123456789012:user/user-${id}`,
    accountId: '123456789012',
    createdAt: new Date('2024-01-01'),
    lastActivityAt: undefined,
    detectedAt: new Date('2026-07-23'),
    tags: {},
  });
}

describe('generateDeadResourcesReportPdf', () => {
  it('completes without throwing for a realistic summary spanning multiple kinds', async () => {
    const summary: DeadResourcesSummary = {
      findings: [makeKeyPair('key-1'), makeKeyPair('key-2'), makeIamUser('AIDA1')],
      countBySeverity: { info: 2, warning: 1, critical: 0 },
      scanErrors: [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'dead-resources.pdf');
    try {
      await expect(generateDeadResourcesReportPdf(summary, meta, file)).resolves.toBeUndefined();
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(written.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when there are no findings', async () => {
    const empty: DeadResourcesSummary = {
      findings: [],
      countBySeverity: { info: 0, warning: 0, critical: 0 },
      scanErrors: [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'empty.pdf');
    try {
      await expect(generateDeadResourcesReportPdf(empty, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when there are scan warnings', async () => {
    const withErrors: DeadResourcesSummary = {
      findings: [makeKeyPair('key-1')],
      countBySeverity: { info: 1, warning: 0, critical: 0 },
      scanErrors: [{ kind: 'iam-user-inactive', region: 'global', error: new Error('AccessDenied') }],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'warnings.pdf');
    try {
      await expect(generateDeadResourcesReportPdf(withErrors, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
