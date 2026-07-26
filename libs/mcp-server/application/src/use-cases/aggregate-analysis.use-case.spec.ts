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

  it('reports all four domains as domainErrors, still resolving Result.ok, when every use case fails', async () => {
    const cloudWasteError = new Error('EC2 describe failed');
    const deadResourcesError = new Error('S3 list failed');
    const resourceSecurityError = new Error('IAM list failed');
    const costTrendError = new Error('Cost Explorer unavailable');
    const cloudWaste = fakePort<{ regions: AwsRegion[] }, WastedResourcesSummary>(
      Result.fail(cloudWasteError),
    );
    const deadResources = fakePort<{ regions: AwsRegion[] }, DeadResourcesSummary>(
      Result.fail(deadResourcesError),
    );
    const resourceSecurity = fakePort<{ regions: AwsRegion[] }, ResourceSecuritySummary>(
      Result.fail(resourceSecurityError),
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
    expect(result.value.cloudWaste).toBeUndefined();
    expect(result.value.deadResources).toBeUndefined();
    expect(result.value.resourceSecurity).toBeUndefined();
    expect(result.value.costTrend).toBeUndefined();
    expect(result.value.domainErrors).toEqual([
      { domain: 'cloudWaste', error: cloudWasteError },
      { domain: 'deadResources', error: deadResourcesError },
      { domain: 'resourceSecurity', error: resourceSecurityError },
      { domain: 'costTrend', error: costTrendError },
    ]);
  });

  it('propagates request.regions to the three region-scoped ports and request.costTrend to the cost-trend port', async () => {
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

    const otherRegion = AwsRegion.create('eu-west-1');
    const costTrendRequest = { months: 6, service: 'ec2' };
    await useCase.execute({ regions: [region, otherRegion], costTrend: costTrendRequest });

    expect(cloudWaste.execute).toHaveBeenCalledWith({ regions: [region, otherRegion] });
    expect(deadResources.execute).toHaveBeenCalledWith({ regions: [region, otherRegion] });
    expect(resourceSecurity.execute).toHaveBeenCalledWith({ regions: [region, otherRegion] });
    expect(costTrend.execute).toHaveBeenCalledWith(costTrendRequest);
  });

  it('defaults costTrend.execute argument to {} when request.costTrend is omitted', async () => {
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

    await useCase.execute({ regions: [region] });

    expect(costTrend.execute).toHaveBeenCalledWith({});
  });
});
