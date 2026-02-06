/**
 * Binary Varint Encoding for Identity Expressions
 *
 * Zero-dependency binary encoding for maximum compression.
 *
 * Type Tags:
 * - 0x01 = Identity
 * - 0x03 = Scope
 * - 0x10 = Union
 * - 0x11 = Intersect
 * - 0x12 = Exclude
 * - 0x20 = Reference (for deduped expressions)
 * - 0x30 = Deduped wrapper (defs + root)
 *
 * Union/Intersect: TAG + varint(operand count) + operands
 * Exclude: TAG + base + varint(excluded count) + excluded operands
 * Scope: TAG + varint(scope count) + scopes + inner expr
 */

import type { IdentityExpr, Scope } from '../types'
import { isDedupedExpr, isRef, type DedupedExpr, type RefExpr } from './dedup'
import { toCompactJSON } from './compact'

// =============================================================================
// TYPE TAGS
// =============================================================================

const TAG_IDENTITY = 0x01
const TAG_SCOPE = 0x03
const TAG_UNION = 0x10
const TAG_INTERSECT = 0x11
const TAG_EXCLUDE = 0x12
const TAG_REF = 0x20
const TAG_DEDUPED = 0x30

// Scope flags
const SCOPE_HAS_NODES = 0x01
const SCOPE_HAS_PERMS = 0x02
const SCOPE_HAS_PRINCIPALS = 0x04

// Depth limit (consistent with compact.ts)
const MAX_DEPTH = 100

// =============================================================================
// BUFFER WRITER
// =============================================================================

class BufferWriter {
  private chunks: Uint8Array[] = []
  private current: Uint8Array
  private offset: number = 0
  private static readonly encoder = new TextEncoder()

  constructor(initialSize: number = 256) {
    this.current = new Uint8Array(initialSize)
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed <= this.current.length) return

    // Save current chunk and allocate new one
    this.chunks.push(this.current.subarray(0, this.offset))
    const newSize = Math.max(this.current.length * 2, needed)
    this.current = new Uint8Array(newSize)
    this.offset = 0
  }

  writeByte(value: number): void {
    this.ensureCapacity(1)
    this.current[this.offset++] = value & 0xff
  }

  writeVarint(value: number): void {
    while (value >= 0x80) {
      this.writeByte((value & 0x7f) | 0x80)
      value >>>= 7
    }
    this.writeByte(value)
  }

  writeString(str: string): void {
    const bytes = BufferWriter.encoder.encode(str)
    this.writeVarint(bytes.length)
    this.ensureCapacity(bytes.length)
    this.current.set(bytes, this.offset)
    this.offset += bytes.length
  }

  toUint8Array(): Uint8Array {
    // Combine all chunks
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0) + this.offset
    const result = new Uint8Array(totalLength)
    let pos = 0
    for (const chunk of this.chunks) {
      result.set(chunk, pos)
      pos += chunk.length
    }
    result.set(this.current.subarray(0, this.offset), pos)
    return result
  }
}

// =============================================================================
// BUFFER READER
// =============================================================================

class BufferReader {
  private offset: number = 0
  private static readonly decoder = new TextDecoder()

  constructor(private buffer: Uint8Array) {}

  get remaining(): number {
    return this.buffer.length - this.offset
  }

  readByte(): number {
    if (this.offset >= this.buffer.length) {
      throw new Error('Unexpected end of buffer')
    }
    return this.buffer[this.offset++]!
  }

  readVarint(): number {
    let result = 0
    let shift = 0
    let byte: number

    do {
      if (shift >= 35) {
        throw new Error('Varint too long, possible data corruption')
      }
      byte = this.readByte()
      result |= (byte & 0x7f) << shift
      shift += 7
    } while (byte >= 0x80)

    return result >>> 0 // Ensure unsigned
  }

  readString(): string {
    const length = this.readVarint()
    // Use subtraction to avoid potential overflow with addition
    if (length > this.buffer.length - this.offset) {
      throw new Error('String length exceeds buffer')
    }
    const bytes = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return BufferReader.decoder.decode(bytes)
  }
}

// =============================================================================
// SCOPE ENCODING
// =============================================================================

function writeScope(writer: BufferWriter, scope: Scope): void {
  let flags = 0
  if (scope.nodes && scope.nodes.length > 0) flags |= SCOPE_HAS_NODES
  if (scope.perms && scope.perms.length > 0) flags |= SCOPE_HAS_PERMS
  if (scope.principals && scope.principals.length > 0) flags |= SCOPE_HAS_PRINCIPALS

  writer.writeByte(flags)

  if (flags & SCOPE_HAS_NODES) {
    writer.writeVarint(scope.nodes!.length)
    for (const node of scope.nodes!) {
      writer.writeString(node)
    }
  }

  if (flags & SCOPE_HAS_PERMS) {
    writer.writeVarint(scope.perms!.length)
    for (const perm of scope.perms!) {
      writer.writeString(perm)
    }
  }

  if (flags & SCOPE_HAS_PRINCIPALS) {
    writer.writeVarint(scope.principals!.length)
    for (const principal of scope.principals!) {
      writer.writeString(principal)
    }
  }
}

