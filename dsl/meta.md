

- class/kind
- relations(?)
- abstract
- attributes/properties
- constraints
  - types
  - cardinality (relations)
- extension (over the network ref)
- methods (input/output schemas)


## Meta-Syntax Reference

### Vocabulary

```
-- Canonical form          → Sugar             
abstract class node Name   → interface Name     
class node Name            → class Name         
class link Name()          → class Name()      
```

### Declarations

```
-- Type alias
type Name = ScalarType [modifiers]

-- Interface (abstract node type)
interface Name {
  attr: Type [modifiers] = default
}

-- Class (concrete node type)
class Name : Parent1, Parent2 {
  attr: Type [modifiers] = default
}

-- Class with signature (link type)
-- Parentheses after name → link, not node
class Name(param: Type, param: Type) [modifiers] {
  attr: Type [modifiers] = default
}

-- Extension
extend "uri" { Type1, Type2 }
```

### Type Expressions

```
Type                -- non-null (must provide at creation unless default)
Type?               -- nullable (defaults to null)
Type1 | Type2       -- union
link<Name>          -- reference to a named link type
link<any>           -- reference to any link
```

### Link Modifiers

```
[no_self]                                -- no self-loops
[acyclic]                                -- no cycles
[unique]                                 -- no duplicate links between same nodes
[symmetric]                              -- order-independent
[param -> N]                             -- exactly N
[param -> N..M]                          -- between N and M
[param -> N..*]                          -- at least N
[param -> 0..1]                          -- at most one
[on_kill_source: cascade|unlink|prevent]
[on_kill_target: cascade|unlink|prevent]
```

### Attribute Modifiers

```
[unique]               -- unique across all instances
[readonly]             -- immutable after creation
[indexed]              -- indexed for queries
[indexed: asc|desc]    -- indexed with direction
```

### Type-Level Modifiers (in type aliases)

```
[length: N..M]                            -- string length bounds
[format: email|url|uuid|slug|phone]       -- format validation
[match: "regex"]                          -- regex validation
[in: ["a", "b", "c"]]                    -- enum constraint
[>= N]                                    -- min value
[<= N]                                    -- max value
[N..M]                                    -- value range
```

### Cardinality

```
class R(a: A, b: B) [a -> C]
-- "for each a, how many R links can it have?"

a -> 1           -- exactly one
a -> 0..1        -- at most one
a -> 1..*        -- at least one
a -> 0..*        -- unconstrained (default, never written)
a -> N..M        -- between N and M
a -> N           -- exactly N
```

---
