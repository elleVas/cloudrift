// SPDX-License-Identifier: Apache-2.0
import { StaticPriceTableAdapter } from './static-price-table.adapter';
import { AwsRegion } from 'cloud-cost-domain';

const adapter = new StaticPriceTableAdapter();
const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');
const apSoutheast1 = AwsRegion.create('ap-southeast-1');
const unknown = AwsRegion.create('ca-central-1'); // not in table → falls back to default

describe('StaticPriceTableAdapter', () => {
  describe('getPrice("ebs-*")', () => {
    it('returns us-east-1 gp3 price', () => {
      expect(adapter.getPrice(usEast1, 'ebs-gp3')).toBe(0.08);
    });

    it('returns eu-west-1 gp3 price (higher than us-east-1)', () => {
      expect(adapter.getPrice(euWest1, 'ebs-gp3')).toBe(0.088);
    });

    it('returns ap-southeast-1 gp2 price', () => {
      expect(adapter.getPrice(apSoutheast1, 'ebs-gp2')).toBe(0.114);
    });

    it('falls back to default for unknown region', () => {
      expect(adapter.getPrice(unknown, 'ebs-gp3')).toBe(0.08);
    });

    it('returns 0 for an unpriced key (callers fall back to a generic key themselves)', () => {
      expect(adapter.getPrice(usEast1, 'ebs-unknown-type')).toBe(0);
    });
  });

  describe('getPrice("ebs-snapshot")', () => {
    it('returns us-east-1 snapshot price', () => {
      expect(adapter.getPrice(usEast1, 'ebs-snapshot')).toBe(0.05);
    });

    it('returns ap-southeast-1 snapshot price (higher)', () => {
      expect(adapter.getPrice(apSoutheast1, 'ebs-snapshot')).toBe(0.055);
    });
  });

  describe('getPrice("elastic-ip")', () => {
    it('returns us-east-1 EIP price', () => {
      expect(adapter.getPrice(usEast1, 'elastic-ip')).toBe(3.6);
    });

    it('returns eu-west-1 EIP price (higher)', () => {
      expect(adapter.getPrice(euWest1, 'elastic-ip')).toBe(3.96);
    });
  });

  describe('getPrice("rds-*")', () => {
    it('returns us-east-1 gp2 RDS price', () => {
      expect(adapter.getPrice(usEast1, 'rds-gp2')).toBe(0.115);
    });

    it('returns ap-southeast-1 gp2 RDS price (higher)', () => {
      expect(adapter.getPrice(apSoutheast1, 'rds-gp2')).toBe(0.131);
    });

    it('returns 0 for an unpriced storage type', () => {
      expect(adapter.getPrice(usEast1, 'rds-nvme')).toBe(0);
    });
  });

  describe('getPrice("load-balancer")', () => {
    it('returns us-east-1 price', () => {
      expect(adapter.getPrice(usEast1, 'load-balancer')).toBe(16.2);
    });

    it('returns eu-west-1 price (higher)', () => {
      expect(adapter.getPrice(euWest1, 'load-balancer')).toBe(18.4);
    });
  });

  describe('getPrice("nat-gateway")', () => {
    it('returns us-east-1 price', () => {
      expect(adapter.getPrice(usEast1, 'nat-gateway')).toBe(32.4);
    });

    it('returns ap-southeast-1 price (higher)', () => {
      expect(adapter.getPrice(apSoutheast1, 'nat-gateway')).toBeCloseTo(36.792, 3);
    });

    it('falls back to default for unlisted region', () => {
      expect(adapter.getPrice(unknown, 'nat-gateway')).toBe(32.4);
    });
  });
});
