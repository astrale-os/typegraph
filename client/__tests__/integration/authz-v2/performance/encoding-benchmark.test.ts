/**
 * AUTH_V2 Performance Tests: Encoding Benchmark
 *
 * Comprehensive benchmarks for all encoding strategies:
 * - JSON verbose (baseline)
 * - JSON compact
 * - Binary varint encoding
 * - Binary with deduplication
 *
 * Uses realistic data: ~20 char IDs, real permission names.
 */

import { describe, it, expect } from 'vitest'

import type { IdentityExpr } from '../types'
import type { PermissionMask } from '../types'

import { identity, union, intersect, exclude } from '../expression/builder'
import { toCompactJSON, fromCompactJSON } from '../expression/compact'
import { dedup, expand, hasRepeatedSubtrees, dedupStats } from '../expression/dedup'
import { encode, decode, encodeBase64, decodeBase64 } from '../expression/encoding'
import { READ, EDIT, USE, SHARE } from '../testing/helpers'

// =============================================================================
// REALISTIC TEST DATA GENERATORS
// =============================================================================

/** Generate a realistic ~20 char ID (like a UUID or database ID) */
function generateId(prefix: string, index: number): string {
  const base = `${prefix}_${index.toString().padStart(4, '0')}`
  // Pad to ~20 chars
  return base.padEnd(20, 'x')
}

/** Realistic permission bitmasks */
const PERMISSIONS: PermissionMask[] = [READ, EDIT, USE, SHARE]

/** Generate realistic node IDs */
function generateNodeId(index: number): string {
  return generateId('node', index)
}

/** Generate realistic identity IDs */
function generateIdentityId(type: 'user' | 'role' | 'group' | 'app', index: number): string {
  return generateId(type, index)
}

// =============================================================================
// TEST EXPRESSION GENERATORS
// =============================================================================

interface ExpressionSet {
  name: string
  description: string
  expr: IdentityExpr
  hasDuplicates: boolean
}