function readScope(reader: BufferReader): Scope {
  const flags = reader.readByte()
  const scope: Scope = {}

  if (flags & SCOPE_HAS_NODES) {
    const count = reader.readVarint()
    scope.nodes = []
    for (let i = 0; i < count; i++) {
      scope.nodes.push(reader.readString())
    }
  }

  if (flags & SCOPE_HAS_PERMS) {
    const count = reader.readVarint()
    scope.perms = []
    for (let i = 0; i < count; i++) {
      scope.perms.push(reader.readString())
    }
  }

  if (flags & SCOPE_HAS_PRINCIPALS) {
    const count = reader.readVarint()
    scope.principals = []
    for (let i = 0; i < count; i++) {
      scope.principals.push(reader.readString())
    }
  }

  return scope
}

// =============================================================================
// EXPRESSION ENCODING
// =============================================================================

function writeExpr(writer: BufferWriter, expr: IdentityExpr, depth: number = 0): void {
  if (depth > MAX_DEPTH) {
    throw new Error('Expression too deeply nested (binary encoding)')
  }

  switch (expr.kind) {
    case 'identity':
      writer.writeByte(TAG_IDENTITY)
      writer.writeString(expr.id)
      break

    case 'scope':
      writer.writeByte(TAG_SCOPE)
      writer.writeVarint(expr.scopes.length)
      for (const scope of expr.scopes) {
        writeScope(writer, scope)
      }
      writeExpr(writer, expr.expr, depth + 1)
      break

    case 'union':
      writer.writeByte(TAG_UNION)
      writer.writeVarint(expr.operands.length)
      for (const op of expr.operands) {
        writeExpr(writer, op, depth + 1)
      }
      break

    case 'intersect':
      writer.writeByte(TAG_INTERSECT)
      writer.writeVarint(expr.operands.length)
      for (const op of expr.operands) {
        writeExpr(writer, op, depth + 1)
      }
      break

    case 'exclude':
      writer.writeByte(TAG_EXCLUDE)
      writeExpr(writer, expr.base, depth + 1)
      writer.writeVarint(expr.excluded.length)
      for (const ex of expr.excluded) {
        writeExpr(writer, ex, depth + 1)
      }
      break
  }
}

function writeRefExpr(writer: BufferWriter, expr: RefExpr, depth: number = 0): void {
  if (depth > MAX_DEPTH) {
    throw new Error('Expression too deeply nested (binary encoding)')
  }

  if (isRef(expr)) {
    writer.writeByte(TAG_REF)
    writer.writeVarint(expr.$ref)
    return
  }

  switch (expr.kind) {
    case 'identity':
      writer.writeByte(TAG_IDENTITY)
      writer.writeString(expr.id)
      break

    case 'scope':
      writer.writeByte(TAG_SCOPE)
      writer.writeVarint(expr.scopes.length)
      for (const scope of expr.scopes) {
        writeScope(writer, scope)
      }
      writeRefExpr(writer, expr.expr, depth + 1)
      break

    case 'union':
      writer.writeByte(TAG_UNION)
      writer.writeVarint(expr.operands.length)
      for (const op of expr.operands) {
        writeRefExpr(writer, op, depth + 1)
      }
      break

    case 'intersect':
      writer.writeByte(TAG_INTERSECT)
      writer.writeVarint(expr.operands.length)
      for (const op of expr.operands) {
        writeRefExpr(writer, op, depth + 1)
      }
      break

    case 'exclude':
      writer.writeByte(TAG_EXCLUDE)
      writeRefExpr(writer, expr.base, depth + 1)
      writer.writeVarint(expr.excluded.length)
      for (const ex of expr.excluded) {
        writeRefExpr(writer, ex, depth + 1)
      }
      break
  }
}

function writeDeduped(writer: BufferWriter, deduped: DedupedExpr): void {
  writer.writeByte(TAG_DEDUPED)
  writer.writeVarint(deduped.defs.length)

  for (const def of deduped.defs) {
    writeExpr(writer, def)
  }

  writeRefExpr(writer, deduped.root)
}

