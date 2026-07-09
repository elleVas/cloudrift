// SPDX-License-Identifier: Apache-2.0
/**
 * Base for errors raised by adapters (AWS SDK calls, file I/O, etc.).
 * Deliberately separate from {@link DomainError}: an infrastructure failure
 * is not a domain concept, so ports type their `Result` failures as `Error`
 * and adapters throw/wrap `InfrastructureError`, never `DomainError`.
 */
export abstract class InfrastructureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
