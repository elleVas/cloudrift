// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import { ScanCoordinatorUseCase } from './scan-coordinator.use-case';
import type { ScanCoordinatorError, ScannableRegion, ScannableScanner } from './scan-coordinator.use-case';

type FakeKind = 'fake-a' | 'fake-b';

interface FakeFinding {
  readonly id: string;
}

interface FakeSummary {
  readonly findings: FakeFinding[];
  readonly count: number;
  readonly scanErrors: ScanCoordinatorError<FakeKind>[];
}

type FakeRegion = ScannableRegion;

/** Minimal concrete subclass: aggregation just counts findings. */
class FakeUseCase extends ScanCoordinatorUseCase<FakeKind, FakeRegion, FakeFinding, FakeSummary> {
  protected buildSummary(findings: FakeFinding[], scanErrors: ScanCoordinatorError<FakeKind>[]): FakeSummary {
    return { findings, count: findings.length, scanErrors };
  }
}

const usEast: FakeRegion = { code: 'us-east-1' };
const euWest: FakeRegion = { code: 'eu-west-1' };

/** Fake scanner: one response per region, in call order. */
function makeScanner(
  kind: FakeKind,
  responses: Array<Result<FakeFinding[], Error>>,
  scope?: 'regional' | 'global',
): ScannableScanner<FakeKind, FakeRegion, FakeFinding> {
  let call = 0;
  return {
    kind,
    scope,
    scan: async () => responses[Math.min(call++, responses.length - 1)],
  };
}

describe('ScanCoordinatorUseCase', () => {
  it('returns an empty summary when all scanners find nothing', async () => {
    const useCase = new FakeUseCase([makeScanner('fake-a', [Result.ok([])])]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(0);
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('aggregates findings from all scanners via buildSummary', async () => {
    const useCase = new FakeUseCase([
      makeScanner('fake-a', [Result.ok([{ id: 'a-1' }, { id: 'a-2' }])]),
      makeScanner('fake-b', [Result.ok([{ id: 'b-1' }])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(3);
  });

  it('records a scanError with kind and region when a scanner fails, preserving other results', async () => {
    const err = new Error('scanner A failed');
    const useCase = new FakeUseCase([
      makeScanner('fake-a', [Result.fail(err)]),
      makeScanner('fake-b', [Result.ok([{ id: 'b-1' }])]),
    ]);

    const result = await useCase.execute({ regions: [usEast] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.scanErrors).toEqual([{ kind: 'fake-a', region: 'us-east-1', error: err }]);
  });

  it('keeps results from healthy regions when one region fails', async () => {
    const err = new Error('eu-west-1 not enabled');
    const useCase = new FakeUseCase([makeScanner('fake-a', [Result.ok([{ id: 'us' }]), Result.fail(err)])]);

    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.map((f) => f.id)).toEqual(['us']);
    expect(result.value.scanErrors).toEqual([{ kind: 'fake-a', region: 'eu-west-1', error: err }]);
  });

  it('scans every region with every regional scanner', async () => {
    const calls: string[] = [];
    const tracking: ScannableScanner<FakeKind, FakeRegion, FakeFinding> = {
      kind: 'fake-a',
      scan: async (region) => {
        calls.push(region.code);
        return Result.ok([]);
      },
    };

    const useCase = new FakeUseCase([tracking]);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(calls).toEqual(['us-east-1', 'eu-west-1']);
  });

  it('calls a global-scope scanner exactly once, regardless of how many regions were requested', async () => {
    const calls: string[] = [];
    const globalScanner = makeScanner('fake-a', [Result.ok([])], 'global');
    globalScanner.scan = async (region) => {
      calls.push(region.code);
      return Result.ok([]);
    };

    const useCase = new FakeUseCase([globalScanner]);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(calls).toHaveLength(1);
  });

  it('still calls a regional scanner once per region alongside a global one', async () => {
    const regionalCalls: string[] = [];
    let globalCalls = 0;
    const scanners: ScannableScanner<FakeKind, FakeRegion, FakeFinding>[] = [
      {
        kind: 'fake-a',
        scan: async (region) => {
          regionalCalls.push(region.code);
          return Result.ok([]);
        },
      },
      {
        kind: 'fake-b',
        scope: 'global',
        scan: async () => {
          globalCalls++;
          return Result.ok([]);
        },
      },
    ];

    const useCase = new FakeUseCase(scanners);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(regionalCalls.sort()).toEqual(['eu-west-1', 'us-east-1']);
    expect(globalCalls).toBe(1);
  });

  it('labels a global scanner scanError as "global", not a real region', async () => {
    const err = new Error('AccessDenied');
    const globalScanner: ScannableScanner<FakeKind, FakeRegion, FakeFinding> = {
      kind: 'fake-a',
      scope: 'global',
      scan: async () => Result.fail(err),
    };

    const useCase = new FakeUseCase([globalScanner]);
    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toEqual([{ kind: 'fake-a', region: 'global', error: err }]);
  });

  it('bounds in-flight scans to the configured concurrency, across any scanner×region mix', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowScanner = (kind: FakeKind): ScannableScanner<FakeKind, FakeRegion, FakeFinding> => ({
      kind,
      scan: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return Result.ok([]);
      },
    });

    // 3 scanner × 2 regions = 6 job, pool of 2 workers
    const useCase = new FakeUseCase([slowScanner('fake-a'), slowScanner('fake-b'), slowScanner('fake-a')], 2);
    await useCase.execute({ regions: [usEast, euWest] });

    expect(peak).toBe(2);
  });

  it('scans regions of the same scanner concurrently when a worker is free', async () => {
    // us-east-1 only unblocks once eu-west-1 starts: with a sequential
    // per-region loop this test would time out.
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => (releaseFirst = resolve));
    const scanner: ScannableScanner<FakeKind, FakeRegion, FakeFinding> = {
      kind: 'fake-a',
      scan: async (region) => {
        if (region.code === 'us-east-1') {
          await firstBlocked;
        } else {
          releaseFirst();
        }
        return Result.ok([]);
      },
    };

    const useCase = new FakeUseCase([scanner], 2);
    const result = await useCase.execute({ regions: [usEast, euWest] });

    expect(result.ok).toBe(true);
  });

  it('uses the default concurrency (12) when none is provided', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowScanner = (kind: FakeKind): ScannableScanner<FakeKind, FakeRegion, FakeFinding> => ({
      kind,
      scan: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return Result.ok([]);
      },
    });

    const scanners = Array.from({ length: 20 }, () => slowScanner('fake-a'));
    const useCase = new FakeUseCase(scanners);
    await useCase.execute({ regions: [usEast] });

    expect(peak).toBe(12);
  });
});
