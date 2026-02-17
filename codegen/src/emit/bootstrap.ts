import type { GraphModel } from '../model'

/**
 * Emit the `schemaBootstrap` const — a static manifest of what
 * class/interface nodes and structural edges to create at install time.
 *
 * See: specs/11-schema-bootstrap.md §8
 */
export function emitBootstrap(model: GraphModel): string {
  const lines: string[] = []

  // ── Classes (concrete nodes + reified edges) ──────────────
  const classEntries: string[] = []

  for (const [, node] of model.nodeDefs) {
    if (node.abstract) continue
    classEntries.push(`    { key: '${node.name}', type: 'node' as const },`)
  }

  // Edges with attributes are reified → link-classes
  for (const [, edge] of model.edgeDefs) {
    if (edge.allAttributes.length > 0) {
      classEntries.push(`    { key: '${edge.name}', type: 'link' as const },`)
    }
  }

  // ── Interfaces (abstract nodes) ────────────────────────────
  const interfaceEntries: string[] = []

  for (const [, node] of model.nodeDefs) {
    if (!node.abstract) continue
    interfaceEntries.push(`    { key: '${node.name}' },`)
  }

  // ── Implements edges (concrete → abstract) ─────────────────
  const implementsEntries: string[] = []

  for (const [, node] of model.nodeDefs) {
    if (node.abstract) continue
    for (const iface of node.implements) {
      implementsEntries.push(
        `    { classKey: '${node.name}', interfaceKey: '${iface}' },`,
      )
    }
  }

  // ── Extends edges (abstract → abstract) ────────────────────
  const extendsEntries: string[] = []

  for (const [, node] of model.nodeDefs) {
    if (!node.abstract) continue
    for (const parent of node.implements) {
      extendsEntries.push(
        `    { childKey: '${node.name}', parentKey: '${parent}' },`,
      )
    }
  }

  // ── Emit ───────────────────────────────────────────────────
  lines.push('/** Bootstrap manifest — what class/interface nodes to create. */')
  lines.push('export const schemaBootstrap = {')
  lines.push('  classes: [')
  lines.push(...classEntries)
  lines.push('  ],')
  lines.push('  interfaces: [')
  lines.push(...interfaceEntries)
  lines.push('  ],')
  lines.push('  implements: [')
  lines.push(...implementsEntries)
  lines.push('  ],')
  lines.push('  extends: [')
  lines.push(...extendsEntries)
  lines.push('  ],')
  lines.push('} as const')

  return lines.join('\n')
}
