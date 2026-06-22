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
  /** Date (YYYY-MM) prices were last verified: must be shown in every report. */
  getPricesAsOf(): string;
}
