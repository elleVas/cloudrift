// SPDX-License-Identifier: Apache-2.0
import { SageMakerClient, ListNotebookInstancesCommand } from '@aws-sdk/client-sagemaker';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsSageMakerNotebookIdleScanner } from './aws-sagemaker-notebook-idle.scanner';
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
const mockPricingSource = { getSageMakerNotebookInstancePricePerMonth: jest.fn().mockResolvedValue(46.72) };
const scanner = new AwsSageMakerNotebookIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsSageMakerNotebookIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sagemaker-notebook-idle');
  });

  it('reports an InService notebook with low CPU', async () => {
    mockSageMakerSend.mockResolvedValueOnce({
      NotebookInstances: [
        {
          NotebookInstanceName: 'notebook-1',
          InstanceType: 'ml.t3.medium',
          NotebookInstanceStatus: 'InService',
          LastModifiedTime: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: 1.2 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((n) => n.id)).toEqual(['notebook-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(46.72, 2);
  });

  it('does not report a notebook with CPU above threshold', async () => {
    mockSageMakerSend.mockResolvedValueOnce({
      NotebookInstances: [
        { NotebookInstanceName: 'busy', InstanceType: 'ml.t3.medium', NotebookInstanceStatus: 'InService', LastModifiedTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: 40 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters ListNotebookInstances on StatusEquals=InService', async () => {
    mockSageMakerSend.mockResolvedValueOnce({ NotebookInstances: [] });

    await scanner.scan(region);

    const args = (ListNotebookInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.StatusEquals).toBe('InService');
  });

  it('queries the CPUUtilization metric from the /aws/sagemaker/NotebookInstances namespace', async () => {
    mockSageMakerSend.mockResolvedValueOnce({
      NotebookInstances: [
        { NotebookInstanceName: 'notebook-1', InstanceType: 'ml.t3.medium', NotebookInstanceStatus: 'InService', LastModifiedTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('/aws/sagemaker/NotebookInstances');
    expect(args.MetricName).toBe('CPUUtilization');
    expect(args.Dimensions).toEqual([{ Name: 'NotebookInstanceName', Value: 'notebook-1' }]);
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
