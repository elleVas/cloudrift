import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

/**
 * Risolve l'ID dell'account AWS dalle credenziali correnti via STS.
 * Restituisce undefined se le credenziali non sono disponibili: il chiamante
 * decide come degradare (es. etichettare il report come 'unknown').
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
