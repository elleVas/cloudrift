// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, EbsVolume, ElasticIp } from 'cloud-cost-domain';
import { rowFor, recommendFor } from './resource-presenters';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-07-10T10:00:00Z');

const ebsVolume = new EbsVolume({
  volumeId: 'vol-1',
  region,
  accountId: '123456789012',
  sizeGb: 100,
  volumeType: 'gp3',
  state: 'available',
  createTime: now,
  detectedAt: now,
  tags: {},
  monthlyCostUsd: 8,
});

const elasticIp = new ElasticIp({
  allocationId: 'eipalloc-1',
  publicIp: '1.2.3.4',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
  monthlyCostUsd: 3.6,
});

describe('rowFor / recommendFor', () => {
  it('dispatches to the matching presenter based on the finding itself', () => {
    expect(rowFor(ebsVolume)).toContain('vol-1');
    expect(recommendFor(ebsVolume)).toContain('vol-1');
    expect(rowFor(elasticIp)).toContain('1.2.3.4');
    expect(recommendFor(elasticIp)).toContain('1.2.3.4');
  });

  // There is no "mismatched kind" case to test here: rowFor/recommendFor take
  // a single finding and switch on its own `.kind` — there is no separate
  // (kind, finding) pair a caller could decouple. See docs/code-review-2026-07-10.md
  // point #2 for why this replaced an earlier presenterFor(kind).row(finding)
  // design where that decoupling was possible.
});
