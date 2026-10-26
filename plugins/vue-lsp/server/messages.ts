// Reads the Language Server Protocol messages Claude Code sends and adds Vue support to the
// initialize request, which is the one place typescript-language-server takes its plugins from.

export type JsonObject = { [key: string]: unknown };

export interface Message {
  /** The message as it arrived, header included, for passing it on unchanged. */
  readonly raw: Buffer;
  readonly body: Buffer;
}

/** Where the installed runtime keeps the pieces the initialize request has to name. */
export interface RuntimePaths {
  /** The directory whose node_modules holds @vue/typescript-plugin. */
  readonly pluginLocation: string;
  /** TypeScript's lib directory, for workspaces without a TypeScript that has tsserver. */
  readonly typescriptLibrary: string;
  /** typescript-language-server's entry point. */
  readonly serverEntry: string;
}

const headerSeparator = Buffer.from("\r\n\r\n", "ascii");

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContentLength(header: string): number {
  for (const line of header.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).trim().toLowerCase() !== "content-length") continue;
    const contentLength = Number(line.slice(separatorIndex + 1).trim());
    if (Number.isSafeInteger(contentLength) && contentLength >= 0) return contentLength;
  }
  throw new Error(`message header without a valid Content-Length: ${JSON.stringify(header)}`);
}

/** Splits a byte stream into messages, however the stream cuts them into chunks. */
export class MessageReader {
  #buffer: Buffer = Buffer.alloc(0);

  /** Adds a chunk and returns the messages it completes. */
  push(chunk: Buffer): Message[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const messages: Message[] = [];
    for (;;) {
      const headerEnd = this.#buffer.indexOf(headerSeparator);
      if (headerEnd === -1) break;
      const bodyStart = headerEnd + headerSeparator.length;
      const bodyEnd =
        bodyStart + parseContentLength(this.#buffer.subarray(0, headerEnd).toString("ascii"));
      if (this.#buffer.length < bodyEnd) break;
      messages.push({
        raw: this.#buffer.subarray(0, bodyEnd),
        body: this.#buffer.subarray(bodyStart, bodyEnd),
      });
      this.#buffer = this.#buffer.subarray(bodyEnd);
    }
    return messages;
  }

  /** Returns the bytes of the incomplete message read so far and forgets them. */
  takeRemainder(): Buffer {
    const remainder = this.#buffer;
    this.#buffer = Buffer.alloc(0);
    return remainder;
  }
}

export function frameMessage(message: JsonObject): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Parses a message body, returning undefined for anything but the initialize request. */
export function parseInitializeRequest(body: Buffer): JsonObject | undefined {
  const message: unknown = JSON.parse(body.toString("utf8"));
  return isJsonObject(message) && message["method"] === "initialize" ? message : undefined;
}

/**
 * Registers @vue/typescript-plugin with typescript-language-server, which then lets tsserver
 * read .vue files, and names the bundled TypeScript as the fallback for workspaces without one.
 * It also turns off the syntax server, which answers while the project loads but without types:
 * a hover over an import would show `import x` instead of x's type, and Claude, unlike a person
 * in an editor, doesn't ask again. Options the client sent stay, and its tsserver options win.
 */
export function addVueSupport(request: JsonObject, runtime: RuntimePaths): JsonObject {
  const params = isJsonObject(request["params"]) ? request["params"] : {};
  const options = isJsonObject(params["initializationOptions"])
    ? params["initializationOptions"]
    : {};
  const plugins: unknown[] = Array.isArray(options["plugins"]) ? options["plugins"] : [];
  const tsserver = isJsonObject(options["tsserver"]) ? options["tsserver"] : {};
  return {
    ...request,
    params: {
      ...params,
      initializationOptions: {
        ...options,
        plugins: [
          ...plugins,
          { name: "@vue/typescript-plugin", location: runtime.pluginLocation, languages: ["vue"] },
        ],
        tsserver: {
          fallbackPath: runtime.typescriptLibrary,
          useSyntaxServer: "never",
          ...tsserver,
        },
      },
    },
  };
}
