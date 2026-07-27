// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_KINDS, RESOURCE_KIND_META, RESOURCE_KIND_LABELS, categoryOf, isEstimated } from './wasted-resource';

describe('RESOURCE_KIND_META', () => {
  it('has a metadata entry for every declared resource kind', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(RESOURCE_KIND_META[kind]).toBeDefined();
      expect(typeof RESOURCE_KIND_META[kind].label).toBe('string');
      expect(['waste', 'optimization']).toContain(RESOURCE_KIND_META[kind].category);
      expect(typeof RESOURCE_KIND_META[kind].estimated).toBe('boolean');
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
