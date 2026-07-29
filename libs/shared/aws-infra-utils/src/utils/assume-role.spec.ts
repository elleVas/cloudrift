// SPDX-License-Identifier: Apache-2.0
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { assumeRole } from './assume-role';
import { AssumeRoleError } from '../errors/assume-role.error';

jest.mock('@aws-sdk/credential-providers');

describe('assumeRole', () => {
  const mockFromTemporaryCredentials = fromTemporaryCredentials as jest.Mock;

  afterEach(() => {
    mockFromTemporaryCredentials.mockReset();
  });

  it('builds a credentials provider from the given role ARN and external ID, and resolves it eagerly', async () => {
    const resolved = { accessKeyId: 'AKIA...', secretAccessKey: 'secret', sessionToken: 'token' };
    const provider = jest.fn().mockResolvedValue(resolved);
    mockFromTemporaryCredentials.mockReturnValue(provider);

    const result = await assumeRole('arn:aws:iam::222222222222:role/CloudriftReadOnly', 'my-external-id');

    expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
      params: {
        RoleArn: 'arn:aws:iam::222222222222:role/CloudriftReadOnly',
        ExternalId: 'my-external-id',
        RoleSessionName: 'cloudrift-scan',
      },
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: provider });
  });

  it('works without an external ID', async () => {
    const provider = jest.fn().mockResolvedValue({});
    mockFromTemporaryCredentials.mockReturnValue(provider);

    await assumeRole('arn:aws:iam::222222222222:role/CloudriftReadOnly');

    expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
      params: {
        RoleArn: 'arn:aws:iam::222222222222:role/CloudriftReadOnly',
        ExternalId: undefined,
        RoleSessionName: 'cloudrift-scan',
      },
    });
  });

  it('fails loudly instead of returning an unresolved provider when the role cannot be assumed', async () => {
    const provider = jest.fn().mockRejectedValue(new Error('AccessDenied: not authorized to perform sts:AssumeRole'));
    mockFromTemporaryCredentials.mockReturnValue(provider);

    const result = await assumeRole('arn:aws:iam::222222222222:role/CloudriftReadOnly');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(AssumeRoleError);
    expect(!result.ok && result.error.message).toContain('AccessDenied');
  });

  it('uses a custom role session name when given', async () => {
    const provider = jest.fn().mockResolvedValue({});
    mockFromTemporaryCredentials.mockReturnValue(provider);

    await assumeRole('arn:aws:iam::222222222222:role/CloudriftReadOnly', undefined, 'my-session');

    expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ RoleSessionName: 'my-session' }) }),
    );
  });
});
