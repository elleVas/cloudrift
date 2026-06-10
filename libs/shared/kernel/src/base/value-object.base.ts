export abstract class ValueObject<T extends object> {
  constructor(protected readonly props: Readonly<T>) {}

  equals(other: ValueObject<T>): boolean {
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
