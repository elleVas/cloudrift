// SPDX-License-Identifier: Apache-2.0
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface PricingPort {
  getEbsVolumePricePerGbMonth(region: AwsRegion, volumeType: string): number;
  getEbsSnapshotPricePerGbMonth(region: AwsRegion): number;
  getElasticIpPricePerMonth(region: AwsRegion): number;
  getRdsStoragePricePerGbMonth(region: AwsRegion, storageType: string): number;
  getLoadBalancerPricePerMonth(region: AwsRegion): number;
  getNatGatewayPricePerMonth(region: AwsRegion): number;
  getLogGroupPricePerGbMonth(region: AwsRegion): number;
  getS3StandardPricePerGbMonth(region: AwsRegion): number;
  getEfsStandardPricePerGbMonth(region: AwsRegion): number;
  getDynamoDbRcuPricePerHour(region: AwsRegion): number;
  getDynamoDbWcuPricePerHour(region: AwsRegion): number;
  /**
   * Fixed-SKU prices for the Phase 5.5 scanners (see ADR-0037/ADR-0038):
   * low cardinality, so — unlike instance/node-type pricing — they fit the
   * static price list and don't require `--live-pricing`.
   */
  getFsxStoragePricePerGbMonth(region: AwsRegion, fileSystemType: string): number;
  getVpnConnectionPricePerMonth(region: AwsRegion): number;
  getTransitGatewayAttachmentPricePerMonth(region: AwsRegion): number;
  /** Per-shard monthly price; the scanner multiplies by the stream's open shard count. */
  getKinesisShardPricePerMonth(region: AwsRegion): number;
  /** Date (YYYY-MM) prices were last verified: must be shown in every report. */
  getPricesAsOf(): string;
}
