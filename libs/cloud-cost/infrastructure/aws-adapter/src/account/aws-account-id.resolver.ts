import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

/**
 * Resolves the AWS account ID from the current credentials via STS.
 * Returns undefined if credentials are not available: the caller decides
 * how to degrade (e.g. labeling the report as 'unknown').
 */
export async function resolveAwsAccountId(): Promise<string | undefined> {
  const client = new STSClient({});
  try {
    const identity = await client.send(new GetCallerIdentityCommand({}));
    return identity.Account;
  } catch {
    return undefined;
  } finally {
    client.destroy();
  }
}
