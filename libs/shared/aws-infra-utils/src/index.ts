// SPDX-License-Identifier: Apache-2.0
export { createAwsClientConfig } from './utils/client-config';
export { paginate } from './utils/paginate';
export { mapWithConcurrency } from './utils/map-with-concurrency';
export { assumeRole } from './utils/assume-role';
export { parsePolicyStatements, statementValues, isWildcardPrincipal } from './utils/policy-document';
export type { PolicyStatement } from './utils/policy-document';
export { AwsAdapterError } from './errors/aws-adapter.error';
export { AssumeRoleError } from './errors/assume-role.error';
