/**
 * AUTH_V2 Issuer Key Store
 *
 * Mock implementation of issuer → verification key lookup.
 * In production, this would fetch JWKS from issuer/.well-known/jwks.json
 */

/**
 * Mock issuer key store: issuer URL → verification key
 * In production, this would fetch JWKS from issuer/.well-known/jwks.json
 */
export class IssuerKeyStore {
  private keys = new Map<string, string>()

  /**
   * Register a trusted issuer with its signing key.
   */
  registerIssuer(issuer: string, key: string): void {
    this.keys.set(issuer, key)
  }

  /**
   * Get the verification key for an issuer.
   * Returns undefined if issuer is not trusted.
   */
  getKey(issuer: string): string | undefined {
    return this.keys.get(issuer)
  }

  /**
   * Check if an issuer is trusted.
   */
  isTrusted(issuer: string): boolean {
    return this.keys.has(issuer)
  }
}
