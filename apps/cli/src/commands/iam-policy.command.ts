// SPDX-License-Identifier: Apache-2.0
import { REQUIRED_IAM_POLICY } from '../iam-policy';

/**
 * Prints the read-only IAM policy cloudrift needs, ready to paste into the
 * AWS console or a Terraform/CDK IAM policy document. Same static policy the
 * `get_required_iam_permissions` MCP tool returns — static, no AWS calls.
 */
export function iamPolicyCommand(): void {
  console.log(JSON.stringify(REQUIRED_IAM_POLICY, null, 2));
}
