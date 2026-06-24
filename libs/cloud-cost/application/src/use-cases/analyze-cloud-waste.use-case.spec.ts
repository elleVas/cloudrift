// SPDX-License-Identifier: Apache-2.0
import { AnalyzeCloudWasteUseCase } from './analyze-cloud-waste.use-case';
import {
  AwsRegion,
  EbsVolume,
  ElasticIp,
  Gp2Volume,
} from 'cloud-cost-domain';
import type { ResourceKind, WastedResource, WasteScannerPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

const usEast = AwsRegion.create('us-east-1');
const euWest = AwsRegion.create('eu-west-1');

function makeEbsVolume(id: string, region = usEast): EbsVolume {
  return new EbsVolume({
    volumeId: id,
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 8,
  });
}

function makeElasticIp(allocationId: string): ElasticIp {
  return new ElasticIp({
    allocationId,
    publicIp: '1.2.3.4',
    region: usEast,
    accountId: '123456789012',
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 3.6,
  });
}

function makeGp2Volume(id: string): Gp2Volume {
  return new Gp2Volume({
    volumeId: id,
    region: usEast,
    accountId: '123456789012',
    sizeGb: 200,
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 4,
  });
}

/** Scanner fittizio: una risposta per regione, in ordine di chiamata. */
function makeScanner(
  kind: ResourceKind,
  responses: Array<Result<WastedResource[]>>,
): WasteScannerPort {
  let call = 0;
  return {
    kind,
    scan: async () => responses[Math.min(call++, responses.length - 1)],
  };
}

describe('AnalyzeCloudWasteUseCase', () => {
  it('returns an empty summary when all scanners find nothing', async () => {
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [Result.ok([])]),
      makeScanner('elastic-ip', [Result.ok([])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.totalWasteMonthlyUsd).toBe(0);
    expect(result.value.totalOptimizationMonthlyUsd).toBe(0);
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('aggregates findings from all scanners and computes the waste total', async () => {
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [Result.ok([makeEbsVolume('vol-1'), makeEbsVolume('vol-2')])]),
      makeScanner('elastic-ip', [Result.ok([makeElasticIp('eipalloc-1')])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(3);
    // 2 × (100 GB × $0.08) + 1 × $3.60 = $19.60
    expect(result.value.totalWasteMonthlyUsd).toBeCloseTo(19.6, 2);
    expect(result.value.totalOptimizationMonthlyUsd).toBe(0);
  });

  it('splits the totals by category (waste vs optimization)', async () => {
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [Result.ok([makeEbsVolume('vol-1')])]), // waste
      makeScanner('ebs-gp2-upgrade', [Result.ok([makeGp2Volume('vol-gp2')])]), // optimization
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalWasteMonthlyUsd).toBeCloseTo(8, 2);
    expect(result.value.totalOptimizationMonthlyUsd).toBeCloseTo(4, 2);
  });

  it('records a scanError with kind and region when a scanner fails, preserving other results', async () => {
    const err = new Error('EBS failed');
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [Result.fail(err)]),
      makeScanner('elastic-ip', [Result.ok([makeElasticIp('eipalloc-1')])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.scanErrors).toEqual([
      { kind: 'ebs-volume', region: 'us-east-1', error: err },
    ]);
  });

  it('keeps results from healthy regions when one region fails', async () => {
    const err = new Error('eu-west-1 not enabled');
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [
        Result.ok([makeEbsVolume('vol-us')]),
        Result.fail(err),
      ]),
    ]);

    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.map((f) => f.id)).toEqual(['vol-us']);
    expect(result.value.scanErrors).toEqual([
      { kind: 'ebs-volume', region: 'eu-west-1', error: err },
    ]);
  });

  it('excludes failed scans from the total cost', async () => {
    const useCase = new AnalyzeCloudWasteUseCase([
      makeScanner('ebs-volume', [Result.fail(new Error('boom'))]),
      makeScanner('elastic-ip', [Result.ok([makeElasticIp('eipalloc-1')])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalWasteMonthlyUsd).toBeCloseTo(3.6, 2);
  });

  it('scans every region with every scanner', async () => {
    const calls: string[] = [];
    const tracking: WasteScannerPort = {
      kind: 'ebs-volume',
      scan: async (region) => {
        calls.push(region.code);
        return Result.ok([]);
      },
    };

    const useCase = new AnalyzeCloudWasteUseCase([tracking]);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(calls).toEqual(['us-east-1', 'eu-west-1']);
  });
});
