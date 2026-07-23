// SPDX-License-Identifier: Apache-2.0
import { CodePipelineClient, ListPipelinesCommand, ListPipelineExecutionsCommand } from '@aws-sdk/client-codepipeline';
import { AwsCodepipelinePipelineStaleScanner } from './aws-codepipeline-pipeline-stale.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-codepipeline');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CodePipelineClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsCodepipelinePipelineStaleScanner(mockPricing);
const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

describe('AwsCodepipelinePipelineStaleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('codepipeline-pipeline-stale');
  });

  it('flags a pipeline that has never executed and is older than the grace period', async () => {
    mockSend
      .mockResolvedValueOnce({ pipelines: [{ name: 'legacy-deploy-pipeline', created: oldDate }] })
      .mockResolvedValueOnce({ pipelineExecutionSummaries: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.id)).toEqual(['legacy-deploy-pipeline']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(1);
  });

  it('flags a pipeline whose last execution is older than the grace period', async () => {
    mockSend
      .mockResolvedValueOnce({ pipelines: [{ name: 'stale-pipeline', created: oldDate }] })
      .mockResolvedValueOnce({ pipelineExecutionSummaries: [{ startTime: oldDate }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.id)).toEqual(['stale-pipeline']);
  });

  it('does not flag a pipeline created less than the grace period ago, never executed', async () => {
    mockSend
      .mockResolvedValueOnce({ pipelines: [{ name: 'fresh-pipeline', created: new Date() }] })
      .mockResolvedValueOnce({ pipelineExecutionSummaries: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a pipeline that executed recently', async () => {
    mockSend
      .mockResolvedValueOnce({ pipelines: [{ name: 'active-pipeline', created: oldDate }] })
      .mockResolvedValueOnce({ pipelineExecutionSummaries: [{ startTime: new Date() }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListPipelineExecutionsCommand scoped to the pipeline name', async () => {
    mockSend
      .mockResolvedValueOnce({ pipelines: [{ name: 'legacy-deploy-pipeline', created: oldDate }] })
      .mockResolvedValueOnce({ pipelineExecutionSummaries: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListPipelinesCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(ListPipelineExecutionsCommand));
    const constructorArgs = (ListPipelineExecutionsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.pipelineName).toBe('legacy-deploy-pipeline');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
