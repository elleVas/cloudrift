import { DomainError } from './domain.error';

class ConcreteError extends DomainError {
  constructor(detail: string) {
    super('CONCRETE_ERROR', `Concrete error: ${detail}`);
  }
}

describe('DomainError', () => {
  it('sets the message from the constructor argument', () => {
    const err = new ConcreteError('bad input');
    expect(err.message).toBe('Concrete error: bad input');
  });

  it('exposes the typed code', () => {
    const err = new ConcreteError('x');
    expect(err.code).toBe('CONCRETE_ERROR');
  });

  it('sets name to the concrete class name', () => {
    const err = new ConcreteError('x');
    expect(err.name).toBe('ConcreteError');
  });

  it('is an instance of Error', () => {
    const err = new ConcreteError('x');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of DomainError', () => {
    const err = new ConcreteError('x');
    expect(err).toBeInstanceOf(DomainError);
  });

  it('is an instance of the concrete class', () => {
    const err = new ConcreteError('x');
    expect(err).toBeInstanceOf(ConcreteError);
  });
});
