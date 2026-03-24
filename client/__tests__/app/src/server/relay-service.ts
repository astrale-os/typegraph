import type {
  UnresolvedIdentityExpr,
  AccessDecision,
  AccessExplanation,
} from '../../../integration/authz-v2/types'

import { IdentityRegistry } from '../../../integration/authz-v2/authentication/identity-registry'
import { IssuerKeyStore } from '../../../integration/authz-v2/authentication/issuer-key-store'
import {
  KernelService,
  createAppJwt,
  createUserJwt,
  decodeMockJwt,
  KERNEL_ISSUER,
} from '../../../integration/authz-v2/authentication/relay-token'
import { playgroundClient } from './falkordb-client'

let kernelService: KernelService | null = null

export function getKernelService(): KernelService {
  if (!kernelService) {
    throw new Error('Relay service not initialized. Call setup first.')
  }
  return kernelService
}

export function setupRelayService(identityIds?: string[]): void {
  const registry = new IdentityRegistry()
  const keyStore = new IssuerKeyStore()

  // Register kernel as trusted issuer
  keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')

  // Register common test IdPs
  keyStore.registerIssuer('workos.test', 'workos-key')
  keyStore.registerIssuer('idp.test', 'idp-key')

  // If identity IDs are provided, register them as both self-issuers and workos.test users
  if (identityIds) {
    for (const id of identityIds) {
      // App identities: self-issued
      keyStore.registerIssuer(id, `${id}-key`)
      registry.register(id, id, id)

      // User identities: issued by workos.test
      registry.register('workos.test', id, id)
      registry.register('idp.test', id, id)
    }
  }

  kernelService = new KernelService(registry, keyStore)
}

export async function handleRelaySetup(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const identityIds = body.identityIds as string[] | undefined
  setupRelayService(identityIds)
  return { ok: true }
}

export async function handleIssueToken(
  body: Record<string, unknown>,
): Promise<{ token: string; decoded: { header: unknown; payload: unknown } }> {
  const type = body.type as 'app' | 'user'
  const id = body.id as string
  const issuer = body.issuer as string | undefined

  if (!type || !id) {
    throw new Error('type and id are required')
  }

  let token: string
  if (type === 'app') {
    token = createAppJwt(id)
  } else {
    token = createUserJwt(id, issuer || 'workos.test')
  }

  const decoded = decodeMockJwt(token)
  return { token, decoded }
}

export async function handleRelayToken(body: Record<string, unknown>): Promise<{
  token: string
  expires_at: number
  decoded: { header: unknown; payload: unknown }
}> {
  const service = getKernelService()
  const expression = body.expression as UnresolvedIdentityExpr
  const scopes = body.scopes as unknown
  const ttl = body.ttl as number | undefined

  if (!expression) {
    throw new Error('expression is required')
  }

  const result = await service.relayToken({
    expression: expression as any,
    scopes: scopes as any,
    ttl,
  })

  const decoded = decodeMockJwt(result.token)
  return { ...result, decoded }
}

export async function handleAuthenticate(
  body: Record<string, unknown>,
): Promise<{ authContext: unknown }> {
  const service = getKernelService()
  const token = body.token as string

  if (!token) {
    throw new Error('token is required')
  }

  const authContext = await service.authenticate(token)
  return { authContext }
}

export async function handleDecodeToken(
  body: Record<string, unknown>,
): Promise<{ header: unknown; payload: unknown }> {
  const token = body.token as string

  if (!token) {
    throw new Error('token is required')
  }

  return decodeMockJwt(token)
}

export async function handleKernelCheckAccess(body: Record<string, unknown>): Promise<{
  authContext: unknown
  result: AccessDecision | AccessExplanation
  mode: 'check' | 'explain'
}> {
  const service = getKernelService()
  const token = body.token as string
  const nodeId = body.nodeId as string
  const perm = body.perm as string
  const mode = (body.mode as 'check' | 'explain') || 'check'

  if (!token || !nodeId || !perm) {
    throw new Error('token, nodeId, and perm are required')
  }

  const authContext = await service.authenticate(token)

  const params = {
    principal: authContext.principal,
    grant: authContext.grant,
    nodeId,
    perm,
  }

  const { result } =
    mode === 'explain'
      ? await playgroundClient.explainAccess(params)
      : await playgroundClient.checkAccess(params)

  return { authContext, result, mode }
}
