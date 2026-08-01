// SPDX-License-Identifier: Apache-2.0
import { stepDownOneSize } from './instance-step-down';

describe('stepDownOneSize', () => {
  it('steps down one tier within the same EC2 family', () => {
    expect(stepDownOneSize('m5.2xlarge')).toBe('m5.xlarge');
    expect(stepDownOneSize('m5.xlarge')).toBe('m5.large');
    expect(stepDownOneSize('t3.small')).toBe('t3.micro');
  });

  it('steps down an RDS instance class, preserving the db. prefix', () => {
    expect(stepDownOneSize('db.r5.large')).toBe('db.r5.medium');
    expect(stepDownOneSize('db.m5.2xlarge')).toBe('db.m5.xlarge');
  });

  it('steps down non-adjacent tiers (e.g. 4xlarge -> 3xlarge)', () => {
    expect(stepDownOneSize('c5.4xlarge')).toBe('c5.3xlarge');
    expect(stepDownOneSize('c5.24xlarge')).toBe('c5.18xlarge');
  });

  it('returns null for the smallest known tier', () => {
    expect(stepDownOneSize('t3.nano')).toBeNull();
    expect(stepDownOneSize('db.t3.nano')).toBeNull();
  });

  it('returns null for metal sizes (no fixed position across families)', () => {
    expect(stepDownOneSize('m5.metal')).toBeNull();
  });

  it('returns null for unparseable or unknown-size types', () => {
    expect(stepDownOneSize('unknown')).toBeNull();
    expect(stepDownOneSize('m5.notareal-size')).toBeNull();
  });
});
