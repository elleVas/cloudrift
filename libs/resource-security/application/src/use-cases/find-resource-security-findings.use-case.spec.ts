// SPDX-License-Identifier: Apache-2.0
import { FindResourceSecurityFindingsUseCase } from './find-resource-security-findings.use-case';
import { AwsRegion, Ec2VolumeUnencrypted } from 'resource-security-domain';
import type { ResourceSecurityKind, SecurityFinding, ResourceSecurityScannerPort } from 'resource-security-domain';
import { Result } from 'shared-kernel';

const usEast = AwsRegion.create('us-east-1');

function makeVolume(id: string): Ec2VolumeUnencrypted {
  return new Ec2VolumeUnencrypted({
    volumeId: id,
    region: usEast,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
  });
}

/** Fake scanner: one response per region, in call order. */
function makeScanner(kind: ResourceSecurityKind, responses: Array<Result<SecurityFinding[]>>): ResourceSecurityScannerPort {
  let call = 0;
  return {
    kind,
    scan: async () => responses[Math.min(call++, responses.length - 1)],
  };
}

// Job scheduling, concurrency, and per-(scanner,region) error collection are
// covered generically by shared-scan-coordination's own spec. These tests
// only exercise the aggregation logic specific to this use case.
describe('FindResourceSecurityFindingsUseCase', () => {
  it('returns an empty summary when all scanners find nothing', async () => {
    const useCase = new FindResourceSecurityFindingsUseCase([makeScanner('ec2-volume-unencrypted', [Result.ok([])])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.countBySeverity).toEqual({ info: 0, warning: 0, critical: 0 });
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('aggregates findings from all scanners and counts by severity', async () => {
    const useCase = new FindResourceSecurityFindingsUseCase([
      makeScanner('ec2-volume-unencrypted', [Result.ok([makeVolume('vol-1'), makeVolume('vol-2')])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(2);
    expect(result.value.countBySeverity).toEqual({ info: 0, warning: 2, critical: 0 });
  });

  it('records a scanError with the real ResourceSecurityKind and region when a scanner fails', async () => {
    const err = new Error('EC2 failed');
    const useCase = new FindResourceSecurityFindingsUseCase([makeScanner('ec2-volume-unencrypted', [Result.fail(err)])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.scanErrors).toEqual([{ kind: 'ec2-volume-unencrypted', region: 'us-east-1', error: err }]);
  });
});
