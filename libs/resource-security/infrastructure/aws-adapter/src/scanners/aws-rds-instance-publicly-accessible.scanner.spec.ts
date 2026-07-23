// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { AwsRdsInstancePubliclyAccessibleScanner } from './aws-rds-instance-publicly-accessible.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-rds');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RDSClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsRdsInstancePubliclyAccessibleScanner();

describe('AwsRdsInstancePubliclyAccessibleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('rds-instance-publicly-accessible');
  });

  it('flags a publicly accessible RDS instance', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [{ DBInstanceIdentifier: 'db-1', PubliclyAccessible: true }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['db-1']);
  });

  it('does not flag a private RDS instance', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [{ DBInstanceIdentifier: 'db-2', PubliclyAccessible: false }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeDBInstancesCommand', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeDBInstancesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
