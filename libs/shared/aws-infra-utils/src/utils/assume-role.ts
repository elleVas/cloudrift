// SPDX-License-Identifier: Apache-2.0
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import { AssumeRoleError } from '../errors/assume-role.error';

const DEFAULT_ROLE_SESSION_NAME = 'cloudrift-scan';

/**
 * Assumes an IAM role via STS for cross-account scanning. Resolves the
 * credentials eagerly (invokes the provider once here) so an invalid ARN,
 * a denied trust policy, or a wrong external ID fails loudly right away —
 * this must never silently fall back to ambient credentials, which would
 * scan the wrong account without telling anyone.
 */
export async function assumeRole(
  roleArn: string,
  externalId?: string,
  roleSessionName: string = DEFAULT_ROLE_SESSION_NAME,
): Promise<Result<AwsCredentialIdentityProvider>> {
  const credentials = fromTemporaryCredentials({
    params: {
      RoleArn: roleArn,
      ExternalId: externalId,
      RoleSessionName: roleSessionName,
    },
  });

  try {
    await credentials();
    return Result.ok(credentials);
  } catch (err) {
    return Result.fail(new AssumeRoleError(roleArn, err));
  }
}
