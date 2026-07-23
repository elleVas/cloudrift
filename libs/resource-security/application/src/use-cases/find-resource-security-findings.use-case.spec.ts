// SPDX-License-Identifier: Apache-2.0
import { FindResourceSecurityFindingsUseCase } from './find-resource-security-findings.use-case';
import { AwsRegion, Ec2VolumeUnencrypted } from 'resource-security-domain';
import type { ResourceSecurityKind, SecurityFinding, ResourceSecurityScannerPort } from 'resource-security-domain';
import { Result } from 'shared-kernel';

const usEast = AwsRegion.create('us-east-1');
const euWest = AwsRegion.create('eu-west-1');

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

  it('records a scanError with kind and region when a scanner fails, preserving other results', async () => {
    const err = new Error('EC2 failed');
    const useCase = new FindResourceSecurityFindingsUseCase([makeScanner('ec2-volume-unencrypted', [Result.fail(err)])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.scanErrors).toEqual([{ kind: 'ec2-volume-unencrypted', region: 'us-east-1', error: err }]);
  });

  it('calls a global-scope scanner exactly once, regardless of how many regions were requested', async () => {
    const calls: string[] = [];
    const globalScanner: ResourceSecurityScannerPort = {
      kind: 'iam-root-mfa-disabled',
      scope: 'global',
      scan: async (region) => {
        calls.push(region.code);
        return Result.ok([]);
      },
    };

    const useCase = new FindResourceSecurityFindingsUseCase([globalScanner]);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(calls).toHaveLength(1);
  });

  it('still calls a regional scanner once per region alongside a global one', async () => {
    const regionalCalls: string[] = [];
    let globalCalls = 0;
    const scanners: ResourceSecurityScannerPort[] = [
      {
        kind: 'ec2-volume-unencrypted',
        scan: async (region) => {
          regionalCalls.push(region.code);
          return Result.ok([]);
        },
      },
      {
        kind: 'iam-root-mfa-disabled',
        scope: 'global',
        scan: async () => {
          globalCalls++;
          return Result.ok([]);
        },
      },
    ];

    const useCase = new FindResourceSecurityFindingsUseCase(scanners);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(regionalCalls.sort()).toEqual(['eu-west-1', 'us-east-1']);
    expect(globalCalls).toBe(1);
  });

  it('labels a global scanner scanError as "global", not a real region', async () => {
    const err = new Error('AccessDenied');
    const globalScanner: ResourceSecurityScannerPort = {
      kind: 'iam-root-mfa-disabled',
      scope: 'global',
      scan: async () => Result.fail(err),
    };

    const useCase = new FindResourceSecurityFindingsUseCase([globalScanner]);
    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toEqual([{ kind: 'iam-root-mfa-disabled', region: 'global', error: err }]);
  });

  it('bounds in-flight scans to the configured concurrency, across any scanner×region mix', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowScanner = (kind: ResourceSecurityKind): ResourceSecurityScannerPort => ({
      kind,
      scan: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return Result.ok([]);
      },
    });

    const useCase = new FindResourceSecurityFindingsUseCase([slowScanner('ec2-volume-unencrypted')], 1);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(peak).toBe(1);
  });
});
