// SPDX-License-Identifier: Apache-2.0
import { toCsv } from './csv-utils';

describe('toCsv', () => {
  it('joins headers and rows with commas and newlines', () => {
    expect(toCsv(['a', 'b'], [['1', '2'], ['3', '4']])).toBe('a,b\n1,2\n3,4');
  });

  it('renders null/undefined as an empty field', () => {
    expect(toCsv(['a'], [[null], [undefined]])).toBe('a\n\n');
  });

  it('quotes and escapes a field containing a comma', () => {
    expect(toCsv(['a'], [['1,2']])).toBe('a\n"1,2"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(toCsv(['a'], [['say "hi"']])).toBe('a\n"say ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    expect(toCsv(['a'], [['line1\nline2']])).toBe('a\n"line1\nline2"');
  });

  it('leaves plain numbers and booleans unquoted', () => {
    expect(toCsv(['a', 'b'], [[42, true]])).toBe('a,b\n42,true');
  });
});
