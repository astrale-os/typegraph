# Astrale — Architecture Schema

## Pipeline du Compilateur (.gsl → IR)

```
.gsl → Lexer → tokens → Parser → CST → Lower → AST → Resolver → ResolvedSchema → Validator → Serializer → Schema IR
```

| Phase        | Entrée           | Sortie             | Rôle                                                       |
|--------------|------------------|--------------------|-------------------------------------------------------------|
| **Lexer**    | source `.gsl`    | Token stream       | Tokenisation sans mots réservés, trivia (espaces/comments) |
| **Parser**   | Tokens           | CST (lossless)     | Recursive descent, error recovery, conserve chaque token    |
| **Lower**    | CST              | AST                | Désugage : `class follows(a, b)` → `EdgeDecl`              |
| **Resolver** | AST + Prelude    | ResolvedSchema     | Table de symboles, résolution des types, `extend`           |
| **Validator**| ResolvedSchema   | Diagnostics        | Héritage, cardinalité, modifiers contradictoires            |
| **Serializer**| ResolvedSchema  | Schema IR (JSON)   | Aplatit l'héritage, discrimine `node \| edge`               |

### Prelude

Scalaires injectés avant la résolution. Deux variantes :

- **Default** : `String`, `Int`, `Float`, `Boolean`, `Timestamp`
- **Kernel** : Default + `Bitmask`, `ByteString`

## Schema IR — Représentation Intermédiaire

```typescript
SchemaIR {
  version: '1.0'
  classes: (NodeDef | EdgeDef)[]   // discriminé par type: 'node' | 'edge'
  extensions: Extension[]          // déclarations extend
  builtin_scalars: string[]
  type_aliases: TypeAlias[]        // type Email = String [format: email]
  value_types: ValueTypeDef[]      // type Coords = { lat, lng }
}
```

Chaque `NodeDef` porte `abstract: true` pour les interfaces. Les attributs sont aplatis depuis l'héritage.

## Définir un Kernel

Le kernel compose son schéma par modules :

```typescript
import { defineSchema, node, edge } from '@astrale/typegraph-core'

export const KernelSchema = defineSchema({
  nodes: { ...CoreNodes, ...IdentityNodes, ...ChannelNodes, ...PolicyNodes, ...OperationNodes },
  edges: { ...CoreEdges, ...IdentityEdges, ...ChannelEdges, ...PolicyEdges, ...OperationEdges },
  hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
})
```

Les 5 modules du kernel : **Core** (node, type, link), **Identity** (identity, auth algebra), **Channel**, **Policy**, **Operation**.

Types exportés :

```typescript
type NodeKind = 'node' | 'type' | 'identity' | 'policy' | ...
type EdgeKind = 'hasParent' | 'ofType' | 'hasPerm' | ...
type Identity = Node<'identity'>  // typage fort par label
```

## Compiler une Distribution (App)

Chaque app étend le kernel via `defineApp` :

```typescript
export const ConnectorApp = defineApp({
  app: { name: 'Connector', slug: 'connector', version: v.semver(1, 0) },
  modules: {
    INTEGRATIONS: container('Integrations'),
    CONNECTION: container('Connection', { metadata: ConnectionMetaSchema }),
  },
  links: {
    OF_INTEGRATION: link()({ from: 'CONNECTION', to: 'INTEGRATION', cardinality: { from: 'many', to: 'one' } }),
  },
  appdata: {
    avatar: (m) => ({ integrations: module('My Integrations', m.INTEGRATIONS) }),
    space: (m) => ({ integrations: module('Shared Integrations', m.INTEGRATIONS) }),
  },
})
```

Structure d'une app : `core/` (définition + types) → `backend/` (Hono API) → `frontend/` (React UI) → `worker/` (entry).

## Codegen (IR → TypeScript)

```
SchemaIR[] → Loader → GraphModel → Emitters → .ts
```

| Emitter          | Génère                                      |
|------------------|---------------------------------------------|
| `enums`          | Enums TS depuis contraintes `in: [...]`     |
| `interfaces`     | Interfaces Node/Edge typées                 |
| `validators`     | Schémas Zod pour validation runtime         |
| `schema-value`   | Topologie du graphe (nodes, edges, hierarchy)|
| `typemap`        | `createGraph` typé + types d'entrée         |
| `core`           | DSL : `defineCore`, `node()`, `edge()`      |

## Migration (Diff → Plan)

```typescript
const diff = diffSchema(previousSchema, currentSchema)
// → { breaking: boolean, breakingReasons: string[], warnings: string[] }
```

**Breaking** : propriété requise ajoutée sans default, type changé, nœud/edge supprimé, cardinalité modifiée.

Index : `compileSchemaIndexes(schema)` → statements Cypher `CREATE INDEX / CONSTRAINT`.

## LSP

Exploite les artefacts du compilateur (CST, AST, table de symboles) pour l'autocomplétion, diagnostics et navigation dans l'IDE (extension VS Code).

### Rebuild & deploy le LSP

Le serveur LSP est un bundle esbuild du compilateur. Après toute modification du
compilateur, il faut rebuilder **et** copier dans l'extension installée.

```bash
# 1. Build le bundle serveur + extension
cd typegraph/vscode
npm run build

# 2. Copier dans l'extension Cursor/VSCode installée
DEST=~/.cursor/extensions/astrale.kernel-lang-0.1.0
cp ../kernel-vscode/server/server.js $DEST/server/server.js
cp language-configuration.json $DEST/language-configuration.json
cp syntaxes/gsl.tmLanguage.json $DEST/syntaxes/gsl.tmLanguage.json

# 3. Reload Window dans l'IDE (Cmd+Shift+P → "Reload Window")
```

**Pourquoi ces copies ?** Le build produit les fichiers dans le dossier source.
L'extension installée dans `~/.cursor/extensions/` est une copie séparée —
elle n'est pas mise à jour automatiquement. Il faut copier le serveur LSP
**et** les fichiers statiques (grammaire TextMate, config du langage) si modifiés.

> On peut aussi passer un outdir custom : `node scripts/bundle-server.mjs ../vscode/server`
> mais ça ne met pas à jour l'extension installée non plus.

### Architecture du bundle

- **Entry point** : `src/lsp/main.ts` — importe `kernel.gsl` comme texte
  (via esbuild `loader: { '.gsl': 'text' }`) pour éviter les accès filesystem
- **Registry** : `LazyFileRegistry` wraps le kernel pré-compilé + compile les
  fichiers locaux à la demande quand un `extend "./file.gsl"` est rencontré
- **Format** : CJS (pour compatibilité VS Code), single file `server.js`