function readExpr(reader: BufferReader, depth: number = 0): IdentityExpr {
  if (depth > MAX_DEPTH) {
    throw new Error('Expression too deeply nested (binary decoding)')
  }

  const tag = reader.readByte()

  switch (tag) {
    case TAG_IDENTITY:
      return { kind: 'identity', id: reader.readString() }

    case TAG_SCOPE: {
      const scopeCount = reader.readVarint()
      const scopes: Scope[] = []
      for (let i = 0; i < scopeCount; i++) {
        scopes.push(readScope(reader))
      }
      return { kind: 'scope', scopes, expr: readExpr(reader, depth + 1) }
    }

    case TAG_UNION: {
      const count = reader.readVarint()
      const operands: IdentityExpr[] = []
      for (let i = 0; i < count; i++) {
        operands.push(readExpr(reader, depth + 1))
      }
      return { kind: 'union', operands }
    }

    case TAG_INTERSECT: {
      const count = reader.readVarint()
      const operands: IdentityExpr[] = []
      for (let i = 0; i < count; i++) {
        operands.push(readExpr(reader, depth + 1))
      }
      return { kind: 'intersect', operands }
    }

    case TAG_EXCLUDE: {
      const base = readExpr(reader, depth + 1)
      const excludedCount = reader.readVarint()
      const excluded: IdentityExpr[] = []
      for (let i = 0; i < excludedCount; i++) {
        excluded.push(readExpr(reader, depth + 1))
      }
      return { kind: 'exclude', base, excluded }
    }

    default:
      throw new Error(`Unknown expression tag: 0x${tag.toString(16)}`)
  }
}

function readRefExpr(reader: BufferReader, depth: number = 0): RefExpr {
  if (depth > MAX_DEPTH) {
    throw new Error('Expression too deeply nested (binary decoding)')
  }

  const tag = reader.readByte()

  switch (tag) {
    case TAG_REF:
      return { $ref: reader.readVarint() }

    case TAG_IDENTITY:
      return { kind: 'identity', id: reader.readString() }

    case TAG_SCOPE: {
      const scopeCount = reader.readVarint()
      const scopes: Scope[] = []
      for (let i = 0; i < scopeCount; i++) {
        scopes.push(readScope(reader))
      }
      return { kind: 'scope', scopes, expr: readRefExpr(reader, depth + 1) }
    }

    case TAG_UNION: {
      const count = reader.readVarint()
      const operands: RefExpr[] = []
      for (let i = 0; i < count; i++) {
        operands.push(readRefExpr(reader, depth + 1))
      }
      return { kind: 'union', operands }
    }

    case TAG_INTERSECT: {
      const count = reader.readVarint()
      const operands: RefExpr[] = []
      for (let i = 0; i < count; i++) {
        operands.push(readRefExpr(reader, depth + 1))
      }
      return { kind: 'intersect', operands }
    }

    case TAG_EXCLUDE: {
      const base = readRefExpr(reader, depth + 1)
      const excludedCount = reader.readVarint()
      const excluded: RefExpr[] = []
      for (let i = 0; i < excludedCount; i++) {
        excluded.push(readRefExpr(reader, depth + 1))
      }
      return { kind: 'exclude', base, excluded }
    }

    default:
      throw new Error(`Unknown expression tag: 0x${tag.toString(16)}`)
  }
}

function readDeduped(reader: BufferReader): DedupedExpr {
  const defCount = reader.readVarint()
  const defs: IdentityExpr[] = []

  for (let i = 0; i < defCount; i++) {
    defs.push(readExpr(reader))
  }

  const root = readRefExpr(reader)
  return { defs, root }
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function encode(expr: IdentityExpr | DedupedExpr): Uint8Array {
  const writer = new BufferWriter()

  if (isDedupedExpr(expr)) {
    writeDeduped(writer, expr)
  } else {
    writeExpr(writer, expr)
  }

  return writer.toUint8Array()
}

export function decode(bytes: Uint8Array): IdentityExpr | DedupedExpr {
  if (bytes.length === 0) {
    throw new Error('Cannot decode empty buffer')
  }

  const reader = new BufferReader(bytes)

  const firstByte = bytes[0]

  let result: IdentityExpr | DedupedExpr
  if (firstByte === TAG_DEDUPED) {
    reader.readByte() // consume the tag
    result = readDeduped(reader)
  } else {
    result = readExpr(reader)
  }

  if (reader.remaining > 0) {
    throw new Error(`Unexpected ${reader.remaining} bytes after expression`)
  }

  return result
}

export function encodeBase64(expr: IdentityExpr | DedupedExpr): string {
  const binary = encode(expr)
  return Buffer.from(binary).toString('base64')
}

export function decodeBase64(base64: string): IdentityExpr | DedupedExpr {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  return decode(bytes)
}

// =============================================================================
// SIZE COMPARISON
// =============================================================================

export function compareSizes(expr: IdentityExpr): {
  verbose: number
  compact: number
  binary: number
  binaryBase64: number
} {
  const verbose = JSON.stringify(expr).length
  const compact = toCompactJSON(expr).length
  const binary = encode(expr).length
  const binaryBase64 = encodeBase64(expr).length

  return { verbose, compact, binary, binaryBase64 }
}
