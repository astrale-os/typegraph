/**
 * Seeded Random Number Generator
 *
 * Provides deterministic random number generation for reproducible graph generation.
 * Uses a simple but effective Linear Congruential Generator (LCG).
 */

export class SeededRandom {
  private state: number

  constructor(seed: number = 42) {
    this.state = seed
  }

  /**
   * Generate next random number in [0, 1).
   */
  next(): number {
    // LCG parameters (same as glibc)
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff
    return this.state / 0x80000000
  }

  /**
   * Generate random integer in [0, max).
   */
  nextInt(max: number): number {
    return Math.floor(this.next() * max)
  }

  /**
   * Generate random integer in [min, max].
   */
  nextIntRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1)
  }

  /**
   * Generate random float in [min, max).
   */
  nextFloatRange(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /**
   * Pick a random element from an array.
   */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error('Cannot pick from empty array')
    return arr[this.nextInt(arr.length)]!
  }

  /**
   * Pick n random elements from an array (without replacement).
   */
  pickN<T>(arr: T[], n: number): T[] {
    if (n > arr.length) throw new Error('Cannot pick more elements than array length')
    const copy = [...arr]
    const result: T[] = []
    for (let i = 0; i < n; i++) {
      const idx = this.nextInt(copy.length)
      result.push(copy[idx]!)
      copy.splice(idx, 1)
    }
    return result
  }

  /**
   * Shuffle an array in place.
   */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1)
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
    return arr
  }

  /**
   * Return true with the given probability [0, 1].
   */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /**
   * Pick from weighted options.
   * @param options Array of [item, weight] pairs
   */
  weighted<T>(options: [T, number][]): T {
    const totalWeight = options.reduce((sum, [, w]) => sum + w, 0)
    let r = this.next() * totalWeight
    for (const [item, weight] of options) {
      r -= weight
      if (r <= 0) return item
    }
    return options[options.length - 1]![0]
  }

  /**
   * Generate a random permutation of array indices.
   */
  permutation(length: number): number[] {
    const arr = Array.from({ length }, (_, i) => i)
    return this.shuffle(arr)
  }

  /**
   * Reset the generator to a new seed.
   */
  reset(seed: number): void {
    this.state = seed
  }

  /**
   * Fork the generator (create a new one with a derived seed).
   */
  fork(): SeededRandom {
    return new SeededRandom(this.nextInt(0x7fffffff))
  }
}

/**
 * Create a seeded random number generator.
 */
export function createSeededRandom(seed: number = 42): SeededRandom {
  return new SeededRandom(seed)
}
