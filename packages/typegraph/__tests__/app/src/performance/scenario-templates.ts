/**
 * Scenario Templates
 *
 * Scale-independent scenario definitions that use selectors instead of hardcoded IDs.
 * These templates are instantiated with graph metadata to produce concrete test scenarios.
 */

// =============================================================================
// SELECTOR TYPES
// =============================================================================

export type NodeSelector =
  | { strategy: 'byDepth'; depth: number | 'max' | 'mid' }
  | { strategy: 'byType'; typeId: string }
  | { strategy: 'leaf' }
  | { strategy: 'random' }
  | { strategy: 'space' }
  | { strategy: 'withPermission'; perm: string }

export type UserSelector =
  | { strategy: 'withPermissionOn'; perm: string }
  | { strategy: 'withoutPermissionOn'; perm: string }
  | { strategy: 'random' }
  | { strategy: 'composed'; compositionType: 'union' | 'exclude' }
  | { strategy: 'composedInline'; compositionType: 'union' | 'exclude' }

export type AppSelector =
  | { strategy: 'first' }
  | { strategy: 'random' }
  | { strategy: 'withTypePermission'; typeIndex?: number }

// =============================================================================
// SCENARIO TEMPLATE INTERFACE
// =============================================================================

export interface ScenarioTemplate {
  id: string
  name: string
  description: string

  // Dynamic selectors
  appSelector: AppSelector
  userSelector: UserSelector
  nodeSelector: NodeSelector
  perm: string

  // Expected outcome
  expectedGranted: boolean | 'compute'
}

// =============================================================================
// SCENARIO TEMPLATES
// =============================================================================

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  // =========================================================================
  // HIERARCHICAL ACCESS SCENARIOS
  // =========================================================================
  {
    id: 'shallow-access',
    name: 'Shallow Access (Depth 2)',
    description: 'Access check on a node at depth 2 with permission inherited from space',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'byDepth', depth: 2 },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },
  {
    id: 'mid-depth-access',
    name: 'Mid-Depth Access',
    description: 'Access check at middle of hierarchy depth',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'byDepth', depth: 'mid' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },
  {
    id: 'deep-access',
    name: 'Deep Access (Max Depth)',
    description: 'Access check at maximum hierarchy depth requiring full traversal',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'byDepth', depth: 'max' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },
  {
    id: 'leaf-access',
    name: 'Leaf Node Access',
    description: 'Access check on a leaf node (no children)',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'leaf' },
    userSelector: { strategy: 'withPermissionOn', perm: 'edit' },
    perm: 'edit',
    expectedGranted: true,
  },

  // =========================================================================
  // DIRECT PERMISSION SCENARIOS
  // =========================================================================
  {
    id: 'direct-permission',
    name: 'Direct Permission',
    description: 'Access check where user has direct permission on target',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'withPermission', perm: 'read' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },
  {
    id: 'space-level-permission',
    name: 'Space-Level Permission',
    description: 'Access check on space node itself',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'space' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },

  // =========================================================================
  // COMPOSED IDENTITY SCENARIOS (Direct Reference)
  // These test the identity evaluator's composition resolution logic
  // =========================================================================
  {
    id: 'union-direct',
    name: 'Union Identity (Direct)',
    description: 'Access using composed identity reference - evaluator resolves union from graph',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'composed', compositionType: 'union' },
    perm: 'read',
    expectedGranted: 'compute',
  },
  {
    id: 'exclude-direct',
    name: 'Exclude Identity (Direct)',
    description: 'Access using composed identity reference - evaluator resolves exclude from graph',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'composed', compositionType: 'exclude' },
    perm: 'edit',
    expectedGranted: 'compute',
  },

  // =========================================================================
  // COMPOSED IDENTITY SCENARIOS (Inline Expression)
  // These test the query generator's handling of union/exclude expressions
  // =========================================================================
  {
    id: 'union-inline',
    name: 'Union Identity (Inline)',
    description: 'Access using inline union expression - query generator builds OR conditions',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'composedInline', compositionType: 'union' },
    perm: 'read',
    expectedGranted: 'compute',
  },
  {
    id: 'exclude-inline',
    name: 'Exclude Identity (Inline)',
    description:
      'Access using inline exclude expression - query generator builds AND NOT conditions',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'composedInline', compositionType: 'exclude' },
    perm: 'edit',
    expectedGranted: 'compute',
  },

  // =========================================================================
  // DENIAL SCENARIOS
  // =========================================================================
  {
    id: 'denied-no-permission',
    name: 'Denied (No Permission)',
    description: 'Access check where user has no permission path to target',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'withoutPermissionOn', perm: 'share' },
    perm: 'share',
    expectedGranted: false,
  },
  {
    id: 'denied-wrong-perm',
    name: 'Denied (Wrong Permission)',
    description: 'Access check where user has different permission than requested',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'withPermission', perm: 'read' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'share',
    expectedGranted: false,
  },

  // =========================================================================
  // PERMISSION TYPE SCENARIOS
  // =========================================================================
  {
    id: 'read-permission',
    name: 'Read Permission Check',
    description: 'Standard read permission check',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'withPermissionOn', perm: 'read' },
    perm: 'read',
    expectedGranted: true,
  },
  {
    id: 'edit-permission',
    name: 'Edit Permission Check',
    description: 'Edit permission check (typically more restricted)',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'withPermissionOn', perm: 'edit' },
    perm: 'edit',
    expectedGranted: true,
  },
  {
    id: 'use-permission',
    name: 'Use Permission Check',
    description: 'Use permission check on module',
    appSelector: { strategy: 'withTypePermission' },
    nodeSelector: { strategy: 'random' },
    userSelector: { strategy: 'withPermissionOn', perm: 'use' },
    perm: 'use',
    expectedGranted: true,
  },
]

// =============================================================================
// HELPER: Get templates by category
// =============================================================================

export function getTemplatesByCategory(): Record<string, ScenarioTemplate[]> {
  return {
    Hierarchical: SCENARIO_TEMPLATES.filter((t) =>
      ['shallow-access', 'mid-depth-access', 'deep-access', 'leaf-access'].includes(t.id),
    ),
    Direct: SCENARIO_TEMPLATES.filter((t) =>
      ['direct-permission', 'space-level-permission'].includes(t.id),
    ),
    'Composed (Direct)': SCENARIO_TEMPLATES.filter((t) =>
      ['union-direct', 'exclude-direct'].includes(t.id),
    ),
    'Composed (Inline)': SCENARIO_TEMPLATES.filter((t) =>
      ['union-inline', 'exclude-inline'].includes(t.id),
    ),
    Denial: SCENARIO_TEMPLATES.filter((t) =>
      ['denied-no-permission', 'denied-wrong-perm'].includes(t.id),
    ),
    'Permission Types': SCENARIO_TEMPLATES.filter((t) =>
      ['read-permission', 'edit-permission', 'use-permission'].includes(t.id),
    ),
  }
}
