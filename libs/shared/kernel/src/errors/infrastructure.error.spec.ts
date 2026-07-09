// SPDX-License-Identifier: Apache-2.0
import { DomainError } from './domain.error';
import { InfrastructureError } from './infrastructure.error';

class ConcreteError extends InfrastructureError {
  constructor(detail: string) {
    super('CONCRETE_ERROR', `Concrete error: ${detail}`);
  }
}

describe('InfrastructureError', () => {
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

  it('is an instance of InfrastructureError', () => {
    const err = new ConcreteError('x');
    expect(err).toBeInstanceOf(InfrastructureError);
  });

  it('is an instance of the concrete class', () => {
    const err = new ConcreteError('x');
    expect(err).toBeInstanceOf(ConcreteError);
  });

  it('is not an instance of DomainError — infrastructure errors are a separate hierarchy', () => {
    const err = new ConcreteError('x');
    expect(err).not.toBeInstanceOf(DomainError);
  });
});
