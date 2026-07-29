// SPDX-License-Identifier: Apache-2.0
import { FindDeadResourcesUseCase } from './find-dead-resources.use-case';
import { AwsRegion, Ec2KeyPairUnused } from 'dead-resources-domain';
import type { DeadResourceKind, DeadResource, DeadResourceScannerPort } from 'dead-resources-domain';
import { Result } from 'shared-kernel';

const usEast = AwsRegion.create('us-east-1');

function makeKeyPair(id: string): Ec2KeyPairUnused {
  return new Ec2KeyPairUnused({
    keyPairId: id,
    keyName: `key-${id}`,
    region: usEast,
    accountId: '123456789012',
    createdAt: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
  });
}

/** Fake scanner: one response per region, in call order. */
function makeScanner(kind: DeadResourceKind, responses: Array<Result<DeadResource[]>>): DeadResourceScannerPort {
  let call = 0;
  return {
    kind,
    scan: async () => responses[Math.min(call++, responses.length - 1)],
  };
}

// Job scheduling, concurrency, and per-(scanner,region) error collection are
// covered generically by shared-scan-coordination's own spec. These tests
// only exercise the aggregation logic specific to this use case.
describe('FindDeadResourcesUseCase', () => {
  it('returns an empty summary when all scanners find nothing', async () => {
    const useCase = new FindDeadResourcesUseCase([makeScanner('ec2-keypair-unused', [Result.ok([])])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.countBySeverity).toEqual({ info: 0, warning: 0, critical: 0 });
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('aggregates findings from all scanners and counts by severity', async () => {
    const useCase = new FindDeadResourcesUseCase([
      makeScanner('ec2-keypair-unused', [Result.ok([makeKeyPair('key-1'), makeKeyPair('key-2')])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(2);
    expect(result.value.countBySeverity).toEqual({ info: 2, warning: 0, critical: 0 });
  });

  it('records a scanError with the real DeadResourceKind and region when a scanner fails', async () => {
    const err = new Error('EC2 failed');
    const useCase = new FindDeadResourcesUseCase([makeScanner('ec2-keypair-unused', [Result.fail(err)])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.scanErrors).toEqual([{ kind: 'ec2-keypair-unused', region: 'us-east-1', error: err }]);
  });
});
