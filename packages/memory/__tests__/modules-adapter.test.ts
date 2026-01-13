/**
 * Modules Adapter Integration Tests
 *
 * Tests the TypegraphModulesAdapter with an in-memory typegraph backend.
 * These tests verify that the adapter correctly implements the ModulesPort interface
 * and properly handles module hierarchies, type assignments, and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createInMemoryGraph } from "../src"
import { kernelSchema } from "../../adapters/typegraph/shared/kernel-schema"
import { TypegraphModulesAdapter } from "../../adapters/typegraph/modules.adapter"
import type { KernelGraph } from "../../adapters/typegraph/shared/kernel-graph"
import type { ModuleId, NodeId, TypeId } from "@astrale/kernel-core"

// =============================================================================
// TEST SETUP
// =============================================================================

describe("TypegraphModulesAdapter", () => {
  let graph: KernelGraph
  let adapter: TypegraphModulesAdapter

  beforeEach(() => {
    graph = createInMemoryGraph(kernelSchema) as unknown as KernelGraph
    adapter = new TypegraphModulesAdapter(graph)
  })

  // ===========================================================================
  // createModule Tests
  // ===========================================================================

  describe("createModule", () => {
    it("should create a module with a type edge", async () => {
      // Create parent module and type
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Create child module via adapter
      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      expect(moduleId).toBeDefined()

      // Verify module was created
      const module = await adapter.getModule(moduleId)
      expect(module).toBeDefined()
      expect(module.metadata?.name).toBe("threads")

      // Verify type edge was created
      const typeId = await adapter.getTypeId(moduleId)
      expect(typeId).toBe(type.id)
    })

    it("should throw if type does not exist", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })

      await expect(
        adapter.createModule({
          parentId: parent.id as NodeId,
          typeId: "nonexistent_type" as TypeId,
          name: "test",
        }),
      ).rejects.toThrow("must be a 'type' node")
    })

    it("should throw if name already exists in parent", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Create first child
      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      // Try to create second child with same name
      await expect(
        adapter.createModule({
          parentId: parent.id as NodeId,
          typeId: type.id as TypeId,
          name: "threads",
        }),
      ).rejects.toThrow("Name 'threads' already exists in parent")
    })

    it("should allow same name under different parents", async () => {
      const parent1 = await graph.mutate.create("module", { name: "parent1" })
      const parent2 = await graph.mutate.create("module", { name: "parent2" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Create child under parent1
      const child1 = await adapter.createModule({
        parentId: parent1.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      // Create child with same name under parent2 - should succeed
      const child2 = await adapter.createModule({
        parentId: parent2.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      expect(child1).toBeDefined()
      expect(child2).toBeDefined()
      expect(child1).not.toBe(child2)
    })
  })

  // ===========================================================================
  // listChildren Tests
  // ===========================================================================

  describe("listChildren", () => {
    it("should list all children with their types", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const threadType = await graph.mutate.create("type", { name: "thread", title: "Thread" })
      const messageType = await graph.mutate.create("type", { name: "message", title: "Message" })

      // Create children via adapter
      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: threadType.id as TypeId,
        name: "threads",
      })

      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: messageType.id as TypeId,
        name: "messages",
      })

      // List children
      const children = await adapter.listChildren(parent.id as ModuleId)

      expect(children).toHaveLength(2)
      expect(children.map((c) => (c.metadata as { name: string })?.name).sort()).toEqual([
        "messages",
        "threads",
      ])

      // Verify each child has a typeId
      for (const child of children) {
        expect((child as { typeId?: TypeId }).typeId).toBeDefined()
      }
    })

    it("should return empty array for module with no children", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })

      const children = await adapter.listChildren(parent.id as ModuleId)

      expect(children).toEqual([])
    })

    /**
     * listChildren should return ALL children, regardless of whether they have type edges.
     * This ensures consistency with findChildByName.
     */
    it("should return all children including those without type edges", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Create a child WITH type via adapter
      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "with-type",
      })

      // Create a child WITHOUT type directly via graph (bypassing adapter)
      const orphanChild = await graph.mutate.createChild("module", parent.id, {
        name: "without-type",
      })
      // No type edge created for orphanChild

      // List children via adapter - should return BOTH children
      const children = await adapter.listChildren(parent.id as ModuleId)

      expect(children).toHaveLength(2)
      const names = children.map((c) => (c.metadata as { name: string })?.name).sort()
      expect(names).toEqual(["with-type", "without-type"])

      // The orphan child should also be found by findChildByName (consistent behavior)
      const orphanExists = await adapter.findChildByName(parent.id as NodeId, "without-type")
      expect(orphanExists).toBe(orphanChild.id)
    })
  })

  // ===========================================================================
  // findChildByName Tests
  // ===========================================================================

  describe("findChildByName", () => {
    it("should find child by name", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const childId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      const found = await adapter.findChildByName(parent.id as NodeId, "threads")

      expect(found).toBe(childId)
    })

    it("should return null if child not found", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })

      const found = await adapter.findChildByName(parent.id as NodeId, "nonexistent")

      expect(found).toBeNull()
    })

    /**
     * Both findChildByName and listChildren should find modules without type edges.
     * This consistency prevents the "Name already exists" bug.
     */
    it("should find children without type edges (consistent with listChildren)", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })

      // Create child directly WITHOUT type edge
      const orphanChild = await graph.mutate.createChild("module", parent.id, { name: "orphan" })

      // findChildByName finds it
      const found = await adapter.findChildByName(parent.id as NodeId, "orphan")
      expect(found).toBe(orphanChild.id)

      // listChildren ALSO returns it (consistent behavior)
      const children = await adapter.listChildren(parent.id as ModuleId)
      expect(
        children.find((c) => (c.metadata as { name: string })?.name === "orphan"),
      ).toBeDefined()
    })
  })

  // ===========================================================================
  // Type Management Tests
  // ===========================================================================

  describe("type management", () => {
    it("should get type ID for a module", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      const typeId = await adapter.getTypeId(moduleId)

      expect(typeId).toBe(type.id)
    })

    it("should return null for module without type", async () => {
      // Create module directly without type edge
      const module = await graph.mutate.create("module", { name: "orphan" })

      const typeId = await adapter.getTypeId(module.id as ModuleId)

      expect(typeId).toBeNull()
    })

    it("should set type for a module", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type1 = await graph.mutate.create("type", { name: "type1", title: "Type 1" })
      const type2 = await graph.mutate.create("type", { name: "type2", title: "Type 2" })

      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type1.id as TypeId,
        name: "test",
      })

      // Change type
      await adapter.setType(moduleId, type2.id as TypeId)

      const newTypeId = await adapter.getTypeId(moduleId)
      expect(newTypeId).toBe(type2.id)
    })

    it("should remove type from a module", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      // Remove type
      await adapter.removeType(moduleId)

      const typeId = await adapter.getTypeId(moduleId)
      expect(typeId).toBeNull()
    })
  })

  // ===========================================================================
  // Type Deletion Scenario Tests
  // ===========================================================================

  describe("type deletion scenarios", () => {
    /**
     * After type removal, listChildren and findChildByName should behave consistently.
     * The module should still be visible in listChildren even without a type edge.
     */
    it("should maintain consistent behavior after type removal", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Step 1: Create module with type
      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      // Verify module is visible in listChildren
      let children = await adapter.listChildren(parent.id as ModuleId)
      expect(children).toHaveLength(1)
      expect((children[0]!.metadata as { name: string })?.name).toBe("threads")

      // Step 2: Remove the type edge (simulating type deletion)
      await adapter.removeType(moduleId)

      // Step 3: listChildren STILL returns the module (consistent behavior)
      children = await adapter.listChildren(parent.id as ModuleId)
      expect(children).toHaveLength(1)
      expect((children[0]!.metadata as { name: string })?.name).toBe("threads")

      // Step 4: findChildByName also finds it (consistent)
      const found = await adapter.findChildByName(parent.id as NodeId, "threads")
      expect(found).toBe(moduleId)

      // Step 5: Creating a new module with same name correctly fails
      const newType = await graph.mutate.create("type", { name: "thread2", title: "Thread 2" })
      await expect(
        adapter.createModule({
          parentId: parent.id as NodeId,
          typeId: newType.id as TypeId,
          name: "threads",
        }),
      ).rejects.toThrow("Name 'threads' already exists in parent")
    })

    /**
     * This simulates the actual production scenario:
     * Types are deleted and recreated with new IDs.
     * Existing modules have dangling type edges.
     */
    it("should demonstrate issue when types are deleted and recreated", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })

      // Step 1: Create initial type and module
      const type1 = await graph.mutate.create("type", { name: "thread", title: "Thread" })
      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type1.id as TypeId,
        name: "threads",
      })

      // Verify module is visible
      let children = await adapter.listChildren(parent.id as ModuleId)
      expect(children).toHaveLength(1)

      // Step 2: Delete the type (simulating deleteAllTypes in develop-application.ts)
      await graph.mutate.delete("type", type1.id)

      // Step 3: After type deletion, the ofType edge may be dangling or removed
      // The module still exists but may not be visible to listChildren

      // Check if module still appears in listChildren
      children = await adapter.listChildren(parent.id as ModuleId)
      // This will likely be 0 because the type was deleted

      // But the module still exists
      const found = await adapter.findChildByName(parent.id as NodeId, "threads")
      expect(found).toBe(moduleId)

      // Step 4: Create new type with same name (simulating createModuleTypes)
      const type2 = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      // Step 5: Try to create module (would fail in reconciler)
      // Because findChildByName in createModule will find the existing "threads"
      await expect(
        adapter.createModule({
          parentId: parent.id as NodeId,
          typeId: type2.id as TypeId,
          name: "threads",
        }),
      ).rejects.toThrow("Name 'threads' already exists in parent")
    })
  })

  // ===========================================================================
  // findChildByType Tests
  // ===========================================================================

  describe("findChildByType", () => {
    it("should find child by type", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const threadType = await graph.mutate.create("type", { name: "thread", title: "Thread" })
      const messageType = await graph.mutate.create("type", { name: "message", title: "Message" })

      const threadModule = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: threadType.id as TypeId,
        name: "threads",
      })

      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: messageType.id as TypeId,
        name: "messages",
      })

      const found = await adapter.findChildByType(parent.id as NodeId, threadType.id as TypeId)

      expect(found).toBe(threadModule)
    })

    it("should return null if no child with type", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const found = await adapter.findChildByType(parent.id as NodeId, type.id as TypeId)

      expect(found).toBeNull()
    })

    it("should throw if multiple children with same type", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads1",
      })

      await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads2",
      })

      await expect(adapter.findChildByType(parent.id as NodeId, type.id as TypeId)).rejects.toThrow(
        "Invariant violation: multiple children with type",
      )
    })
  })

  // ===========================================================================
  // listByType Tests
  // ===========================================================================

  describe("listByType", () => {
    it("should list modules by type non-recursively", async () => {
      const root = await graph.mutate.create("module", { name: "root" })
      const threadType = await graph.mutate.create("type", { name: "thread", title: "Thread" })
      const messageType = await graph.mutate.create("type", { name: "message", title: "Message" })

      // Create direct children
      await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: threadType.id as TypeId,
        name: "thread1",
      })

      await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: threadType.id as TypeId,
        name: "thread2",
      })

      await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: messageType.id as TypeId,
        name: "message1",
      })

      const threads = await adapter.listByType(root.id as NodeId, threadType.id as TypeId, false)

      expect(threads).toHaveLength(2)
    })

    it("should list modules by type recursively", async () => {
      const root = await graph.mutate.create("module", { name: "root" })
      const threadType = await graph.mutate.create("type", { name: "thread", title: "Thread" })
      const containerType = await graph.mutate.create("type", {
        name: "container",
        title: "Container",
      })

      // Create nested structure
      const container = await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: containerType.id as TypeId,
        name: "container",
      })

      await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: threadType.id as TypeId,
        name: "thread1",
      })

      await adapter.createModule({
        parentId: container,
        typeId: threadType.id as TypeId,
        name: "thread2",
      })

      const threads = await adapter.listByType(root.id as NodeId, threadType.id as TypeId, true)

      expect(threads).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Delete Tests
  // ===========================================================================

  describe("delete operations", () => {
    it("should soft delete a module", async () => {
      const parent = await graph.mutate.create("module", { name: "parent" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const moduleId = await adapter.createModule({
        parentId: parent.id as NodeId,
        typeId: type.id as TypeId,
        name: "threads",
      })

      await adapter.softDeleteModule(moduleId)

      // Module should no longer be findable
      const found = await adapter.findChildByName(parent.id as NodeId, "threads")
      expect(found).toBeNull()
    })

    it("should delete a subtree", async () => {
      const root = await graph.mutate.create("module", { name: "root" })
      const type = await graph.mutate.create("type", { name: "thread", title: "Thread" })

      const parent = await adapter.createModule({
        parentId: root.id as NodeId,
        typeId: type.id as TypeId,
        name: "parent",
      })

      await adapter.createModule({
        parentId: parent,
        typeId: type.id as TypeId,
        name: "child1",
      })

      await adapter.createModule({
        parentId: parent,
        typeId: type.id as TypeId,
        name: "child2",
      })

      // Verify 3 modules exist under root
      let children = await adapter.listChildren(root.id as ModuleId)
      expect(children).toHaveLength(1) // parent

      const parentChildren = await adapter.listChildren(parent)
      expect(parentChildren).toHaveLength(2) // child1, child2

      // Delete subtree
      await adapter.deleteSubtree(parent)

      // Parent and children should be gone
      children = await adapter.listChildren(root.id as ModuleId)
      expect(children).toHaveLength(0)
    })
  })

  // ===========================================================================
  // App Link Tests
  // ===========================================================================

  describe("app links", () => {
    it("should create and list app links", async () => {
      const source = await graph.mutate.create("module", { name: "source" })
      const target = await graph.mutate.create("module", { name: "target" })
      const type = await graph.mutate.create("type", { name: "link", title: "Link" })

      // Add type to source so it's "valid"
      await graph.mutate.link("ofType", source.id, type.id)

      // Create app link
      await adapter.createAppLink(source.id as ModuleId, target.id as NodeId, { label: "related" })

      // List app links
      const links = await adapter.listAppLinks(source.id as ModuleId)

      expect(links).toHaveLength(1)
      expect(links[0]!.targetId).toBe(target.id)
    })

    it("should remove app link", async () => {
      const source = await graph.mutate.create("module", { name: "source" })
      const target = await graph.mutate.create("module", { name: "target" })
      const type = await graph.mutate.create("type", { name: "link", title: "Link" })

      await graph.mutate.link("ofType", source.id, type.id)
      await adapter.createAppLink(source.id as ModuleId, target.id as NodeId)

      // Remove link
      await adapter.removeAppLink(source.id as ModuleId, target.id as NodeId)

      const links = await adapter.listAppLinks(source.id as ModuleId)
      expect(links).toHaveLength(0)
    })
  })
})
