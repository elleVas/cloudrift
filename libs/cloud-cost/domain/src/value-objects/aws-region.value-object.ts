// SPDX-License-Identifier: Apache-2.0
// Moved to `cloud-cost-pricing` (see ADR-0098): `AwsRegion` has no dependency
// on this domain's waste-specific model, and the new Terraform drift-detector
// repo needs it too. Re-exported here so existing imports of
// `cloud-cost-domain` keep working unchanged.
export { AwsRegion, InvalidAwsRegionError, AWS_REGION_CODES } from 'cloud-cost-pricing';
