/** Structured error for schema validation failures */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly expected?: string,
    public readonly received?: string,
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}
