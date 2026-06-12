import { AwsRegion, InvalidAwsRegionError } from './aws-region.value-object';

describe('AwsRegion', () => {
  it('creates a valid region', () => {
    const region = AwsRegion.create('us-east-1');
    expect(region.code).toBe('us-east-1');
  });

  it('creates all common commercial regions without throwing', () => {
    const regions = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1',
    ];
    for (const code of regions) {
      expect(() => AwsRegion.create(code)).not.toThrow();
    }
  });

  it('parse returns ok for a valid region', () => {
    const result = AwsRegion.parse('eu-west-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.code).toBe('eu-west-1');
  });

  it('parse returns a typed failure for an invalid region', () => {
    const result = AwsRegion.parse('banana');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidAwsRegionError);
      expect(result.error.code).toBe('INVALID_AWS_REGION');
      expect(result.error.message).toContain('banana');
    }
  });

  it('throws for a completely invalid string', () => {
    expect(() => AwsRegion.create('banana')).toThrow('Invalid AWS region: "banana"');
  });

  it('throws for a partial region code', () => {
    expect(() => AwsRegion.create('us-east')).toThrow('Invalid AWS region');
  });

  it('throws for an empty string', () => {
    expect(() => AwsRegion.create('')).toThrow('Invalid AWS region');
  });

  it('two regions with the same code are equal', () => {
    expect(AwsRegion.create('eu-west-1').equals(AwsRegion.create('eu-west-1'))).toBe(true);
  });

  it('two regions with different codes are not equal', () => {
    expect(AwsRegion.create('eu-west-1').equals(AwsRegion.create('us-east-1'))).toBe(false);
  });

  it('toString returns the region code', () => {
    expect(AwsRegion.create('ap-southeast-1').toString()).toBe('ap-southeast-1');
  });
});
