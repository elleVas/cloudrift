// SPDX-License-Identifier: Apache-2.0
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META } from './dead-resource';

describe('DEAD_RESOURCE_KIND_META', () => {
  it('has a metadata entry for every declared kind', () => {
    for (const kind of DEAD_RESOURCE_KINDS) {
      expect(DEAD_RESOURCE_KIND_META[kind]).toBeDefined();
      expect(typeof DEAD_RESOURCE_KIND_META[kind].label).toBe('string');
      expect(['regional', 'global']).toContain(DEAD_RESOURCE_KIND_META[kind].scope);
    }
  });
});