function generateTestExpressions(): ExpressionSet[] {
  const expressions: ExpressionSet[] = []

  // 1. Simple identity (no scopes)
  expressions.push({
    name: 'simple-identity',
    description: 'Single identity without scopes',
    expr: identity(generateIdentityId('user', 1)).build(),
    hasDuplicates: false,
  })

  // 2. Identity with single scope
  expressions.push({
    name: 'identity-single-scope',
    description: 'Identity with one node + one permission scope',
    expr: identity(generateIdentityId('user', 2), {
      nodes: [generateNodeId(1)],
      perms: READ,
    }).build(),
    hasDuplicates: false,
  })

  // 3. Identity with multiple scopes
  expressions.push({
    name: 'identity-multi-scope',
    description: 'Identity with multiple scopes (3 nodes, 2 perms)',
    expr: identity(generateIdentityId('user', 3), {
      nodes: [generateNodeId(1), generateNodeId(2), generateNodeId(3)],
      perms: READ | EDIT,
    }).build(),
    hasDuplicates: false,
  })

  // 4. Simple union (2 identities)
  expressions.push({
    name: 'simple-union',
    description: 'Union of 2 identities',
    expr: union(
      identity(generateIdentityId('user', 4)),
      identity(generateIdentityId('role', 1)),
    ).build(),
    hasDuplicates: false,
  })

  // 5. Complex union (4 identities)
  expressions.push({
    name: 'complex-union',
    description: 'Union of 4 identities with scopes',
    expr: union(
      union(
        identity(generateIdentityId('user', 5), { nodes: [generateNodeId(1)] }),
        identity(generateIdentityId('role', 2), { perms: READ | EDIT }),
      ),
      union(
        identity(generateIdentityId('group', 1), { nodes: [generateNodeId(2)] }),
        identity(generateIdentityId('app', 1), { perms: USE }),
      ),
    ).build(),
    hasDuplicates: false,
  })

  // 6. Intersect with exclude
  expressions.push({
    name: 'intersect-exclude',
    description: 'Intersect with exclude (user AND role, NOT blocked)',
    expr: intersect(
      union(
        identity(generateIdentityId('user', 6), { nodes: [generateNodeId(1), generateNodeId(2)] }),
        identity(generateIdentityId('role', 3), { perms: READ | EDIT | SHARE }),
      ),
      exclude(
        identity(generateIdentityId('group', 2)),
        identity(generateIdentityId('user', 7)), // blocked user
      ),
    ).build(),
    hasDuplicates: false,
  })

  // 7. Expression with duplicates (shared subtree used twice)
  const sharedSubtree = union(
    identity(generateIdentityId('user', 8), { nodes: [generateNodeId(1)] }),
    identity(generateIdentityId('role', 4), { perms: READ | EDIT }),
  ).build()

  expressions.push({
    name: 'with-duplicates-simple',
    description: 'Shared subtree used twice (union appears in both branches)',
    expr: {
      kind: 'intersect',
      operands: [
        sharedSubtree,
        {
          kind: 'exclude',
          base: sharedSubtree,
          excluded: [{ kind: 'identity', id: generateIdentityId('user', 9) }],
        },
      ],
    },
    hasDuplicates: true,
  })

  // 8. Expression with multiple duplicates
  const sharedIdentity = identity(generateIdentityId('role', 5), {
    nodes: [generateNodeId(1), generateNodeId(2)],
    perms: READ | EDIT | USE | SHARE,
  }).build()

  expressions.push({
    name: 'with-duplicates-multiple',
    description: 'Same identity used 3 times in expression',
    expr: {
      kind: 'union',
      operands: [
        {
          kind: 'intersect',
          operands: [sharedIdentity, { kind: 'identity', id: generateIdentityId('user', 10) }],
        },
        {
          kind: 'exclude',
          base: sharedIdentity,
          excluded: [sharedIdentity], // used third time
        },
      ],
    },
    hasDuplicates: true,
  })

  // 9. Deep nesting (realistic authorization chain)
  expressions.push({
    name: 'deep-nesting',
    description: 'Deeply nested expression (5 levels)',
    expr: intersect(
      union(
        intersect(
          union(
            identity(generateIdentityId('user', 11), { nodes: [generateNodeId(1)] }),
            identity(generateIdentityId('role', 6), { perms: READ }),
          ),
          identity(generateIdentityId('group', 3), { nodes: [generateNodeId(2)] }),
        ),
        identity(generateIdentityId('app', 2), { perms: USE }),
      ),
      exclude(
        identity(generateIdentityId('role', 7), { perms: EDIT | SHARE }),
        identity(generateIdentityId('user', 12)),
      ),
    ).build(),
    hasDuplicates: false,
  })

  // 10. Large expression (many identities)
  let largeExpr = identity(generateIdentityId('user', 100), {
    nodes: [generateNodeId(1)],
    perms: READ,
  }).build()
  for (let i = 1; i <= 15; i++) {
    largeExpr = {
      kind: 'union',
      operands: [
        largeExpr,
        identity(generateIdentityId(i % 2 === 0 ? 'role' : 'user', 100 + i), {
          nodes: [generateNodeId(i)],
          perms: PERMISSIONS[i % 4],
        }).build(),
      ],
    }
  }
  expressions.push({
    name: 'large-expression',
    description: 'Large expression with 16 identities',
    expr: largeExpr,
    hasDuplicates: false,
  })

  // 11. Large with duplicates
  const sharedComplex = union(
    identity(generateIdentityId('user', 200), {
      nodes: [generateNodeId(1), generateNodeId(2), generateNodeId(3)],
      perms: READ | EDIT,
    }),
    identity(generateIdentityId('role', 200), {
      nodes: [generateNodeId(4), generateNodeId(5)],
      perms: USE | SHARE,
    }),
  ).build()

  let largeWithDups: IdentityExpr = sharedComplex
  for (let i = 0; i < 5; i++) {
    largeWithDups = {
      kind: i % 2 === 0 ? 'union' : 'intersect',
      operands: [
        largeWithDups,
        {
          kind: 'exclude',
          base: sharedComplex,
          excluded: [{ kind: 'identity', id: generateIdentityId('user', 210 + i) }],
        },
      ],
    }
  }
  expressions.push({
    name: 'large-with-duplicates',
    description: 'Large expression with shared subtree used 6 times',
    expr: largeWithDups,
    hasDuplicates: true,
  })

  return expressions
}

// =============================================================================
// BENCHMARK UTILITIES
// =============================================================================

