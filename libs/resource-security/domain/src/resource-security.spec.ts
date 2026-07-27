// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META } from './resource-security';

describe('RESOURCE_SECURITY_KIND_META', () => {
  it('has a metadata entry for every declared kind', () => {
    for (const kind of RESOURCE_SECURITY_KINDS) {
      expect(RESOURCE_SECURITY_KIND_META[kind]).toBeDefined();
      expect(typeof RESOURCE_SECURITY_KIND_META[kind].label).toBe('string');
      expect(['regional', 'global']).toContain(RESOURCE_SECURITY_KIND_META[kind].scope);
    }
  });
});
