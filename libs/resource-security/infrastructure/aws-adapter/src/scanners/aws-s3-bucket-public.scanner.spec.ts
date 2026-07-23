// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, GetPublicAccessBlockCommand, GetBucketPolicyStatusCommand, GetBucketAclCommand } from '@aws-sdk/client-s3';
import { AwsS3BucketPublicScanner } from './aws-s3-bucket-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-s3');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3BucketPublicScanner();

const notBlocked = Object.assign(new Error('not configured'), { name: 'NoSuchPublicAccessBlockConfiguration' });
const noPolicy = Object.assign(new Error('no policy'), { name: 'NoSuchBucketPolicy' });

function mockClient(handlers: {
  publicAccessBlock?: () => Promise<unknown>;
  policyStatus?: () => Promise<unknown>;
  acl?: () => Promise<unknown>;
}) {
  mockSend.mockImplementation((command: unknown) => {
    if (command instanceof ListBucketsCommand) return Promise.resolve({ Buckets: [{ Name: 'my-bucket' }] });
    if (command instanceof GetPublicAccessBlockCommand) return (handlers.publicAccessBlock ?? (() => Promise.reject(notBlocked)))();
    if (command instanceof GetBucketPolicyStatusCommand) return (handlers.policyStatus ?? (() => Promise.reject(noPolicy)))();
    if (command instanceof GetBucketAclCommand) return (handlers.acl ?? (() => Promise.resolve({ Grants: [] })))();
    throw new Error('unexpected command');
  });
}

describe('AwsS3BucketPublicScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('s3-bucket-public');
    expect(scanner.scope).toBe('global');
  });

  it('flags a bucket with a public policy', async () => {
    mockClient({ policyStatus: () => Promise.resolve({ PolicyStatus: { IsPublic: true } }) });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['my-bucket']);
  });

  it('flags a bucket with a public ACL grant', async () => {
    mockClient({
      acl: () =>
        Promise.resolve({
          Grants: [{ Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' }],
        }),
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a bucket with full public access block enabled, even if the ACL looks public', async () => {
    mockClient({
      publicAccessBlock: () =>
        Promise.resolve({
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      acl: () =>
        Promise.resolve({
          Grants: [{ Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' }],
        }),
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a private bucket', async () => {
    mockClient({});

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a bucket that errors on a per-bucket call without failing the whole scan', async () => {
    mockClient({ acl: () => Promise.reject(new Error('AccessDenied')) });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError when ListBuckets itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
