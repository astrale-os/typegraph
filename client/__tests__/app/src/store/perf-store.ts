import { create } from 'zustand'

import type { IdentityExpr } from '@/types/api'

export interface SizeResult {
  label: string
  bytes: number
  pctReduction: number
}

export interface BenchmarkResult {
  sizes: SizeResult[]
  dedupStats?: {
    totalSubtrees: number
    uniqueSubtrees: number
    duplicateSubtrees: number
    potentialSavings: number
  }
  encodeTimes: Array<{ label: string; avgMs: number }>
  decodeTimes: Array<{ label: string; avgMs: number }>
}

interface PerfStore {
  inputExpr: IdentityExpr | null
  result: BenchmarkResult | null
  loading: boolean
  error: string | null

  setInputExpr: (expr: IdentityExpr | null) => void
  runBenchmark: (expr: IdentityExpr) => void
  clear: () => void
}

export const usePerfStore = create<PerfStore>((set) => ({
  inputExpr: null,
  result: null,
  loading: false,
  error: null,

  setInputExpr: (expr) => set({ inputExpr: expr }),

  runBenchmark: async (expr: IdentityExpr) => {
    set({ loading: true, error: null, result: null, inputExpr: expr })

    try {
      // Dynamic imports to keep the module tree-shakeable
      const { encode, decode, encodeBase64, compareSizes } =
        await import('@authz/expression/encoding')
      const { toCompactJSON, fromCompactJSON } = await import('@authz/expression/compact')
      const { dedup, dedupStats: getDedupStats } = await import('@authz/expression/dedup')

      // Size comparison
      const sizeData = compareSizes(expr)
      const verboseSize = sizeData.verbose

      const sizes: SizeResult[] = [
        { label: 'Verbose JSON', bytes: sizeData.verbose, pctReduction: 0 },
        {
          label: 'Compact JSON',
          bytes: sizeData.compact,
          pctReduction: Math.round((1 - sizeData.compact / verboseSize) * 100),
        },
        {
          label: 'Binary',
          bytes: sizeData.binary,
          pctReduction: Math.round((1 - sizeData.binary / verboseSize) * 100),
        },
        {
          label: 'Binary (base64)',
          bytes: sizeData.binaryBase64,
          pctReduction: Math.round((1 - sizeData.binaryBase64 / verboseSize) * 100),
        },
      ]

      // Dedup
      const deduped = dedup(expr)
      const dedupBinary = encode(deduped)
      const dedupBase64 = encodeBase64(deduped)
      sizes.push(
        {
          label: 'Dedup + Binary',
          bytes: dedupBinary.length,
          pctReduction: Math.round((1 - dedupBinary.length / verboseSize) * 100),
        },
        {
          label: 'Dedup + Base64',
          bytes: dedupBase64.length,
          pctReduction: Math.round((1 - dedupBase64.length / verboseSize) * 100),
        },
      )

      const stats = getDedupStats(expr)

      // Performance benchmarks (100 iterations)
      const N = 100
      const encodeTimes: Array<{ label: string; avgMs: number }> = []
      const decodeTimes: Array<{ label: string; avgMs: number }> = []

      // Verbose JSON
      let start = performance.now()
      for (let i = 0; i < N; i++) JSON.stringify(expr)
      encodeTimes.push({ label: 'Verbose JSON', avgMs: (performance.now() - start) / N })

      const verboseStr = JSON.stringify(expr)
      start = performance.now()
      for (let i = 0; i < N; i++) JSON.parse(verboseStr)
      decodeTimes.push({ label: 'Verbose JSON', avgMs: (performance.now() - start) / N })

      // Compact JSON
      start = performance.now()
      for (let i = 0; i < N; i++) toCompactJSON(expr)
      encodeTimes.push({ label: 'Compact JSON', avgMs: (performance.now() - start) / N })

      const compactStr = toCompactJSON(expr)
      start = performance.now()
      for (let i = 0; i < N; i++) fromCompactJSON(compactStr)
      decodeTimes.push({ label: 'Compact JSON', avgMs: (performance.now() - start) / N })

      // Binary
      start = performance.now()
      for (let i = 0; i < N; i++) encode(expr)
      encodeTimes.push({ label: 'Binary', avgMs: (performance.now() - start) / N })

      const binary = encode(expr)
      start = performance.now()
      for (let i = 0; i < N; i++) decode(binary)
      decodeTimes.push({ label: 'Binary', avgMs: (performance.now() - start) / N })

      set({
        result: {
          sizes,
          dedupStats: stats,
          encodeTimes,
          decodeTimes,
        },
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  clear: () => set({ inputExpr: null, result: null, error: null }),
}))
