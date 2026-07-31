// SPDX-License-Identifier: Apache-2.0
import { LambdaClient, ListFunctionsCommand, GetPolicyCommand, type FunctionConfiguration } from '@aws-sdk/client-lambda';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { LambdaFunctionPolicyPublic, LambdaFunctionPolicyPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, isWildcardPrincipal } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-function `GetPolicy` calls in flight at once. */
const FUNCTION_CHECK_CONCURRENCY = 8;

type FunctionWithArn = FunctionConfiguration & { FunctionName: string; FunctionArn: string };

function isPublicPolicy(policyJson: string | undefined): boolean {
  return parsePolicyStatements(policyJson).some((s) => s.Effect === 'Allow' && isWildcardPrincipal(s.Principal) && s.Condition === undefined);
}

/** Detects Lambda functions with a resource policy granting access to any AWS principal, with no restricting condition. */
export class AwsLambdaFunctionPolicyPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'lambda-function-policy-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new LambdaFunctionPolicyPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new LambdaClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawFunctions = await paginate<FunctionConfiguration>(async (cursor) => {
        const r = await client.send(new ListFunctionsCommand({ Marker: cursor }));
        return { items: r.Functions ?? [], cursor: r.NextMarker };
      });
      const validFunctions = rawFunctions.filter((f): f is FunctionWithArn => !!f.FunctionName && !!f.FunctionArn);
      const now = new Date();

      const candidates = await mapWithConcurrency(validFunctions, FUNCTION_CHECK_CONCURRENCY, async (fn) => {
        try {
          const { Policy } = await client.send(new GetPolicyCommand({ FunctionName: fn.FunctionName }));
          if (!isPublicPolicy(Policy)) return undefined;
          return new LambdaFunctionPolicyPublic({ functionName: fn.FunctionName, functionArn: fn.FunctionArn, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          // No policy at all (`ResourceNotFoundException`) is the common case and isn't public;
          // any other per-function error also shouldn't fail the whole scan.
          logger.debug('lambda-function-policy-public: skipping function after error', { functionName: fn.FunctionName, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is LambdaFunctionPolicyPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Lambda', err));
    } finally {
      client.destroy();
    }
  }
}
