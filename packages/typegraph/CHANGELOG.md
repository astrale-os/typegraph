# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- Initial architecture and type definitions
- Schema definition with `node()` and `edge()` builders
- Query builders: SingleNode, Collection, OptionalNode, Path, Returning, Grouped
- AST representation for queries
- Cypher compiler (implementation pending)
- Query executor (implementation pending)
- Full TypeScript type inference from schema
- Support for edge property filtering during traversal
- Multi-node returns with `.as()` and `.returning()` API
- Query composition via `.pipe()`
- Implicit `id` field on all nodes and edges
- Directional edge traversal: `follow()`, `followInverse()`, `followBoth()`
- Comprehensive error types

### Removed

- Removed `bidirectional` flag from edge definitions (confusing and unnecessary)
  - All edges can be traversed in any direction at query time
  - Use `follow()` for declared direction, `followInverse()` for reverse, `followBoth()` for both

### Notes

This is the initial architecture release. Implementation of core functionality is in progress.

