import { buildCorePath } from './path.js'

export const kernelRefs = {
  root: buildCorePath('kernel.astrale.ai', []),
  system: buildCorePath('kernel.astrale.ai', ['system']),
}
