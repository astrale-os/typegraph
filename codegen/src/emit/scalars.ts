// Scalar → TypeScript / Zod mapping tables.
// Extend these when new built-in scalars are added to the compiler prelude.

const SCALAR_TS: Record<string, string> = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  Timestamp: 'string',
  Bitmask: 'number',
  ByteString: 'string',
}

const SCALAR_ZOD: Record<string, string> = {
  String: 'z.string()',
  Int: 'z.number().int()',
  Float: 'z.number()',
  Boolean: 'z.boolean()',
  Timestamp: 'z.string()',
  Bitmask: 'z.number().int()',
  ByteString: 'z.string()',
}

export function scalarToTs(name: string): string {
  return SCALAR_TS[name] ?? 'unknown'
}

export function scalarToZod(name: string): string {
  return SCALAR_ZOD[name] ?? 'z.unknown()'
}
