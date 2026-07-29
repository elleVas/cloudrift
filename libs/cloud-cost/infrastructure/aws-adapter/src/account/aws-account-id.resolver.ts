// SPDX-License-Identifier: Apache-2.0
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentityProvider } from '@smithy/types';

/**
 * Resolves the AWS account ID from the current credentials via STS.
 * Returns undefined if credentials are not available: the caller decides
 * how to degrade (e.g. labeling the report as 'unknown'). Passing
 * `credentials` (e.g. from `assumeRole()`) makes this reflect the assumed
 * identity rather than the caller's own — no separate "which account did we
 * actually scan" bookkeeping is needed elsewhere.
 */
export async function resolveAwsAccountId(credentials?: AwsCredentialIdentityProvider): Promise<string | undefined> {
  const client = new STSClient({ credentials });
  try {
    const identity = await client.send(new GetCallerIdentityCommand({}));
    return identity.Account;
  } catch {
    return undefined;
  } finally {
    client.destroy();
  }
}
