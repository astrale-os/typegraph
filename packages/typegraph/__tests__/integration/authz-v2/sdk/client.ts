/**
 * AUTH_V2 Request-Context SDK
 *
 * Request-context-driven SDK where relay tokens flow automatically.
 *
 * 99% case: sdk.fromRelay(token) → ctx.read("M1") — one line.
 * 1% case: ctx.compose(other, "union"), ctx.withScope(scope) — immutable, lazy.
 */

import type {
  Scope,
  RelayTokenRequest,
  RelayTokenResponse,
  UnresolvedIdentityExpr,
  AccessDecision,
} from '../types'
import { type KernelService } from '../authentication/relay-token'
import {
  unresolvedJwt,
  unresolvedUnion,
  unresolvedIntersect,
  unresolvedExclude,
} from '../authentication/grant-encoding'
import { TokenVerifier, type TokenPayload, KERNEL_ISSUER } from '../authentication/token-verifier'
import type { FalkorDBIdentityAdapter } from '../adapter/falkordb-identity.adapter'

// =============================================================================
// KERNEL PORT (interface, mockable)
// =============================================================================

export interface KernelPort {
  checkAccess(appToken: string, resourceId: string, perm: string): Promise<AccessDecision>
  relayToken(request: RelayTokenRequest): Promise<RelayTokenResponse>
  callApp(relayToken: string, appSlug: string, method: string, params?: unknown): Promise<unknown>
}

// =============================================================================
// CONFIG TYPES
// =============================================================================

export interface AppSDKConfig {
  appId: string
  kernel: KernelPort
}

export interface MockKernelConfig {
  kernelService: KernelService
  accessChecker: FalkorDBIdentityAdapter
  /** Separate kernel for authenticating app JWTs (JSON-only). Defaults to kernelService. */
  authKernel?: KernelService
}

// =============================================================================
// REQUEST CONTEXT (per-request, immutable)
// =============================================================================

export class RequestContext {
  private readonly _appId: string
  private readonly _kernel: KernelPort
  private readonly _expression: UnresolvedIdentityExpr | undefined
  private readonly _pendingScopes: Scope[]
  private _resolvedRelayCache: string | null = null

  constructor(
    appId: string,
    kernel: KernelPort,
    expression?: UnresolvedIdentityExpr,
    pendingScopes: Scope[] = [],
  ) {
    this._appId = appId
    this._kernel = kernel
    this._expression = expression
    this._pendingScopes = pendingScopes
  }

  // ── 99% case: access checks ──

  async read(resourceId: string): Promise<AccessDecision> {
    return this.check(resourceId, 'read')
  }

  async edit(resourceId: string): Promise<AccessDecision> {
    return this.check(resourceId, 'edit')
  }

  async use(resourceId: string): Promise<AccessDecision> {
    return this.check(resourceId, 'use')
  }

  async check(resourceId: string, perm: string): Promise<AccessDecision> {
    const appToken = await this.resolveAppToken()
    return this._kernel.checkAccess(appToken, resourceId, perm)
  }

  compose(other: string | RequestContext, op: 'union' | 'intersect' | 'exclude'): RequestContext {
    const thisExpr = this._expression
    if (!thisExpr) {
      throw new Error('Cannot compose a bare context')
    }

    let otherExpr: UnresolvedIdentityExpr
    if (typeof other === 'string') {
      otherExpr = unresolvedJwt(other)
    } else {
      if (!other._expression) {
        throw new Error('Cannot compose with a bare context')
      }
      otherExpr = other._expression
    }

    let expression: UnresolvedIdentityExpr
    switch (op) {
      case 'union':
        // Flatten if this expression is already a union
        if (thisExpr.kind === 'union') {
          expression = { kind: 'union', operands: [...thisExpr.operands, otherExpr] }
        } else {
          expression = unresolvedUnion(thisExpr, otherExpr)
        }
        break
      case 'intersect':
        // Flatten if this expression is already an intersect
        if (thisExpr.kind === 'intersect') {
          expression = { kind: 'intersect', operands: [...thisExpr.operands, otherExpr] }
        } else {
          expression = unresolvedIntersect(thisExpr, otherExpr)
        }
        break
      case 'exclude':
        // Flatten if this expression is already an exclude
        if (thisExpr.kind === 'exclude') {
          expression = { kind: 'exclude', base: thisExpr.base, excluded: [...thisExpr.excluded, otherExpr] }
        } else {
          expression = unresolvedExclude(thisExpr, otherExpr)
        }
        break
    }

    return new RequestContext(this._appId, this._kernel, expression, [...this._pendingScopes])
  }

