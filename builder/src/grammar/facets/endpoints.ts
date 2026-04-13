// oxlint-disable typescript/no-explicit-any
/** Cardinality for an endpoint */
export type Cardinality = '0..*' | '1..*' | '0..1' | '1'

/** Default cardinality when omitted */
export const DEFAULT_CARDINALITY: Cardinality = '0..*'

/**
 * Edge endpoint configuration.
 * Const generics capture literal types for `as`, `types`, and `cardinality`.
 */
export interface EndpointConfig<
  As extends string = string,
  Types extends readonly any[] = readonly any[],
  Card extends Cardinality = Cardinality,
> {
  readonly as: As
  readonly types: Types
  readonly cardinality?: Card
}
