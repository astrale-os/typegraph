// src/extension.ts
// ============================================================
// VS Code Extension — LSP Client
//
// Finds the bundled server at ./server/server.js and connects
// over stdio.
// ============================================================

import * as path from "path";
import { workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
  const serverModule = path.join(context.extensionPath, "server", "server.js");

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.stdio,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "gsl" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.gsl"),
    },
    outputChannelName: "Kernel Language Server",
  };

  client = new LanguageClient(
    "gsl",
    "Kernel Language Server",
    serverOptions,
    clientOptions,
  );

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
