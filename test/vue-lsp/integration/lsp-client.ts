// Just enough of a Language Server Protocol client to drive the plugin's server in tests.

import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  frameMessage,
  isJsonObject,
  type JsonObject,
  MessageReader,
} from "../../../plugins/vue-lsp/server/messages.ts";

export interface Diagnostic {
  readonly message: string;
  readonly range: { readonly start: { readonly line: number; readonly character: number } };
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!isJsonObject(value) || typeof value["message"] !== "string") return false;
  const range = value["range"];
  const start = isJsonObject(range) ? range["start"] : undefined;
  return (
    isJsonObject(start) &&
    typeof start["line"] === "number" &&
    typeof start["character"] === "number"
  );
}

type Waiter = {
  readonly matches: (message: JsonObject) => boolean;
  readonly resolve: (message: JsonObject) => void;
};

export class LspClient {
  readonly #process: ChildProcessByStdio<Writable, Readable, null>;
  readonly #received: JsonObject[] = [];
  #waiters: Waiter[] = [];
  #nextId = 1;

  constructor(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) {
    this.#process = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "inherit"] });
    const reader = new MessageReader();
    this.#process.stdout.on("data", (chunk: Buffer) => {
      for (const { body } of reader.push(chunk)) {
        const message: unknown = JSON.parse(body.toString("utf8"));
        if (isJsonObject(message)) this.#receive(message);
      }
    });
  }

  #receive(message: JsonObject): void {
    // Answers the server's own requests (configuration, capability registration, progress).
    if (typeof message["method"] === "string" && message["id"] !== undefined) {
      const params = isJsonObject(message["params"]) ? message["params"] : {};
      const items = Array.isArray(params["items"]) ? params["items"] : [];
      const result = message["method"] === "workspace/configuration" ? items.map(() => null) : null;
      this.#send({ id: message["id"], result });
    }
    this.#received.push(message);
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      if (waiter.matches(message)) waiter.resolve(message);
      else this.#waiters.push(waiter);
    }
  }

  #send(message: JsonObject): void {
    this.#process.stdin.write(frameMessage({ jsonrpc: "2.0", ...message }));
  }

  /** Resolves with the first message, already received or still to come, that matches. */
  waitFor(
    matches: (message: JsonObject) => boolean,
    timeoutMilliseconds = 120_000,
  ): Promise<JsonObject> {
    const received = this.#received.find(matches);
    if (received !== undefined) return Promise.resolve(received);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for a message from the server"));
      }, timeoutMilliseconds);
      this.#waiters.push({
        matches,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  async request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.#nextId++;
    this.#send({ id, method, params });
    const reply = await this.waitFor(
      (message) => message["id"] === id && message["method"] === undefined,
    );
    if (reply["error"] !== undefined)
      throw new Error(`${method} failed: ${JSON.stringify(reply["error"])}`);
    return reply["result"];
  }

  notify(method: string, params: JsonObject): void {
    this.#send({ method, params });
  }

  async initialize(rootPath: string): Promise<void> {
    const rootUri = pathToFileURL(rootPath).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "fixture" }],
      capabilities: { textDocument: { publishDiagnostics: {}, definition: {}, hover: {} } },
    });
    this.notify("initialized", {});
  }

  open(filePath: string, languageId: string, text: string): string {
    const uri = pathToFileURL(filePath).href;
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
    return uri;
  }

  close(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** Resolves with the first non-empty diagnostics the server publishes for the document. */
  async diagnostics(uri: string): Promise<Diagnostic[]> {
    const message = await this.waitFor((candidate) => {
      const params = candidate["params"];
      return (
        candidate["method"] === "textDocument/publishDiagnostics" &&
        isJsonObject(params) &&
        params["uri"] === uri &&
        Array.isArray(params["diagnostics"]) &&
        params["diagnostics"].length > 0
      );
    });
    const params = message["params"];
    const diagnostics =
      isJsonObject(params) && Array.isArray(params["diagnostics"]) ? params["diagnostics"] : [];
    return diagnostics.filter(isDiagnostic);
  }

  /** Returns the files a definition request for the position leads to. */
  async definitionFiles(
    uri: string,
    position: { line: number; character: number },
  ): Promise<string[]> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri },
      position,
    });
    const locations: unknown[] = Array.isArray(result) ? result : [result];
    return locations.flatMap((location) => {
      if (!isJsonObject(location)) return [];
      // A Location has a uri, a LocationLink a targetUri.
      const target = location["uri"] ?? location["targetUri"];
      return typeof target === "string" ? [fileURLToPath(target)] : [];
    });
  }

  /** Returns the text of the hover at the position, or an empty string without one. */
  async hoverText(uri: string, position: { line: number; character: number }): Promise<string> {
    const result = await this.request("textDocument/hover", { textDocument: { uri }, position });
    const contents = isJsonObject(result) ? result["contents"] : undefined;
    return isJsonObject(contents) && typeof contents["value"] === "string" ? contents["value"] : "";
  }

  async stop(): Promise<number | null> {
    const exited = new Promise<number | null>((resolve) => {
      this.#process.once("exit", resolve);
    });
    await this.request("shutdown", {});
    this.notify("exit", {});
    return exited;
  }
}
