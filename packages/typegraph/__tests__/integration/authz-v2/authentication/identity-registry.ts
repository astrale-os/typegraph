/**
 * AUTH_V2 Identity Registry
 *
 * Mock implementation of (iss, sub) → IdentityId lookup.
 * In production, this would be a graph database query.
 */

import type { IdentityId } from '../types'
import { KERNEL_ISSUER } from './token-verifier'

/**
 * Mock identity registry: (iss, sub) → IdentityId
 * In production, this would be a graph lookup.
 */
export class IdentityRegistry {
  private identities = new Map<string, IdentityId>()

  private makeKey(iss: string, sub: string): string {
    return `${iss}::${sub}`
  }

  register(iss: string, sub: string, identityId: IdentityId): void {
    this.identities.set(this.makeKey(iss, sub), identityId)
  }

  resolve(iss: string, sub: string): IdentityId | undefined {
    // Kernel-issued tokens: sub IS the identityId
    if (iss === KERNEL_ISSUER) {
      return sub
    }
    return this.identities.get(this.makeKey(iss, sub))
  }

  /**
   * Resolve or throw if not found.
   */
  resolveOrThrow(iss: string, sub: string): IdentityId {
    const id = this.resolve(iss, sub)
    if (!id) {
      throw new Error(`Unknown identity: ${iss}::${sub}`)
    }
    return id
  }
}
