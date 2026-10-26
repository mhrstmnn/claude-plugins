// The command Claude Code starts as the language server: installs the runtime if needed, starts
// typescript-language-server, and passes the protocol through, adding Vue support to the
// initialize request on the way.

import { spawn } from "node:child_process";
import path from "node:path";

import {
  addVueSupport,
  frameMessage,
  type Message,
  MessageReader,
  parseInitializeRequest,
  type RuntimePaths,
} from "./messages.ts";
import { ensureRuntime } from "./runtime.ts";

function fail(message: string): never {
  process.stderr.write(`vue-lsp: ${message}\n`);
  process.exit(1);
}

const dataDirectory = process.env["CLAUDE_PLUGIN_DATA"];
if (dataDirectory === undefined || dataDirectory === "") {
  fail("CLAUDE_PLUGIN_DATA isn't set; Claude Code sets it for a plugin's language servers");
}

let runtime: RuntimePaths;
try {
  runtime = ensureRuntime({
    dataDirectory,
    manifestPath: path.join(import.meta.dirname, "runtime", "package.json"),
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const server = spawn(process.execPath, [runtime.serverEntry, "--stdio"], {
  stdio: ["pipe", "inherit", "inherit"],
});
server.on("error", (error) => {
  fail(`can't start typescript-language-server: ${error.message}`);
});
server.on("exit", (code, signal) => {
  process.exit(code ?? (signal === null ? 0 : 1));
});
// A server that exits mid-write would otherwise crash this process before its exit code arrives.
server.stdin.on("error", () => {});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

// Only the initialize request changes, and it comes first, so the messages are parsed until it has
// passed and the rest of the stream is piped through untouched.
const reader = new MessageReader();
let initializePassed = false;

function forward(message: Message): Buffer {
  if (initializePassed) return message.raw;
  const request = parseInitializeRequest(message.body);
  if (request === undefined) return message.raw;
  initializePassed = true;
  return frameMessage(addVueSupport(request, runtime));
}

function endServerInput(): void {
  server.stdin.end();
}

function onClientData(chunk: Buffer): void {
  for (const message of reader.push(chunk)) server.stdin.write(forward(message));
  if (!initializePassed) return;
  process.stdin.off("data", onClientData);
  process.stdin.off("end", endServerInput);
  server.stdin.write(reader.takeRemainder());
  process.stdin.pipe(server.stdin);
}

process.stdin.on("data", onClientData);
process.stdin.on("end", endServerInput);
