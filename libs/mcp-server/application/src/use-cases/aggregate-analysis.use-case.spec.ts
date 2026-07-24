// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import { AwsRegion } from 'cloud-cost-domain';
import type { FindWastedResourcesUseCasePort, WastedResourcesSummary } from 'cloud-cost-domain';
import type { FindDeadResourcesUseCasePort, DeadResourcesSummary } from 'dead-resources-domain';
import type {
  FindResourceSecurityFindingsUseCasePort,
  ResourceSecuritySummary,
} from 'resource-security-domain';
import type { CostTrendUseCasePort, CostTrendSummary } from 'cost-analytics-domain';
import { AggregateAnalysisUseCase } from './aggregate-analysis.use-case';

const region = AwsRegion.create('us-east-1');

const cloudWasteSummary: WastedResourcesSummary = {
  findings: [],
  totalWasteMonthlyUsd: 0,
  totalOptimizationMonthlyUsd: 0,
  scanErrors: [],
};

const deadResourcesSummary: DeadResourcesSummary = {
  findings: [],
  countBySeverity: { info: 0, warning: 0, critical: 0 },
  scanErrors: [],
};

const resourceSecuritySummary: ResourceSecuritySummary = {
  findings: [],
  countBySeverity: { info: 0, warning: 0, critical: 0 },
  scanErrors: [],
};

const costTrendSummary: CostTrendSummary = {
  months: [],
};

function fakePort<TRequest, TSummary>(
  result: Result<TSummary>,
): { execute: jest.Mock<Promise<Result<TSummary>>, [TRequest]> } {
  return { execute: jest.fn().mockResolvedValue(result) };
}

describe('AggregateAnalysisUseCase', () => {
  it('composes all four domain summaries when every use case succeeds', async () => {
    const cloudWaste = fakePort<{ regions: AwsRegion[] }, WastedResourcesSummary>(
      Result.ok(cloudWasteSummary),
    );
    const deadResources = fakePort<{ regions: AwsRegion[] }, DeadResourcesSummary>(
      Result.ok(deadResourcesSummary),
    );
    const resourceSecurity = fakePort<{ regions: AwsRegion[] }, ResourceSecuritySummary>(
      Result.ok(resourceSecuritySummary),
    );
    const costTrend = fakePort<Record<string, unknown>, CostTrendSummary>(Result.ok(costTrendSummary));

    const useCase = new AggregateAnalysisUseCase(
      cloudWaste as unknown as FindWastedResourcesUseCasePort,
      deadResources as unknown as FindDeadResourcesUseCasePort,
      resourceSecurity as unknown as FindResourceSecurityFindingsUseCasePort,
      costTrend as unknown as CostTrendUseCasePort,
    );

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cloudWaste).toBe(cloudWasteSummary);
    expect(result.value.deadResources).toBe(deadResourcesSummary);
    expect(result.value.resourceSecurity).toBe(resourceSecuritySummary);
    expect(result.value.costTrend).toBe(costTrendSummary);
    expect(result.value.domainErrors).toEqual([]);
  });

  it('reports a failing domain as a domainError without discarding the other three', async () => {
    const costTrendError = new Error('Cost Explorer unavailable');
    const cloudWaste = fakePort<{ regions: AwsRegion[] }, WastedResourcesSummary>(
      Result.ok(cloudWasteSummary),
    );
    const deadResources = fakePort<{ regions: AwsRegion[] }, DeadResourcesSummary>(
      Result.ok(deadResourcesSummary),
    );
    const resourceSecurity = fakePort<{ regions: AwsRegion[] }, ResourceSecuritySummary>(
      Result.ok(resourceSecuritySummary),
    );
    const costTrend = fakePort<Record<string, unknown>, CostTrendSummary>(Result.fail(costTrendError));

    const useCase = new AggregateAnalysisUseCase(
      cloudWaste as unknown as FindWastedResourcesUseCasePort,
      deadResources as unknown as FindDeadResourcesUseCasePort,
      resourceSecurity as unknown as FindResourceSecurityFindingsUseCasePort,
      costTrend as unknown as CostTrendUseCasePort,
    );

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cloudWaste).toBe(cloudWasteSummary);
    expect(result.value.deadResources).toBe(deadResourcesSummary);
    expect(result.value.resourceSecurity).toBe(resourceSecuritySummary);
    expect(result.value.costTrend).toBeUndefined();
    expect(result.value.domainErrors).toEqual([{ domain: 'costTrend', error: costTrendError }]);
  });
});