  withScope(scope: Scope): RequestContext {
    return new RequestContext(this._appId, this._kernel, this._expression, [
      ...this._pendingScopes,
      scope,
    ])
  }

  // ── forwarding ──

  async callApp(appSlug: string, method: string, params?: unknown): Promise<unknown> {
    if (
      this._expression &&
      this._expression.kind === 'identity' &&
      'jwt' in this._expression &&
      this._pendingScopes.length === 0
    ) {
      return this._kernel.callApp(this._expression.jwt, appSlug, method, params)
    }
    const relay = await this.mintRelay()
    return this._kernel.callApp(relay.token, appSlug, method, params)
  }

  async mintRelay(options?: { ttl?: number; scopes?: Scope[] }): Promise<RelayTokenResponse> {
    if (!this._expression) {
      throw new Error('Cannot mint relay from a bare context')
    }

    const allScopes = [...this._pendingScopes, ...(options?.scopes ?? [])]

    return this._kernel.relayToken({
      expression: this._expression,
      scopes: allScopes.length > 0 ? allScopes : undefined,
      ttl: options?.ttl,
    })
  }

  // ── internal ──

  private async resolveAppToken(): Promise<string> {
    if (this._pendingScopes.length === 0) {
      return this.mintAppTokenDirect()
    }

    if (!this._resolvedRelayCache) {
      if (!this._expression) {
        throw new Error('Cannot resolve scoped token from a bare context')
      }
      const relay = await this._kernel.relayToken({
        expression: this._expression,
        scopes: this._pendingScopes,
      })
      this._resolvedRelayCache = relay.token
    }

    return this.mintAppTokenFromRelay(this._resolvedRelayCache)
  }

  private mintAppTokenDirect(): string {
    const now = Math.floor(Date.now() / 1000)
    const payload: TokenPayload = {
      iss: this._appId,
      sub: this._appId,
      aud: KERNEL_ISSUER,
      iat: now,
      exp: now + 3600,
      grant: this._expression ? { v: 1, forResource: this._expression } : undefined,
    }
    return TokenVerifier.createMockToken(payload)
  }

  private mintAppTokenFromRelay(relayToken: string): string {
    const now = Math.floor(Date.now() / 1000)
    const payload: TokenPayload = {
      iss: this._appId,
      sub: this._appId,
      aud: KERNEL_ISSUER,
      iat: now,
      exp: now + 3600,
      grant: { v: 1, forResource: unresolvedJwt(relayToken) },
    }
    return TokenVerifier.createMockToken(payload)
  }
}

// =============================================================================
// APP SDK (factory, one per app)
// =============================================================================

export class AppSDK {
  private readonly appId: string
  private readonly kernel: KernelPort

  constructor(config: AppSDKConfig) {
    this.appId = config.appId
    this.kernel = config.kernel
  }

  fromRelay(relayToken: string): RequestContext {
    return new RequestContext(this.appId, this.kernel, unresolvedJwt(relayToken))
  }

  bare(): RequestContext {
    return new RequestContext(this.appId, this.kernel)
  }
}

// =============================================================================
// MOCK KERNEL (test implementation)
// =============================================================================

export class MockKernel implements KernelPort {
  private readonly kernelService: KernelService
  private readonly authKernel: KernelService
  private readonly accessChecker: FalkorDBIdentityAdapter

  constructor(config: MockKernelConfig) {
    this.kernelService = config.kernelService
    this.authKernel = config.authKernel ?? config.kernelService
    this.accessChecker = config.accessChecker
  }

  async checkAccess(appToken: string, resourceId: string, perm: string): Promise<AccessDecision> {
    const authCtx = await this.authKernel.authenticate(appToken)
    return this.accessChecker.checkAccess({
      principal: authCtx.principal,
      grant: authCtx.grant,
      nodeId: resourceId,
      perm,
    })
  }

  async relayToken(request: RelayTokenRequest): Promise<RelayTokenResponse> {
    return this.kernelService.relayToken(request)
  }

  async callApp(
    _relayToken: string,
    _appSlug: string,
    _method: string,
    _params?: unknown,
  ): Promise<unknown> {
    throw new Error('callApp not implemented')
  }
}
