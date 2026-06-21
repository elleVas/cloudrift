import type { PricingPort } from 'cloud-cost-domain';

export const mockPricing: PricingPort = {
  getEbsVolumePricePerGbMonth: (_region, volumeType) =>
    volumeType === 'gp2' ? 0.1 : 0.08,
  getEbsSnapshotPricePerGbMonth: () => 0.05,
  getElasticIpPricePerMonth: () => 3.6,
  getRdsStoragePricePerGbMonth: () => 0.115,
  getLoadBalancerPricePerMonth: () => 16.2,
  getNatGatewayPricePerMonth: () => 32.4,
  getLogGroupPricePerGbMonth: () => 0.03,
  getS3StandardPricePerGbMonth: () => 0.023,
  getEfsStandardPricePerGbMonth: () => 0.3,
  getPricesAsOf: () => '2025-06',
};
