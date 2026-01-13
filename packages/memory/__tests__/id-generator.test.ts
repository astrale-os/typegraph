/**
 * Tests for the Base62 ID Generator
 */

import { describe, it, expect } from "vitest"
import { generateBase62Id, parseBase62Id, isValidBase62Id, base62IdGenerator } from "../../../adapters/typegraph/shared/id-generator"

describe("Base62 ID Generator", () => {
  describe("generateBase62Id", () => {
    it("should generate IDs with correct format", () => {
      const id = generateBase62Id("user")

      expect(id).toMatch(/^user_[0-9a-zA-Z]{15}$/)
    })

    it("should include the type prefix", () => {
      const userId = generateBase62Id("user")
      const moduleId = generateBase62Id("module")
      const applicationId = generateBase62Id("application")

      expect(userId.startsWith("user_")).toBe(true)
      expect(moduleId.startsWith("module_")).toBe(true)
      expect(applicationId.startsWith("application_")).toBe(true)
    })

    it("should generate unique IDs", () => {
      const ids = new Set<string>()
      const count = 10000

      for (let i = 0; i < count; i++) {
        ids.add(generateBase62Id("test"))
      }

      expect(ids.size).toBe(count)
    })

    it("should generate IDs that are roughly time-ordered", () => {
      const id1 = generateBase62Id("test")

      // Small delay to ensure different timestamp
      const start = Date.now()
      while (Date.now() - start < 2) {
        // busy wait
      }

      const id2 = generateBase62Id("test")

      // Extract timestamp parts (first 7 chars after prefix)
      const ts1 = id1.split("_")[1]!.slice(0, 7)
      const ts2 = id2.split("_")[1]!.slice(0, 7)

      // ts2 should be >= ts1 (lexicographic comparison works for base62)
      expect(ts2 >= ts1).toBe(true)
    })

    it("should only use base62 characters", () => {
      const base62Regex = /^[0-9a-zA-Z]+$/

      for (let i = 0; i < 100; i++) {
        const id = generateBase62Id("test")
        const payload = id.split("_")[1]!
        expect(payload).toMatch(base62Regex)
      }
    })

    it("should handle empty type", () => {
      const id = generateBase62Id("")
      expect(id.startsWith("_")).toBe(true)
      expect(id.length).toBe(16) // "_" + 15 chars
    })

    it("should handle special characters in type", () => {
      // Type is used as-is, no escaping
      const id = generateBase62Id("my-type")
      expect(id.startsWith("my-type_")).toBe(true)
    })
  })

  describe("parseBase62Id", () => {
    it("should parse a valid ID", () => {
      const id = generateBase62Id("user")
      const parsed = parseBase62Id(id)

      expect(parsed).not.toBeNull()
      expect(parsed!.type).toBe("user")
      expect(parsed!.timestamp).toBeInstanceOf(Date)
      expect(parsed!.timestampRaw.length).toBe(7)
      expect(parsed!.randomRaw.length).toBe(8)
    })

    it("should return null for invalid ID format", () => {
      expect(parseBase62Id("invalid")).toBeNull()
      expect(parseBase62Id("no_underscore")).toBeNull()
      expect(parseBase62Id("type_short")).toBeNull()
      expect(parseBase62Id("type_toolongpayloadhere")).toBeNull()
    })

    it("should extract correct timestamp", () => {
      const before = Date.now()
      const id = generateBase62Id("test")
      const after = Date.now()

      const parsed = parseBase62Id(id)
      expect(parsed).not.toBeNull()

      const timestamp = parsed!.timestamp.getTime()
      expect(timestamp).toBeGreaterThanOrEqual(before - 1)
      expect(timestamp).toBeLessThanOrEqual(after + 1)
    })

    it("should handle type with underscores", () => {
      // When type contains underscores, use lastIndexOf to find the payload
      const id = "my_complex_type_1a2b3c4d5e6f7g8"
      const parsed = parseBase62Id(id)

      expect(parsed).not.toBeNull()
      expect(parsed!.type).toBe("my_complex_type")
    })
  })

  describe("isValidBase62Id", () => {
    it("should return true for valid IDs", () => {
      const id = generateBase62Id("user")
      expect(isValidBase62Id(id)).toBe(true)
    })

    it("should return false for invalid IDs", () => {
      expect(isValidBase62Id("invalid")).toBe(false)
      expect(isValidBase62Id("")).toBe(false)
      expect(isValidBase62Id("_")).toBe(false)
      expect(isValidBase62Id("type_")).toBe(false)
    })
  })

  describe("base62IdGenerator", () => {
    it("should implement IdGenerator interface", () => {
      expect(base62IdGenerator).toHaveProperty("generate")
      expect(typeof base62IdGenerator.generate).toBe("function")
    })

    it("should generate valid IDs", () => {
      const id = base62IdGenerator.generate("module")
      expect(id.startsWith("module_")).toBe(true)
      expect(isValidBase62Id(id)).toBe(true)
    })
  })

  describe("collision resistance", () => {
    it("should have no collisions in 100k IDs", () => {
      const ids = new Set<string>()
      const count = 100000

      for (let i = 0; i < count; i++) {
        ids.add(generateBase62Id("test"))
      }

      expect(ids.size).toBe(count)
    })

    it("should have no collisions across different types", () => {
      const ids = new Set<string>()
      const types = ["user", "module", "application", "space", "avatar"]
      const perType = 10000

      for (const type of types) {
        for (let i = 0; i < perType; i++) {
          ids.add(generateBase62Id(type))
        }
      }

      expect(ids.size).toBe(types.length * perType)
    })
  })

  describe("performance", () => {
    it("should generate 100k IDs in under 1 second", () => {
      const count = 100000
      const start = performance.now()

      for (let i = 0; i < count; i++) {
        generateBase62Id("test")
      }

      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(1000)

      // Log performance info
      console.log(`Generated ${count} IDs in ${elapsed.toFixed(2)}ms (${(count / elapsed * 1000).toFixed(0)} IDs/sec)`)
    })
  })
})