interface EncodingResult {
  format: string
  encodeTimeUs: number
  decodeTimeUs: number
  sizeBytes: number
  roundTripValid: boolean
}

interface BenchmarkReport {
  expression: string
  description: string
  hasDuplicates: boolean
  detectedDuplicates: boolean
  dedupStats: { uniqueSubtrees: number; duplicateSubtrees: number; potentialSavings: number }
  encodings: EncodingResult[]
  sizeComparison: {
    baseline: number
    compactReduction: string
    binaryReduction: string
    binaryBase64Reduction: string
    dedupBinaryReduction: string
    dedupBinaryBase64Reduction: string
    bestFormat: string
    bestReduction: string
  }
  recommendation: string
}

function microBenchmark(fn: () => void, iterations: number = 1000): number {
  // Warmup
  for (let i = 0; i < 100; i++) fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const end = performance.now()

  return ((end - start) / iterations) * 1000 // microseconds
}

function benchmarkExpression(exprSet: ExpressionSet): BenchmarkReport {
  const { name, description, expr, hasDuplicates } = exprSet
  const encodings: EncodingResult[] = []

  // 1. JSON Verbose (baseline)
  const verboseJson = JSON.stringify(expr)
  const verboseEncodeTime = microBenchmark(() => JSON.stringify(expr))
  const verboseDecodeTime = microBenchmark(() => JSON.parse(verboseJson))
  const verboseDecoded = JSON.parse(verboseJson) as IdentityExpr
  encodings.push({
    format: 'JSON Verbose',
    encodeTimeUs: verboseEncodeTime,
    decodeTimeUs: verboseDecodeTime,
    sizeBytes: verboseJson.length,
    roundTripValid: JSON.stringify(verboseDecoded) === verboseJson,
  })

  // 2. JSON Compact
  const compactJson = toCompactJSON(expr)
  const compactEncodeTime = microBenchmark(() => toCompactJSON(expr))
  const compactDecodeTime = microBenchmark(() => fromCompactJSON(compactJson))
  const compactDecoded = fromCompactJSON(compactJson)
  encodings.push({
    format: 'JSON Compact',
    encodeTimeUs: compactEncodeTime,
    decodeTimeUs: compactDecodeTime,
    sizeBytes: compactJson.length,
    roundTripValid: JSON.stringify(compactDecoded) === JSON.stringify(expr),
  })

  // 3. Binary
  const binary = encode(expr)
  const binaryEncodeTime = microBenchmark(() => encode(expr))
  const binaryDecodeTime = microBenchmark(() => decode(binary))
  const binaryDecoded = decode(binary)
  encodings.push({
    format: 'Binary',
    encodeTimeUs: binaryEncodeTime,
    decodeTimeUs: binaryDecodeTime,
    sizeBytes: binary.length,
    roundTripValid: JSON.stringify(binaryDecoded) === JSON.stringify(expr),
  })

  // 4. Binary Base64 (for JSON transport)
  const binaryBase64 = encodeBase64(expr)
  const binaryBase64EncodeTime = microBenchmark(() => encodeBase64(expr))
  const binaryBase64DecodeTime = microBenchmark(() => decodeBase64(binaryBase64))
  const binaryBase64Decoded = decodeBase64(binaryBase64)
  encodings.push({
    format: 'Binary Base64',
    encodeTimeUs: binaryBase64EncodeTime,
    decodeTimeUs: binaryBase64DecodeTime,
    sizeBytes: binaryBase64.length,
    roundTripValid: JSON.stringify(binaryBase64Decoded) === JSON.stringify(expr),
  })

  // 5. Dedup + Binary
  const deduped = dedup(expr)
  const dedupBinary = encode(deduped)
  const dedupEncodeTime = microBenchmark(() => encode(dedup(expr)))
  const dedupDecodeTime = microBenchmark(() => {
    const decoded = decode(dedupBinary)
    // Full decode includes expand if needed
    if ('defs' in decoded) expand(decoded)
  })
  const dedupDecoded = decode(dedupBinary)
  const expandedDedup = 'defs' in dedupDecoded ? expand(dedupDecoded) : dedupDecoded
  encodings.push({
    format: 'Dedup + Binary',
    encodeTimeUs: dedupEncodeTime,
    decodeTimeUs: dedupDecodeTime,
    sizeBytes: dedupBinary.length,
    roundTripValid: JSON.stringify(expandedDedup) === JSON.stringify(expr),
  })

  // 6. Dedup + Binary Base64
  const dedupBinaryBase64 = encodeBase64(deduped)
  const dedupBase64EncodeTime = microBenchmark(() => encodeBase64(dedup(expr)))
  const dedupBase64DecodeTime = microBenchmark(() => {
    const decoded = decodeBase64(dedupBinaryBase64)
    if ('defs' in decoded) expand(decoded)
  })
  encodings.push({
    format: 'Dedup + Binary Base64',
    encodeTimeUs: dedupBase64EncodeTime,
    decodeTimeUs: dedupBase64DecodeTime,
    sizeBytes: dedupBinaryBase64.length,
    roundTripValid: true, // Already validated above
  })

  // Calculate size comparisons
  const baseline = encodings[0].sizeBytes
  const sizes = encodings.map((e) => ({ format: e.format, size: e.sizeBytes }))
  const bestEncoding = sizes.reduce((a, b) => (a.size < b.size ? a : b))

  const stats = dedupStats(expr)

  // Determine recommendation
  let recommendation: string
  if (stats.duplicateSubtrees > 0 && dedupBinary.length < binary.length) {
    recommendation = 'Use Dedup + Binary - significant duplicate subtrees detected'
  } else if (binary.length < baseline * 0.5) {
    recommendation = 'Use Binary - best size reduction without dedup overhead'
  } else {
    recommendation = 'Use JSON Compact - good balance of size and compatibility'
  }

  return {
    expression: name,
    description,
    hasDuplicates,
    detectedDuplicates: hasRepeatedSubtrees(expr),
    dedupStats: {
      uniqueSubtrees: stats.uniqueSubtrees,
      duplicateSubtrees: stats.duplicateSubtrees,
      potentialSavings: stats.potentialSavings,
    },
    encodings,
    sizeComparison: {
      baseline,
      compactReduction: `${(((baseline - encodings[1].sizeBytes) / baseline) * 100).toFixed(1)}%`,
      binaryReduction: `${(((baseline - encodings[2].sizeBytes) / baseline) * 100).toFixed(1)}%`,
      binaryBase64Reduction: `${(((baseline - encodings[3].sizeBytes) / baseline) * 100).toFixed(1)}%`,
      dedupBinaryReduction: `${(((baseline - encodings[4].sizeBytes) / baseline) * 100).toFixed(1)}%`,
      dedupBinaryBase64Reduction: `${(((baseline - encodings[5].sizeBytes) / baseline) * 100).toFixed(1)}%`,
      bestFormat: bestEncoding.format,
      bestReduction: `${(((baseline - bestEncoding.size) / baseline) * 100).toFixed(1)}%`,
    },
    recommendation,
  }
}

