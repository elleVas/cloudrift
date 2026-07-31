// SPDX-License-Identifier: Apache-2.0
import { parsePolicyStatements, statementValues, isWildcardPrincipal } from './policy-document';

describe('parsePolicyStatements', () => {
  it('returns [] for undefined input', () => {
    expect(parsePolicyStatements(undefined)).toEqual([]);
  });

  it('returns [] for unparseable JSON', () => {
    expect(parsePolicyStatements('not json')).toEqual([]);
  });

  it('normalizes a single statement object into an array', () => {
    const doc = JSON.stringify({ Statement: { Effect: 'Allow', Principal: '*' } });
    expect(parsePolicyStatements(doc)).toEqual([{ Effect: 'Allow', Principal: '*' }]);
  });

  it('passes through a statement array unchanged', () => {
    const doc = JSON.stringify({ Statement: [{ Effect: 'Allow' }, { Effect: 'Deny' }] });
    expect(parsePolicyStatements(doc)).toHaveLength(2);
  });

  it('returns [] when Statement is missing', () => {
    expect(parsePolicyStatements(JSON.stringify({}))).toEqual([]);
  });
});

describe('statementValues', () => {
  it('wraps a single string in an array', () => {
    expect(statementValues('*')).toEqual(['*']);
  });

  it('passes an array through unchanged', () => {
    expect(statementValues(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for undefined', () => {
    expect(statementValues(undefined)).toEqual([]);
  });
});

describe('isWildcardPrincipal', () => {
  it('is true for the bare string "*"', () => {
    expect(isWildcardPrincipal('*')).toBe(true);
  });

  it('is true for { AWS: "*" }', () => {
    expect(isWildcardPrincipal({ AWS: '*' })).toBe(true);
  });

  it('is true for { AWS: ["123456789012", "*"] }', () => {
    expect(isWildcardPrincipal({ AWS: ['123456789012', '*'] })).toBe(true);
  });

  it('is false for a scoped account principal', () => {
    expect(isWildcardPrincipal({ AWS: 'arn:aws:iam::123456789012:root' })).toBe(false);
  });

  it('is false for a service principal', () => {
    expect(isWildcardPrincipal({ Service: 'lambda.amazonaws.com' })).toBe(false);
  });

  it('is false for undefined/null', () => {
    expect(isWildcardPrincipal(undefined)).toBe(false);
    expect(isWildcardPrincipal(null)).toBe(false);
  });
});
