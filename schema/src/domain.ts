/**
 * Authoritative domain identity for a schema.
 *
 * A fully-qualified domain name (FQDN) that uniquely identifies the bounded
 * context a schema belongs to. Used for namespacing, lifecycle management,
 * and routing across local and federated graphs.
 *
 * @example 'astrale.core'     — kernel meta-model
 * @example 'acme.billing'     — third-party distribution
 * @example 'acme.todo'        — application domain
 */
export type DomainOrigin = string
