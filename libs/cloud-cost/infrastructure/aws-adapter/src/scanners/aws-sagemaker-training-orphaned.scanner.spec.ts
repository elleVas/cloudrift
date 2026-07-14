// SPDX-License-Identifier: Apache-2.0
import {
  SageMakerClient,
  ListModelsCommand,
  ListEndpointConfigsCommand,
  DescribeEndpointConfigCommand,
  DescribeModelCommand,
} from '@aws-sdk/client-sagemaker';
import { AwsSageMakerTrainingOrphanedScanner } from './aws-sagemaker-training-orphaned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-sagemaker');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SageMakerClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricing = { getPrice: jest.fn().mockReturnValue(0.023), getPricesAsOf: jest.fn().mockReturnValue('2024-01-01') };
const scanner = new AwsSageMakerTrainingOrphanedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsSageMakerTrainingOrphanedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sagemaker-training-orphaned');
  });

  it('reports a model not referenced by any endpoint config', async () => {
    mockSend.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListModelsCommand) {
        return Promise.resolve({ Models: [{ ModelName: 'orphan-model', ModelArn: 'arn:model', CreationTime: OLD_DATE }] });
      }
      if (cmd instanceof ListEndpointConfigsCommand) {
        return Promise.resolve({ EndpointConfigs: [] });
      }
      if (cmd instanceof DescribeModelCommand) {
        return Promise.resolve({ PrimaryContainer: { Image: 'img:latest', ModelDataUrl: 's3://bucket/model.tar.gz' } });
      }
      return Promise.resolve({});
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((m) => m.id)).toEqual(['orphan-model']);
  });

  it('does not report a model referenced by an endpoint config', async () => {
    mockSend.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListModelsCommand) {
        return Promise.resolve({ Models: [{ ModelName: 'live-model', ModelArn: 'arn:model', CreationTime: OLD_DATE }] });
      }
      if (cmd instanceof ListEndpointConfigsCommand) {
        return Promise.resolve({ EndpointConfigs: [{ EndpointConfigName: 'config-1', CreationTime: OLD_DATE }] });
      }
      if (cmd instanceof DescribeEndpointConfigCommand) {
        return Promise.resolve({ ProductionVariants: [{ ModelName: 'live-model' }] });
      }
      return Promise.resolve({});
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(DescribeModelCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys the client on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('SageMaker');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
