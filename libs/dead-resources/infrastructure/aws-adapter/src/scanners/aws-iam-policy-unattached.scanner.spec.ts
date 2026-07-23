// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListPoliciesCommand } from '@aws-sdk/client-iam';
import { AwsIamPolicyUnattachedScanner } from './aws-iam-policy-unattached.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-iam');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (IAMClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsIamPolicyUnattachedScanner();
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('AwsIamPolicyUnattachedScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-policy-unattached');
    expect(scanner.scope).toBe('global');
  });

  it('flags an old policy with zero attachments', async () => {
    mockSend.mockResolvedValueOnce({
      Policies: [
        {
          PolicyId: 'ANPA1',
          PolicyName: 'old-policy',
          Arn: 'arn:aws:iam::123:policy/old-policy',
          CreateDate: oldDate,
          AttachmentCount: 0,
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.id)).toEqual(['ANPA1']);
  });

  it('does not flag a policy attached to at least one entity', async () => {
    mockSend.mockResolvedValueOnce({
      Policies: [
        {
          PolicyId: 'ANPA2',
          PolicyName: 'used-policy',
          Arn: 'arn:aws:iam::123:policy/used-policy',
          CreateDate: oldDate,
          AttachmentCount: 1,
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a policy tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      Policies: [
        {
          PolicyId: 'ANPA-keep',
          PolicyName: 'keep-policy',
          Arn: 'arn:aws:iam::123:policy/keep-policy',
          CreateDate: oldDate,
          AttachmentCount: 0,
          Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListPoliciesCommand scoped to customer-managed (Local) policies', async () => {
    mockSend.mockResolvedValueOnce({ Policies: [] });

    await scanner.scan(region);

    const args = (ListPoliciesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Scope).toBe('Local');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
