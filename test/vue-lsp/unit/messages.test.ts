import { describe, expect, test } from "vitest";

import {
  addVueSupport,
  frameMessage,
  isJsonObject,
  type JsonObject,
  MessageReader,
  parseInitializeRequest,
  type RuntimePaths,
} from "../../../plugins/vue-lsp/server/messages.ts";

const runtime: RuntimePaths = {
  pluginLocation: "/data/runtime-1",
  typescriptLibrary: "/data/runtime-1/node_modules/typescript/lib",
  serverEntry: "/data/runtime-1/node_modules/typescript-language-server/lib/cli.mjs",
};

function bodies(reader: MessageReader, chunks: Buffer[]): unknown[] {
  return chunks.flatMap((chunk) =>
    reader.push(chunk).map((message): unknown => JSON.parse(message.body.toString("utf8"))),
  );
}

describe("MessageReader", () => {
  test("reads several messages from one chunk", () => {
    const chunk = Buffer.concat([frameMessage({ id: 1 }), frameMessage({ id: 2 })]);
    expect(bodies(new MessageReader(), [chunk])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("reads a message split across chunks, even inside the header", () => {
    const bytes = frameMessage({ id: 1, text: "ä€😀" });
    const chunks = [bytes.subarray(0, 5), bytes.subarray(5, 30), bytes.subarray(30)];
    expect(bodies(new MessageReader(), chunks)).toEqual([{ id: 1, text: "ä€😀" }]);
  });

  test("keeps the raw bytes, extra headers included", () => {
    const body = '{"id":1}';
    const raw = Buffer.from(
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
    );
    const [message] = new MessageReader().push(raw);
    expect(message?.raw.equals(raw)).toBe(true);
  });

  test("hands back an incomplete message as the remainder", () => {
    const reader = new MessageReader();
    const bytes = frameMessage({ id: 1 });
    expect(reader.push(bytes.subarray(0, 10))).toEqual([]);
    expect(reader.takeRemainder().equals(bytes.subarray(0, 10))).toBe(true);
    expect(reader.takeRemainder().length).toBe(0);
  });

  test("rejects a header without Content-Length", () => {
    expect(() => new MessageReader().push(Buffer.from("Foo: 1\r\n\r\n{}"))).toThrow(
      /Content-Length/,
    );
  });
});

describe("parseInitializeRequest", () => {
  test("returns the initialize request and nothing else", () => {
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    expect(parseInitializeRequest(Buffer.from(JSON.stringify(initialize)))).toEqual(initialize);
    expect(parseInitializeRequest(Buffer.from('{"method":"initialized"}'))).toBeUndefined();
    expect(parseInitializeRequest(Buffer.from("[1]"))).toBeUndefined();
  });
});

describe("addVueSupport", () => {
  test("registers the plugin and the fallback TypeScript", () => {
    const request: JsonObject = { id: 1, method: "initialize", params: { rootUri: "file:///p" } };
    expect(addVueSupport(request, runtime)).toEqual({
      id: 1,
      method: "initialize",
      params: {
        rootUri: "file:///p",
        initializationOptions: {
          plugins: [
            {
              name: "@vue/typescript-plugin",
              location: "/data/runtime-1",
              languages: ["vue"],
            },
          ],
          tsserver: { fallbackPath: "/data/runtime-1/node_modules/typescript/lib" },
        },
      },
    });
  });

  test("keeps the options the client sent", () => {
    const otherPlugin = { name: "other", location: "/x" };
    const request: JsonObject = {
      method: "initialize",
      params: {
        initializationOptions: {
          plugins: [otherPlugin],
          tsserver: { fallbackPath: "/client/lib", logVerbosity: "verbose" },
          preferences: { quoteStyle: "double" },
        },
      },
    };
    const params = addVueSupport(request, runtime)["params"];
    const options = isJsonObject(params) ? params["initializationOptions"] : undefined;
    if (!isJsonObject(options)) throw new Error("initializationOptions missing");
    expect(options["plugins"]).toEqual([
      otherPlugin,
      expect.objectContaining({ languages: ["vue"] }),
    ]);
    expect(options["tsserver"]).toEqual({ fallbackPath: "/client/lib", logVerbosity: "verbose" });
    expect(options["preferences"]).toEqual({ quoteStyle: "double" });
  });
});
