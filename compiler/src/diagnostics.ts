// src/diagnostics.ts
// ============================================================
// Diagnostics — Structured Error Reporting
//
// Used by all phases (lexer, parser, resolver, validator).
// Each diagnostic carries a span, severity, and message.
// The LSP layer maps these directly to LSP diagnostics.
// ============================================================

import { Span } from "./tokens.js";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  span: Span;
  message: string;
  /** Machine-readable code for programmatic handling. */
  code: string;
}

/**
 * Accumulates diagnostics across compiler phases.
 * Passed through the pipeline so later phases can
 * add diagnostics without losing earlier ones.
 */
export class DiagnosticBag {
  private diagnostics: Diagnostic[] = [];

  error(span: Span, code: string, message: string): void {
    this.diagnostics.push({ severity: "error", span, code, message });
  }

  warning(span: Span, code: string, message: string): void {
    this.diagnostics.push({ severity: "warning", span, code, message });
  }

  info(span: Span, code: string, message: string): void {
    this.diagnostics.push({ severity: "info", span, code, message });
  }

  hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }

  getAll(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  getErrors(): Diagnostic[] {
    return this.diagnostics.filter((d) => d.severity === "error");
  }

  getWarnings(): Diagnostic[] {
    return this.diagnostics.filter((d) => d.severity === "warning");
  }
}

// --- Diagnostic Codes ---
// Organized by phase. Codes are namespaced to make filtering easy.

export const DiagnosticCodes = {
  // Lexer (L)
  L_UNEXPECTED_CHAR: "L001",
  L_UNTERMINATED_STRING: "L002",
  L_INVALID_NUMBER: "L003",

  // Parser (P)
  P_EXPECTED_TOKEN: "P001",
  P_UNEXPECTED_TOKEN: "P002",
  P_EXPECTED_DECLARATION: "P003",
  P_EXPECTED_EXPRESSION: "P004",
  P_EXPECTED_TYPE: "P005",
  P_EXPECTED_MODIFIER: "P006",
  P_UNCLOSED_BRACE: "P007",
  P_UNCLOSED_BRACKET: "P008",
  P_UNCLOSED_PAREN: "P009",

  // Resolver (R)
  R_UNKNOWN_TYPE: "R001",
  R_DUPLICATE_NAME: "R002",
  R_UNKNOWN_INTERFACE: "R003",
  R_CIRCULAR_EXTENDS: "R004",
  R_UNRESOLVED_EXTENSION: "R005",
  R_KIND_MISMATCH: "R006",

  // Validator (V)
  V_INVALID_MODIFIER: "V001",
  V_INVALID_CARDINALITY: "V002",
  V_CLASS_EXTENDS_CLASS: "V003",
  V_INTERFACE_IMPLEMENTS: "V004",
  V_SELF_LOOP_IMPOSSIBLE: "V005",
  V_DEFAULT_TYPE_MISMATCH: "V006",
  V_CONFLICTING_MODIFIERS: "V007",
  V_ACYCLIC_REQUIRES_COMPATIBLE: "V008",
  V_UNKNOWN_FUNCTION: "V009",
} as const;
