import { Result } from './result.type';

describe('Result', () => {
  describe('Result.ok', () => {
    it('sets ok to true and wraps the value', () => {
      const result = Result.ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(42);
    });

    it('works with non-primitive values', () => {
      const payload = { id: '1', name: 'test' };
      const result = Result.ok(payload);
      if (result.ok) expect(result.value).toBe(payload);
    });

    it('works with null', () => {
      const result = Result.ok(null);
      if (result.ok) expect(result.value).toBeNull();
    });
  });

  describe('Result.fail', () => {
    it('sets ok to false and wraps the error', () => {
      const err = new Error('boom');
      const result = Result.fail(err);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(err);
    });

    it('preserves the error message', () => {
      const result = Result.fail(new Error('something went wrong'));
      if (!result.ok) expect(result.error.message).toBe('something went wrong');
    });
  });

  it('ok result is not a failure', () => {
    const result = Result.ok('value');
    expect(result.ok).toBe(true);
  });

  it('fail result is not a success', () => {
    const result = Result.fail(new Error('x'));
    expect(result.ok).toBe(false);
  });
});
