// SPDX-License-Identifier: Apache-2.0
import { MqClient } from '@aws-sdk/client-mq';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsMqIdleScanner } from './aws-mq-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-mq');
jest.mock('@aws-sdk/client-cloudwatch');

const mockMqSend = jest.fn();
const mockMqDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (MqClient as jest.Mock).mockImplementation(() => ({ send: mockMqSend, destroy: mockMqDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getMqBrokerPricePerMonth: jest.fn().mockResolvedValue(60) };
const scanner = new AwsMqIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsMqIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('mq-idle-broker');
  });

  it('reports a running broker with zero network traffic', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        {
          BrokerId: 'broker-1',
          BrokerName: 'my-broker',
          BrokerState: 'RUNNING',
          HostInstanceType: 'mq.t3.micro',
          DeploymentMode: 'SINGLE_INSTANCE',
          Created: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((b) => b.id)).toEqual(['broker-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(60, 2);
  });

  it('doubles the price for ACTIVE_STANDBY_MULTI_AZ deployments', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        {
          BrokerId: 'broker-ha',
          BrokerName: 'ha-broker',
          BrokerState: 'RUNNING',
          HostInstanceType: 'mq.t3.micro',
          DeploymentMode: 'ACTIVE_STANDBY_MULTI_AZ',
          Created: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(120, 2);
  });

  it('does not report a broker with network traffic', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        { BrokerId: 'busy', BrokerName: 'busy', BrokerState: 'RUNNING', HostInstanceType: 'mq.t3.micro', DeploymentMode: 'SINGLE_INSTANCE', Created: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 200 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores brokers that are not RUNNING', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        { BrokerId: 'creating', BrokerName: 'creating', BrokerState: 'CREATION_IN_PROGRESS', HostInstanceType: 'mq.t3.micro', DeploymentMode: 'SINGLE_INSTANCE', Created: OLD_DATE },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('resolves price with the broker instance type, deployment option, and engine, mapped to Pricing API attribute values', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        {
          BrokerId: 'broker-1',
          BrokerName: 'my-broker',
          BrokerState: 'RUNNING',
          HostInstanceType: 'mq.m5.large',
          DeploymentMode: 'ACTIVE_STANDBY_MULTI_AZ',
          EngineType: 'RABBITMQ',
          Created: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    expect(mockPricingSource.getMqBrokerPricePerMonth).toHaveBeenCalledWith(
      region,
      'mq.m5.large',
      'Multi-AZ',
      'RabbitMQ',
    );
  });

  it('defaults to ActiveMQ/Single-AZ when EngineType/DeploymentMode are missing (SDK types mark them required, but real responses aren\'t guaranteed to send them)', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [{ BrokerId: 'broker-1', BrokerName: 'my-broker', BrokerState: 'RUNNING', HostInstanceType: 'mq.t3.micro', Created: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    expect(mockPricingSource.getMqBrokerPricePerMonth).toHaveBeenCalledWith(
      region,
      'mq.t3.micro',
      'Single-AZ',
      'ActiveMQ',
    );
  });

  it('queries the NetworkIn metric from the AWS/AmazonMQ namespace', async () => {
    mockMqSend.mockResolvedValueOnce({
      BrokerSummaries: [
        { BrokerId: 'broker-1', BrokerName: 'my-broker', BrokerState: 'RUNNING', HostInstanceType: 'mq.t3.micro', DeploymentMode: 'SINGLE_INSTANCE', Created: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/AmazonMQ');
    expect(args.MetricName).toBe('NetworkIn');
    expect(args.Dimensions).toEqual([{ Name: 'Broker', Value: 'broker-1' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockMqSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('MQ');
    expect(mockMqDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
