// SPDX-License-Identifier: Apache-2.0
import {
  SageMakerClient,
  ListEndpointsCommand,
  DescribeEndpointCommand,
  DescribeEndpointConfigCommand,
} from '@aws-sdk/client-sagemaker';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsSageMakerEndpointIdleScanner } from './aws-sagemaker-endpoint-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-sagemaker');
jest.mock('@aws-sdk/client-cloudwatch');

const mockSageMakerSend = jest.fn();
const mockSageMakerDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SageMakerClient as jest.Mock).mockImplementation(() => ({ send: mockSageMakerSend, destroy: mockSageMakerDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getSageMakerEndpointInstancePricePerMonth: jest.fn().mockResolvedValue(100) };
const scanner = new AwsSageMakerEndpointIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

function mockEndpointDescribeCalls() {
  mockSageMakerSend.mockImplementation((cmd: unknown) => {
    if (cmd instanceof DescribeEndpointCommand) {
      return Promise.resolve({
        EndpointName: 'endpoint-1',
        EndpointConfigName: 'config-1',
        EndpointStatus: 'InService',
        CreationTime: OLD_DATE,
      });
    }
    if (cmd instanceof DescribeEndpointConfigCommand) {
      return Promise.resolve({
        EndpointConfigName: 'config-1',
        ProductionVariants: [{ VariantName: 'variant-1', InstanceType: 'ml.m5.xlarge', InitialInstanceCount: 2 }],
      });
    }
    return Promise.resolve({ Endpoints: [{ EndpointName: 'endpoint-1', EndpointStatus: 'InService', CreationTime: OLD_DATE }] });
  });
}

describe('AwsSageMakerEndpointIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sagemaker-endpoint-idle');
  });

  it('reports an InService endpoint with zero invocations', async () => {
    mockEndpointDescribeCalls();
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.id)).toEqual(['endpoint-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(200, 2);
  });

  it('does not report an endpoint with invocations', async () => {
    mockEndpointDescribeCalls();
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 5 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters ListEndpoints on StatusEquals=InService', async () => {
    mockSageMakerSend.mockResolvedValueOnce({ Endpoints: [] });

    await scanner.scan(region);

    const args = (ListEndpointsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.StatusEquals).toBe('InService');
  });

  it('queries the Invocations metric from the AWS/SageMaker namespace per variant', async () => {
    mockEndpointDescribeCalls();
    mockCwSend.mockResolvedValue({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/SageMaker');
    expect(args.MetricName).toBe('Invocations');
    expect(args.Dimensions).toEqual([
      { Name: 'EndpointName', Value: 'endpoint-1' },
      { Name: 'VariantName', Value: 'variant-1' },
    ]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockSageMakerSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('SageMaker');
    expect(mockSageMakerDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
