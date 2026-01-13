# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1](https://github.com/astrale-os/typegraph/compare/typegraph-v0.2.0...typegraph-v0.2.1) (2026-01-13)


### Bug Fixes

* add license field to jsr.json files ([b658a49](https://github.com/astrale-os/typegraph/commit/b658a496a44c6bdf385984ba04c431bed5d25a08))

## [0.2.0](https://github.com/astrale-os/typegraph/compare/typegraph-v0.1.1...typegraph-v0.2.0) (2026-01-13)


### Features

* switch to JSR publishing with [@astrale](https://github.com/astrale) scope ([1f66405](https://github.com/astrale-os/typegraph/commit/1f66405b46ff898e110397b21c11a72bf11ff610))

## [0.1.1](https://github.com/astrale-os/typegraph/compare/typegraph-v0.1.0...typegraph-v0.1.1) (2026-01-13)


### Bug Fixes

* resolve build issues and fix package exports ([756ff18](https://github.com/astrale-os/typegraph/commit/756ff18d27e8f9f91b5c4f9b585af2bd16411cde))
* resolve typecheck errors across test files ([cf56c97](https://github.com/astrale-os/typegraph/commit/cf56c97f9d2558a874f6677a6836091aa0427125))


### Chores

* **ci:** add pre-push hook and improve type safety ([ad2d1c1](https://github.com/astrale-os/typegraph/commit/ad2d1c1706896640c7651d8f74e16b66f449eaf6))
* format all files with prettier ([f801aee](https://github.com/astrale-os/typegraph/commit/f801aeed6d0879a6cf64849306b26b3453e8ebbd))
* improve tsconfig settings for CI ([68df468](https://github.com/astrale-os/typegraph/commit/68df468f0d173425923234ca3caf71e049c6682a))
* initial monorepo setup ([0a56d6e](https://github.com/astrale-os/typegraph/commit/0a56d6ed1f0759e3be66d4ead44a45a58e692291))

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
