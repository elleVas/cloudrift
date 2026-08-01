// SPDX-License-Identifier: Apache-2.0
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_META,
  RESOURCE_KIND_LABELS,
  categoryOf,
  isEstimated,
  effortOf,
  confidenceOf,
} from './wasted-resource';

describe('RESOURCE_KIND_META', () => {
  it('has a metadata entry for every declared resource kind', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(RESOURCE_KIND_META[kind]).toBeDefined();
      expect(typeof RESOURCE_KIND_META[kind].label).toBe('string');
      expect(['waste', 'optimization']).toContain(RESOURCE_KIND_META[kind].category);
      expect(typeof RESOURCE_KIND_META[kind].estimated).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(RESOURCE_KIND_META[kind].effort);
    }
  });
});

describe('RESOURCE_KIND_LABELS', () => {
  it('derives one label per kind, matching RESOURCE_KIND_META', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(RESOURCE_KIND_LABELS[kind]).toBe(RESOURCE_KIND_META[kind].label);
    }
  });
});

describe('categoryOf', () => {
  it('returns "waste" for a waste-category kind', () => {
    expect(categoryOf('ebs-volume')).toBe('waste');
  });

  it('returns "optimization" for an optimization-category kind', () => {
    expect(categoryOf('ebs-gp2-upgrade')).toBe('optimization');
  });
});

describe('isEstimated', () => {
  it('returns false for a kind with a definite cost', () => {
    expect(isEstimated('ebs-volume')).toBe(false);
  });

  it('returns true for a kind with a heuristic cost estimate', () => {
    expect(isEstimated('ec2-underutilized')).toBe(true);
  });
});

describe('effortOf', () => {
  it('returns "low" for a pure delete/detach kind', () => {
    expect(effortOf('ebs-volume')).toBe('low');
  });

  it('returns "high" for a kind needing downtime/coordination', () => {
    expect(effortOf('rds-instance')).toBe('high');
  });
});

describe('confidenceOf', () => {
  it('returns "measured" for every waste-category kind', () => {
    for (const kind of RESOURCE_KINDS) {
      if (RESOURCE_KIND_META[kind].category === 'waste') {
        expect(confidenceOf(kind)).toBe('measured');
      }
    }
  });

  it('returns "derived" for optimization kinds priced from a real price difference', () => {
    expect(confidenceOf('ebs-gp2-upgrade')).toBe('derived');
    expect(confidenceOf('ec2-underutilized')).toBe('derived');
    expect(confidenceOf('rds-underutilized')).toBe('derived');
    expect(confidenceOf('dynamodb-overprovisioned')).toBe('derived');
    expect(confidenceOf('aurora-serverless-overprovisioned')).toBe('derived');
    expect(confidenceOf('eks-node-overprovisioned')).toBe('derived');
  });

  it('returns "heuristic" for optimization kinds with no real dollar basis', () => {
    expect(confidenceOf('s3-no-lifecycle')).toBe('heuristic');
    expect(confidenceOf('lambda-underutilized')).toBe('heuristic');
    expect(confidenceOf('sagemaker-training-orphaned')).toBe('heuristic');
  });

  it('every optimization-category kind is classified derived or heuristic, none left unclassified', () => {
    const optimizationKinds = RESOURCE_KINDS.filter((k) => RESOURCE_KIND_META[k].category === 'optimization');
    for (const kind of optimizationKinds) {
      expect(['derived', 'heuristic']).toContain(confidenceOf(kind));
    }
    // Pins the exact count so a future new optimization-category kind can't
    // silently fall through into "heuristic" by default without a reviewer
    // noticing this test needs updating too.
    expect(optimizationKinds).toHaveLength(9);
  });
});
