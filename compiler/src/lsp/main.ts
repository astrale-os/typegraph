// src/lsp/main.ts
// Entry point for the bundled LSP server.
// When loaded by the VS Code extension, starts immediately.
// The kernel schema is imported as text (via esbuild loader)
// so the bundle doesn't depend on filesystem access.

// @ts-expect-error — .gsl file imported as text by esbuild
import kernelSource from '../../kernel.gsl'
import { startServer } from './server'
import { KERNEL_PRELUDE } from '../prelude'
import { buildKernelRegistry } from '../kernel-prelude'
import { createLazyFileRegistry } from '../file-resolver'

const registry = createLazyFileRegistry(buildKernelRegistry(kernelSource), KERNEL_PRELUDE)
startServer(KERNEL_PRELUDE, registry)
