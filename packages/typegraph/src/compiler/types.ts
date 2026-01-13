/**
 * Compiler Type Definitions
 */

/**
 * A compiled query ready for execution.
 */
export interface CompiledQuery {
  cypher: string;
  params: Record<string, unknown>;
  resultType: 'single' | 'collection' | 'multiNode' | 'path' | 'aggregate' | 'scalar' | 'void';
  meta: {
    complexity: number;
    hasVariableLengthPath: boolean;
    hasAggregation: boolean;
    matchCount: number;
    returnAliases?: string[];
  };
}

/**
 * Options for the compiler.
 */
export interface CompilerOptions {
  includeComments?: boolean;
  parameterizeLabels?: boolean;
  paramPrefix?: string;
  explain?: boolean;
  profile?: boolean;
}