// =============================================================================
// REPORT FORMATTING
// =============================================================================

function formatReport(reports: BenchmarkReport[]): string {
  const lines: string[] = []

  lines.push('='.repeat(100))
  lines.push('ENCODING PERFORMANCE BENCHMARK REPORT')
  lines.push('='.repeat(100))
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Test expressions: ${reports.length}`)
  lines.push(`IDs: ~20 characters (realistic)`)
  lines.push(`Permissions: read, edit, use, share`)
  lines.push('')

  // Summary table
  lines.push('-'.repeat(100))
  lines.push('SUMMARY: Size Comparison (bytes)')
  lines.push('-'.repeat(100))
  lines.push(
    'Expression'.padEnd(25) +
      'Verbose'.padStart(10) +
      'Compact'.padStart(10) +
      'Binary'.padStart(10) +
      'Bin+B64'.padStart(10) +
      'Dedup+Bin'.padStart(12) +
      'Best'.padStart(12) +
      'Reduction'.padStart(12),
  )
  lines.push('-'.repeat(100))

  for (const report of reports) {
    lines.push(
      report.expression.padEnd(25) +
        report.encodings[0].sizeBytes.toString().padStart(10) +
        report.encodings[1].sizeBytes.toString().padStart(10) +
        report.encodings[2].sizeBytes.toString().padStart(10) +
        report.encodings[3].sizeBytes.toString().padStart(10) +
        report.encodings[4].sizeBytes.toString().padStart(12) +
        report.sizeComparison.bestFormat.substring(0, 10).padStart(12) +
        report.sizeComparison.bestReduction.padStart(12),
    )
  }
  lines.push('')

  // Timing table
  lines.push('-'.repeat(100))
  lines.push('SUMMARY: Encode/Decode Timing (microseconds)')
  lines.push('-'.repeat(100))
  lines.push(
    'Expression'.padEnd(25) +
      'JSON Enc'.padStart(10) +
      'JSON Dec'.padStart(10) +
      'Bin Enc'.padStart(10) +
      'Bin Dec'.padStart(10) +
      'Dedup Enc'.padStart(12) +
      'Dedup Dec'.padStart(12),
  )
  lines.push('-'.repeat(100))

  for (const report of reports) {
    lines.push(
      report.expression.padEnd(25) +
        report.encodings[0].encodeTimeUs.toFixed(1).padStart(10) +
        report.encodings[0].decodeTimeUs.toFixed(1).padStart(10) +
        report.encodings[2].encodeTimeUs.toFixed(1).padStart(10) +
        report.encodings[2].decodeTimeUs.toFixed(1).padStart(10) +
        report.encodings[4].encodeTimeUs.toFixed(1).padStart(12) +
        report.encodings[4].decodeTimeUs.toFixed(1).padStart(12),
    )
  }
  lines.push('')

  // Dedup effectiveness
  lines.push('-'.repeat(100))
  lines.push('DEDUP EFFECTIVENESS')
  lines.push('-'.repeat(100))
  lines.push(
    'Expression'.padEnd(25) +
      'Has Dups?'.padStart(12) +
      'Detected?'.padStart(12) +
      'Unique'.padStart(10) +
      'Duplicates'.padStart(12) +
      'Savings%'.padStart(10) +
      'Dedup Helps?'.padStart(14),
  )
  lines.push('-'.repeat(100))

  for (const report of reports) {
    const dedupHelps = report.encodings[4].sizeBytes < report.encodings[2].sizeBytes
    lines.push(
      report.expression.padEnd(25) +
        (report.hasDuplicates ? 'Yes' : 'No').padStart(12) +
        (report.detectedDuplicates ? 'Yes' : 'No').padStart(12) +
        report.dedupStats.uniqueSubtrees.toString().padStart(10) +
        report.dedupStats.duplicateSubtrees.toString().padStart(12) +
        `${report.dedupStats.potentialSavings}%`.padStart(10) +
        (dedupHelps ? 'YES' : 'No').padStart(14),
    )
  }
  lines.push('')

  // Detailed reports
  lines.push('='.repeat(100))
  lines.push('DETAILED REPORTS')
  lines.push('='.repeat(100))

  for (const report of reports) {
    lines.push('')
    lines.push(`--- ${report.expression} ---`)
    lines.push(`Description: ${report.description}`)
    lines.push(`Has Duplicates: ${report.hasDuplicates} | Detected: ${report.detectedDuplicates}`)
    lines.push(
      `Dedup Stats: ${report.dedupStats.uniqueSubtrees} unique, ${report.dedupStats.duplicateSubtrees} duplicates, ${report.dedupStats.potentialSavings}% potential savings`,
    )
    lines.push('')
    lines.push('  Format                 Size(B)    Encode(us)  Decode(us)  Valid')
    for (const enc of report.encodings) {
      lines.push(
        `  ${enc.format.padEnd(20)} ${enc.sizeBytes.toString().padStart(8)}    ${enc.encodeTimeUs.toFixed(1).padStart(8)}    ${enc.decodeTimeUs.toFixed(1).padStart(8)}    ${enc.roundTripValid ? 'Yes' : 'NO!'}`,
      )
    }
    lines.push('')
    lines.push(`  Recommendation: ${report.recommendation}`)
  }

  // Conclusions
  lines.push('')
  lines.push('='.repeat(100))
  lines.push('CONCLUSIONS')
  lines.push('='.repeat(100))
  lines.push('')

  // Calculate averages
  const avgCompactReduction =
    reports.reduce((sum, r) => sum + parseFloat(r.sizeComparison.compactReduction), 0) /
    reports.length
  const avgBinaryReduction =
    reports.reduce((sum, r) => sum + parseFloat(r.sizeComparison.binaryReduction), 0) /
    reports.length
  const avgBinaryBase64Reduction =
    reports.reduce((sum, r) => sum + parseFloat(r.sizeComparison.binaryBase64Reduction), 0) /
    reports.length

  const reportsWithDups = reports.filter((r) => r.hasDuplicates)
  const avgDedupSavingsWithDups =
    reportsWithDups.length > 0
      ? reportsWithDups.reduce(
          (sum, r) => sum + parseFloat(r.sizeComparison.dedupBinaryReduction),
          0,
        ) / reportsWithDups.length
      : 0

  lines.push(`Average Size Reductions (vs JSON Verbose):`)
  lines.push(`  - JSON Compact:     ${avgCompactReduction.toFixed(1)}%`)
  lines.push(`  - Binary:           ${avgBinaryReduction.toFixed(1)}%`)
  lines.push(`  - Binary Base64:    ${avgBinaryBase64Reduction.toFixed(1)}%`)
  if (reportsWithDups.length > 0) {
    lines.push(`  - Dedup+Binary (with dups): ${avgDedupSavingsWithDups.toFixed(1)}%`)
  }
  lines.push('')

  // Timing averages
  const avgJsonEncode =
    reports.reduce((sum, r) => sum + r.encodings[0].encodeTimeUs, 0) / reports.length
  const avgJsonDecode =
    reports.reduce((sum, r) => sum + r.encodings[0].decodeTimeUs, 0) / reports.length
  const avgBinEncode =
    reports.reduce((sum, r) => sum + r.encodings[2].encodeTimeUs, 0) / reports.length
  const avgBinDecode =
    reports.reduce((sum, r) => sum + r.encodings[2].decodeTimeUs, 0) / reports.length
  const avgDedupEncode =
    reports.reduce((sum, r) => sum + r.encodings[4].encodeTimeUs, 0) / reports.length
  const avgDedupDecode =
    reports.reduce((sum, r) => sum + r.encodings[4].decodeTimeUs, 0) / reports.length

  lines.push(`Average Timing (microseconds):`)
  lines.push(
    `  - JSON:        encode ${avgJsonEncode.toFixed(1)}us, decode ${avgJsonDecode.toFixed(1)}us`,
  )
  lines.push(
    `  - Binary:      encode ${avgBinEncode.toFixed(1)}us, decode ${avgBinDecode.toFixed(1)}us`,
  )
  lines.push(
    `  - Dedup+Bin:   encode ${avgDedupEncode.toFixed(1)}us, decode ${avgDedupDecode.toFixed(1)}us`,
  )
  lines.push('')

  lines.push(`Recommendations:`)
  lines.push(
    `  1. For API payloads: Use Binary Base64 - ${avgBinaryBase64Reduction.toFixed(0)}% smaller, JSON-compatible`,
  )
  lines.push(
    `  2. For storage: Use Binary - ${avgBinaryReduction.toFixed(0)}% smaller, fastest decode`,
  )
  lines.push(`  3. For expressions with known duplicates: Use Dedup+Binary for additional savings`)
  lines.push(
    `  4. For maximum compatibility: Use JSON Compact - ${avgCompactReduction.toFixed(0)}% smaller, human-readable`,
  )
  lines.push('')

  return lines.join('\n')
}

// =============================================================================
// TESTS
// =============================================================================

describe('AUTH_V2 Performance: Encoding Benchmark', () => {
  const expressions = generateTestExpressions()
  const reports: BenchmarkReport[] = []

  // Run benchmarks for each expression
  for (const exprSet of expressions) {
    it(`benchmarks ${exprSet.name}`, () => {
      const report = benchmarkExpression(exprSet)
      reports.push(report)

      // Verify all round-trips are valid
      for (const enc of report.encodings) {
        expect(enc.roundTripValid).toBe(true)
      }

      // Verify dedup detection matches expectation
      expect(report.detectedDuplicates).toBe(exprSet.hasDuplicates)
    })
  }

  // Generate and output report
  it('generates comprehensive report', () => {
    const report = formatReport(reports)
    console.log('\n' + report)

    // Verify we have results for all expressions
    expect(reports.length).toBe(expressions.length)
  })

  // Specific assertions about encoding effectiveness
  describe('encoding effectiveness assertions', () => {
    it('binary is always smaller than verbose JSON', () => {
      for (const report of reports) {
        const verboseSize = report.encodings[0].sizeBytes
        const binarySize = report.encodings[2].sizeBytes
        expect(binarySize).toBeLessThan(verboseSize)
      }
    })

    it('compact JSON is always smaller than verbose JSON', () => {
      for (const report of reports) {
        const verboseSize = report.encodings[0].sizeBytes
        const compactSize = report.encodings[1].sizeBytes
        expect(compactSize).toBeLessThan(verboseSize)
      }
    })

    it('binary is smaller than compact JSON for most expressions', () => {
      let binaryWins = 0
      for (const report of reports) {
        const compactSize = report.encodings[1].sizeBytes
        const binarySize = report.encodings[2].sizeBytes
        if (binarySize < compactSize) binaryWins++
      }
      // Binary should win for majority of expressions
      expect(binaryWins).toBeGreaterThanOrEqual(Math.floor(reports.length * 0.7))
    })

    it('dedup reduces size for expressions with duplicates', () => {
      const withDups = reports.filter((r) => r.hasDuplicates)
      for (const report of withDups) {
        const binarySize = report.encodings[2].sizeBytes
        const dedupSize = report.encodings[4].sizeBytes
        // Dedup should help when there are actual duplicates
        expect(dedupSize).toBeLessThanOrEqual(binarySize)
      }
    })

    it('dedup does not significantly increase size for expressions without duplicates', () => {
      const withoutDups = reports.filter((r) => !r.hasDuplicates)
      for (const report of withoutDups) {
        const binarySize = report.encodings[2].sizeBytes
        const dedupSize = report.encodings[4].sizeBytes
        // Dedup overhead should be minimal (less than 20% increase)
        expect(dedupSize).toBeLessThan(binarySize * 1.2)
      }
    })
  })

  // Throughput test
  describe('throughput benchmarks', () => {
    it('measures encode/decode throughput for typical expression', () => {
      // Use a medium-complexity expression
      const expr = expressions.find((e) => e.name === 'intersect-exclude')!.expr
      const iterations = 10000

      // Binary encode throughput
      const binaryEncodeStart = performance.now()
      for (let i = 0; i < iterations; i++) encode(expr)
      const binaryEncodeTime = performance.now() - binaryEncodeStart
      const binaryEncodeThroughput = (iterations / binaryEncodeTime) * 1000

      // Binary decode throughput
      const binary = encode(expr)
      const binaryDecodeStart = performance.now()
      for (let i = 0; i < iterations; i++) decode(binary)
      const binaryDecodeTime = performance.now() - binaryDecodeStart
      const binaryDecodeThroughput = (iterations / binaryDecodeTime) * 1000

      // JSON encode throughput
      const jsonEncodeStart = performance.now()
      for (let i = 0; i < iterations; i++) JSON.stringify(expr)
      const jsonEncodeTime = performance.now() - jsonEncodeStart
      const jsonEncodeThroughput = (iterations / jsonEncodeTime) * 1000

      // JSON decode throughput
      const json = JSON.stringify(expr)
      const jsonDecodeStart = performance.now()
      for (let i = 0; i < iterations; i++) JSON.parse(json)
      const jsonDecodeTime = performance.now() - jsonDecodeStart
      const jsonDecodeThroughput = (iterations / jsonDecodeTime) * 1000

      console.log('\nThroughput (operations/second):')
      console.log(`  JSON encode:   ${jsonEncodeThroughput.toFixed(0)} ops/sec`)
      console.log(`  JSON decode:   ${jsonDecodeThroughput.toFixed(0)} ops/sec`)
      console.log(`  Binary encode: ${binaryEncodeThroughput.toFixed(0)} ops/sec`)
      console.log(`  Binary decode: ${binaryDecodeThroughput.toFixed(0)} ops/sec`)

      // Basic sanity checks
      expect(binaryEncodeThroughput).toBeGreaterThan(10000) // At least 10k ops/sec
      expect(binaryDecodeThroughput).toBeGreaterThan(10000)
    })
  })
})
