# shared-kernel

Domain-agnostic building blocks shared across all bounded contexts.

## Contents

### `Entity<TId>`

Base class for domain entities. Identity is determined by `id`, not structural equality.

```typescript
class MyEntity extends Entity<string> {
  constructor(id: string) { super(id); }
}

const a = new MyEntity('123');
a.id;          // '123'
a.equals(b);   // true if b.id === '123'
```

### `ValueObject<T>`

Base class for immutable value objects. Equality is structural (deep compare of props).

```typescript
class Money extends ValueObject<{ amount: number; currency: string }> {}

const a = new Money({ amount: 10, currency: 'USD' });
const b = new Money({ amount: 10, currency: 'USD' });
a.equals(b); // true
```

### `Result<T, E>`

Railway-oriented error handling — no exceptions crossing layer boundaries.

```typescript
// Producing results
Result.ok(value)      // Success<T>
Result.fail(error)    // Failure<E>

// Consuming results
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error.message);
}
```

### `DomainError`

Base class for typed domain errors. Preserves the prototype chain for `instanceof` checks.

```typescript
class NotFoundError extends DomainError {
  constructor(id: string) {
    super('NOT_FOUND', `Entity ${id} not found`);
  }
}
```

## Building

```sh
pnpm nx build shared-kernel
```

## Testing

```sh
pnpm nx test shared-kernel
```
