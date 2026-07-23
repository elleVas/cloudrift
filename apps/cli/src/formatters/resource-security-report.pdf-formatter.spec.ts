// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IamRootMfaDisabled, S3BucketPublic } from 'resource-security-domain';
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { generateResourceSecurityReportPdf, type ResourceSecurityReportPdfMeta } from './resource-security-report.pdf-formatter';

const meta: ResourceSecurityReportPdfMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-07-23T12:00:00Z'),
};

function makeRootMfaFinding(): IamRootMfaDisabled {
  return new IamRootMfaDisabled({ accountId: '123456789012', mfaEnabled: false, detectedAt: new Date('2026-07-23'), tags: {} });
}

function makePublicBucket(name: string): S3BucketPublic {
  return new S3BucketPublic({
    bucketName: name,
    accountId: '123456789012',
    publicVia: ['bucket policy allows public access'],
    detectedAt: new Date('2026-07-23'),
    tags: {},
  });
}

describe('generateResourceSecurityReportPdf', () => {
  it('completes without throwing for a realistic summary spanning multiple kinds', async () => {
    const summary: ResourceSecuritySummary = {
      findings: [makeRootMfaFinding(), makePublicBucket('bucket-1'), makePublicBucket('bucket-2')],
      countBySeverity: { info: 0, warning: 0, critical: 3 },
      scanErrors: [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'resource-security.pdf');
    try {
      await expect(generateResourceSecurityReportPdf(summary, meta, file)).resolves.toBeUndefined();
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(written.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when there are no findings', async () => {
    const empty: ResourceSecuritySummary = { findings: [], countBySeverity: { info: 0, warning: 0, critical: 0 }, scanErrors: [] };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'empty.pdf');
    try {
      await expect(generateResourceSecurityReportPdf(empty, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when there are scan warnings', async () => {
    const withErrors: ResourceSecuritySummary = {
      findings: [makeRootMfaFinding()],
      countBySeverity: { info: 0, warning: 0, critical: 1 },
      scanErrors: [{ kind: 'cloudtrail-not-multiregion', region: 'global', error: new Error('AccessDenied') }],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'warnings.pdf');
    try {
      await expect(generateResourceSecurityReportPdf(withErrors, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
