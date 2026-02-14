// src/lsp/definition.ts
// ============================================================
// Go-to-Definition — Navigate to declaration site
// ============================================================

import { Location, Range } from "vscode-languageserver-types";
import { Workspace, DocumentState } from "./workspace.js";

export function provideDefinition(
  workspace: Workspace,
  state: DocumentState,
  offset: number,
): Location | null {
  const symbol = workspace.symbolAt(state, offset);
  if (!symbol) return null;

  // Builtins and extension stubs have no source location
  if (!symbol.span || !symbol.declaration) return null;

  const start = state.lineMap.positionAt(symbol.span.start);
  const end = state.lineMap.positionAt(symbol.span.end);

  return {
    uri: state.document.uri,
    range: {
      start: { line: start.line, character: start.col },
      end: { line: end.line, character: end.col },
    },
  };
}
