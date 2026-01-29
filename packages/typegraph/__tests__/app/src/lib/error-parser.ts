export interface ParsedError {
  title: string
  message: string
  details?: string
  suggestion?: string
}

const patterns: Array<{
  test: (msg: string) => boolean
  parse: (msg: string) => ParsedError
}> = [
  {
    test: (msg) => /ECONNREFUSED|connect ECONNREFUSED/i.test(msg),
    parse: (msg) => ({
      title: 'Connection Refused',
      message: 'Could not connect to the FalkorDB server.',
      details: msg,
      suggestion:
        'Make sure the database is running (docker compose up -d) and check host/port settings.',
    }),
  },
  {
    test: (msg) => /not connected/i.test(msg),
    parse: (msg) => ({
      title: 'Not Connected',
      message: 'No active database connection.',
      details: msg,
      suggestion: 'Connect to FalkorDB first using the connection panel.',
    }),
  },
  {
    test: (msg) => /no graph selected/i.test(msg),
    parse: (msg) => ({
      title: 'No Graph Selected',
      message: 'A graph must be selected before running queries.',
      details: msg,
      suggestion: 'Select or create a graph using the graph selector.',
    }),
  },
  {
    test: (msg) => /node.*not found|unknown node|ERR.*unknown/i.test(msg),
    parse: (msg) => ({
      title: 'Node Not Found',
      message: 'The referenced node does not exist in the graph.',
      details: msg,
      suggestion: 'Seed the graph first, or verify the node ID exists.',
    }),
  },
  {
    test: (msg) => /invalid expression|expression.*invalid/i.test(msg),
    parse: (msg) => ({
      title: 'Invalid Expression',
      message: 'The identity expression is malformed.',
      details: msg,
      suggestion:
        'Check the expression structure. Each node needs a kind (identity/union/intersect/exclude).',
    }),
  },
  {
    test: (msg) => /all fields are required/i.test(msg),
    parse: () => ({
      title: 'Missing Fields',
      message: 'Some required fields are empty.',
      suggestion:
        'Fill in target resource, permission, principal, and at least one grant expression.',
    }),
  },
  {
    test: (msg) => /syntax error|invalid cypher/i.test(msg),
    parse: (msg) => ({
      title: 'Cypher Syntax Error',
      message: 'The Cypher query contains a syntax error.',
      details: msg,
      suggestion: 'Check your Cypher query syntax.',
    }),
  },
]

export function parseError(error: string | Error): ParsedError {
  const msg = typeof error === 'string' ? error : error.message

  for (const pattern of patterns) {
    if (pattern.test(msg)) {
      return pattern.parse(msg)
    }
  }

  return {
    title: 'Error',
    message: msg,
  }
}
