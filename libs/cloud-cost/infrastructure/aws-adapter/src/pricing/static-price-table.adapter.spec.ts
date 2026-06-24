// SPDX-License-Identifier: Apache-2.0
import { StaticPriceTableAdapter } from './static-price-table.adapter';
import { AwsRegion } from 'cloud-cost-domain';

const adapter = new StaticPriceTableAdapter();
const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');
const apSoutheast1 = AwsRegion.create('ap-southeast-1');
const unknown = AwsRegion.create('ca-central-1'); // not in table → falls back to default

describe('StaticPriceTableAdapter', () => {
  describe('getEbsVolumePricePerGbMonth', () => {
    it('returns us-east-1 gp3 price', () => {
      expect(adapter.getEbsVolumePricePerGbMonth(usEast1, 'gp3')).toBe(0.08);
    });

    it('returns eu-west-1 gp3 price (higher than us-east-1)', () => {
      expect(adapter.getEbsVolumePricePerGbMonth(euWest1, 'gp3')).toBe(0.088);
    });

    it('returns ap-southeast-1 gp2 price', () => {
      expect(adapter.getEbsVolumePricePerGbMonth(apSoutheast1, 'gp2')).toBe(0.114);
    });

    it('falls back to default for unknown region', () => {
      expect(adapter.getEbsVolumePricePerGbMonth(unknown, 'gp3')).toBe(0.08);
    });

    it('falls back to gp3 default for unknown volume type', () => {
      expect(adapter.getEbsVolumePricePerGbMonth(usEast1, 'unknown-type')).toBe(0.08);
    });
  });

  describe('getEbsSnapshotPricePerGbMonth', () => {
    it('returns us-east-1 snapshot price', () => {
      expect(adapter.getEbsSnapshotPricePerGbMonth(usEast1)).toBe(0.05);
    });

    it('returns ap-southeast-1 snapshot price (higher)', () => {
      expect(adapter.getEbsSnapshotPricePerGbMonth(apSoutheast1)).toBe(0.055);
    });
  });

  describe('getElasticIpPricePerMonth', () => {
    it('returns us-east-1 EIP price', () => {
      expect(adapter.getElasticIpPricePerMonth(usEast1)).toBe(3.6);
    });

    it('returns eu-west-1 EIP price (higher)', () => {
      expect(adapter.getElasticIpPricePerMonth(euWest1)).toBe(3.96);
    });
  });

  describe('getRdsStoragePricePerGbMonth', () => {
    it('returns us-east-1 gp2 RDS price', () => {
      expect(adapter.getRdsStoragePricePerGbMonth(usEast1, 'gp2')).toBe(0.115);
    });

    it('returns ap-southeast-1 gp2 RDS price (higher)', () => {
      expect(adapter.getRdsStoragePricePerGbMonth(apSoutheast1, 'gp2')).toBe(0.131);
    });

    it('falls back to gp2 default for unknown storage type', () => {
      expect(adapter.getRdsStoragePricePerGbMonth(usEast1, 'nvme')).toBe(0.115);
    });
  });

  describe('getLoadBalancerPricePerMonth', () => {
    it('returns us-east-1 price', () => {
      expect(adapter.getLoadBalancerPricePerMonth(usEast1)).toBe(16.2);
    });

    it('returns eu-west-1 price (higher)', () => {
      expect(adapter.getLoadBalancerPricePerMonth(euWest1)).toBe(18.4);
    });
  });

  describe('getNatGatewayPricePerMonth', () => {
    it('returns us-east-1 price', () => {
      expect(adapter.getNatGatewayPricePerMonth(usEast1)).toBe(32.4);
    });

    it('returns ap-southeast-1 price (higher)', () => {
      expect(adapter.getNatGatewayPricePerMonth(apSoutheast1)).toBeCloseTo(36.792, 3);
    });

    it('falls back to default for unlisted region', () => {
      expect(adapter.getNatGatewayPricePerMonth(unknown)).toBe(32.4);
    });
  });
});
