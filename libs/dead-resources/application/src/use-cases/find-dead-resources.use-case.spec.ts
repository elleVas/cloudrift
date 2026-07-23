// SPDX-License-Identifier: Apache-2.0
import { FindDeadResourcesUseCase } from './find-dead-resources.use-case';
import { AwsRegion, Ec2KeyPairUnused } from 'dead-resources-domain';
import type { DeadResourceKind, DeadResource, DeadResourceScannerPort } from 'dead-resources-domain';
import { Result } from 'shared-kernel';

const usEast = AwsRegion.create('us-east-1');
const euWest = AwsRegion.create('eu-west-1');

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

  it('records a scanError with kind and region when a scanner fails, preserving other results', async () => {
    const err = new Error('EC2 failed');
    const useCase = new FindDeadResourcesUseCase([makeScanner('ec2-keypair-unused', [Result.fail(err)])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.scanErrors).toEqual([{ kind: 'ec2-keypair-unused', region: 'us-east-1', error: err }]);
  });

  it('keeps results from healthy regions when one region fails', async () => {
    const err = new Error('eu-west-1 not enabled');
    const useCase = new FindDeadResourcesUseCase([
      makeScanner('ec2-keypair-unused', [Result.ok([makeKeyPair('key-us')]), Result.fail(err)]),
    ]);

    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.map((f) => f.id)).toEqual(['key-us']);
    expect(result.value.scanErrors).toEqual([{ kind: 'ec2-keypair-unused', region: 'eu-west-1', error: err }]);
  });

  it('calls a global-scope scanner exactly once, regardless of how many regions were requested', async () => {
    const calls: string[] = [];
    const globalScanner: DeadResourceScannerPort = {
      kind: 'iam-user-inactive',
      scope: 'global',
      scan: async (region) => {
        calls.push(region.code);
        return Result.ok([]);
      },
    };

    const useCase = new FindDeadResourcesUseCase([globalScanner]);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(calls).toHaveLength(1);
  });

  it('still calls a regional scanner once per region alongside a global one', async () => {
    const regionalCalls: string[] = [];
    let globalCalls = 0;
    const scanners: DeadResourceScannerPort[] = [
      {
        kind: 'ec2-keypair-unused',
        scan: async (region) => {
          regionalCalls.push(region.code);
          return Result.ok([]);
        },
      },
      {
        kind: 'iam-user-inactive',
        scope: 'global',
        scan: async () => {
          globalCalls++;
          return Result.ok([]);
        },
      },
    ];

    const useCase = new FindDeadResourcesUseCase(scanners);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(regionalCalls.sort()).toEqual(['eu-west-1', 'us-east-1']);
    expect(globalCalls).toBe(1);
  });

  it('labels a global scanner scanError as "global", not a real region', async () => {
    const err = new Error('AccessDenied');
    const globalScanner: DeadResourceScannerPort = {
      kind: 'iam-user-inactive',
      scope: 'global',
      scan: async () => Result.fail(err),
    };

    const useCase = new FindDeadResourcesUseCase([globalScanner]);
    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toEqual([{ kind: 'iam-user-inactive', region: 'global', error: err }]);
  });

  it('bounds in-flight scans to the configured concurrency, across any scanner×region mix', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowScanner = (kind: DeadResourceKind): DeadResourceScannerPort => ({
      kind,
      scan: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return Result.ok([]);
      },
    });

    const useCase = new FindDeadResourcesUseCase([slowScanner('ec2-keypair-unused')], 1);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(peak).toBe(1);
  });
});
