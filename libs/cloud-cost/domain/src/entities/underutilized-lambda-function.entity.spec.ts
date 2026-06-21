import { UnderutilizedLambdaFunction } from './underutilized-lambda-function.entity';
import type { UnderutilizedLambdaFunctionProps } from './underutilized-lambda-function.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeFunction(
  overrides: Partial<UnderutilizedLambdaFunctionProps> = {},
): UnderutilizedLambdaFunction {
  return new UnderutilizedLambdaFunction({
    functionName: 'my-fn',
    region,
    accountId: '123456789012',
    memorySizeMb: 128,
    invocationsLastWindow: 0,
    windowDays: 7,
    lastModified: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    ...overrides,
  });
}

describe('UnderutilizedLambdaFunction', () => {
  it('exposes correct id and fields', () => {
    const fn = makeFunction();
    expect(fn.id).toBe('my-fn');
    expect(fn.memorySizeMb).toBe(128);
    expect(fn.tags).toEqual({ Env: 'dev' });
  });

  it('exposes kind and wasteReason', () => {
    expect(makeFunction().kind).toBe('lambda-underutilized');
    expect(makeFunction({ invocationsLastWindow: 0, windowDays: 7 }).wasteReason).toBe(
      '0 invocations over 7d',
    );
  });

  it('costEstimate is zero (hygiene flag, no direct cost)', () => {
    expect(makeFunction().costEstimate.monthlyCostUsd).toBe(0);
  });
});
