import type { PricingPort, AwsRegion } from 'cloud-cost-domain';
import priceTable from './prices.json';

type PriceKey = keyof typeof priceTable.default;
type RegionTable = Record<string, number>;

function lookup(region: AwsRegion, key: PriceKey): number {
  const regionTable = (priceTable as unknown as Record<string, RegionTable>)[region.code];
  if (regionTable?.[key] !== undefined) return regionTable[key];
  return priceTable.default[key];
}

export class StaticPriceTableAdapter implements PricingPort {
  getEbsVolumePricePerGbMonth(region: AwsRegion, volumeType: string): number {
    return lookup(region, `ebs-${volumeType}` as PriceKey) ?? priceTable.default['ebs-gp3'];
  }

  getEbsSnapshotPricePerGbMonth(region: AwsRegion): number {
    return lookup(region, 'ebs-snapshot');
  }

  getElasticIpPricePerMonth(region: AwsRegion): number {
    return lookup(region, 'elastic-ip');
  }

  getRdsStoragePricePerGbMonth(region: AwsRegion, storageType: string): number {
    return lookup(region, `rds-${storageType}` as PriceKey) ?? priceTable.default['rds-gp2'];
  }

  getLoadBalancerPricePerMonth(region: AwsRegion): number {
    return lookup(region, 'load-balancer');
  }

  getNatGatewayPricePerMonth(region: AwsRegion): number {
    return lookup(region, 'nat-gateway');
  }
}
