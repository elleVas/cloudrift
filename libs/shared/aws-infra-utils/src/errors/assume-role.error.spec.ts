// SPDX-License-Identifier: Apache-2.0
import { AssumeRoleError } from './assume-role.error';

describe('AssumeRoleError', () => {
  it('wraps the cause with the target role ARN in the message', () => {
    const err = new AssumeRoleError('arn:aws:iam::222222222222:role/CloudriftReadOnly', new Error('AccessDenied'));

    expect(err.roleArn).toBe('arn:aws:iam::222222222222:role/CloudriftReadOnly');
    expect(err.message).toBe('Failed to assume role arn:aws:iam::222222222222:role/CloudriftReadOnly: AccessDenied');
    expect(err.cause.message).toBe('AccessDenied');
  });

  it('normalizes a non-Error cause into a real Error', () => {
    const err = new AssumeRoleError('arn:aws:iam::222222222222:role/CloudriftReadOnly', 'access denied');

    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause.message).toBe('access denied');
  });
});
