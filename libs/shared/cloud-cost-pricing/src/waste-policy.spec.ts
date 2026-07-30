// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, waste, notWaste, DEFAULT_MIN_AGE_DAYS, DEFAULT_IGNORE_TAG, type WasteVerdict } from './waste-policy';

interface FakeResource {
  tags: Record<string, string>;
  createdAt: Date;
}

class FakeIdlePolicy extends WastePolicy<FakeResource> {
  protected judge(resource: FakeResource, now: Date): WasteVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('idle');
  }
}

describe('waste()/notWaste()', () => {
  it('builds a positive verdict', () => {
    expect(waste('reason')).toEqual({ isWaste: true, reason: 'reason' });
  });

  it('builds a negative verdict', () => {
    expect(notWaste('reason')).toEqual({ isWaste: false, reason: 'reason' });
  });
});

describe('WastePolicy', () => {
  const now = new Date('2026-07-30T00:00:00Z');
  const old = new Date('2026-01-01T00:00:00Z');

  it('excludes a resource carrying the default ignore tag', () => {
    const policy = new FakeIdlePolicy();
    const resource: FakeResource = { tags: { [DEFAULT_IGNORE_TAG]: 'true' }, createdAt: old };
    expect(policy.evaluate(resource, now)).toEqual(notWaste(`excluded by tag ${DEFAULT_IGNORE_TAG}`));
  });

  it('excludes a resource carrying a custom ignore tag', () => {
    const policy = new FakeIdlePolicy({ ignoreTag: 'skip-me' });
    const resource: FakeResource = { tags: { 'skip-me': 'yes' }, createdAt: old };
    expect(policy.evaluate(resource, now)).toEqual(notWaste('excluded by tag skip-me'));
  });

  it('excludes a resource matching an excludeTagValues pair', () => {
    const policy = new FakeIdlePolicy({ excludeTagValues: { Environment: 'Production' } });
    const resource: FakeResource = { tags: { Environment: 'Production' }, createdAt: old };
    expect(policy.evaluate(resource, now)).toEqual(notWaste('excluded by tag Environment=Production'));
  });

  it('does not exclude a resource whose tags do not match excludeTagValues', () => {
    const policy = new FakeIdlePolicy({ excludeTagValues: { Environment: 'Production' } });
    const resource: FakeResource = { tags: { Environment: 'Staging' }, createdAt: old };
    expect(policy.evaluate(resource, now)).toEqual(waste('idle'));
  });

  it('defers to judge() when no exclusion applies', () => {
    const policy = new FakeIdlePolicy();
    const resource: FakeResource = { tags: {}, createdAt: old };
    expect(policy.evaluate(resource, now)).toEqual(waste('idle'));
  });

  it('honors the default grace period', () => {
    const policy = new FakeIdlePolicy();
    const recentlyCreated: FakeResource = { tags: {}, createdAt: now };
    expect(policy.evaluate(recentlyCreated, now)).toEqual(notWaste(`created less than ${DEFAULT_MIN_AGE_DAYS}d ago`));
  });

  it('honors a custom grace period', () => {
    const policy = new FakeIdlePolicy({ minAgeDays: 30 });
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    const resource: FakeResource = { tags: {}, createdAt: twentyDaysAgo };
    expect(policy.evaluate(resource, now)).toEqual(notWaste('created less than 30d ago'));
  });

  it('defaults `now` to the current time when not passed', () => {
    const policy = new FakeIdlePolicy();
    const resource: FakeResource = { tags: {}, createdAt: old };
    expect(policy.evaluate(resource)).toEqual(waste('idle'));
  });
});
