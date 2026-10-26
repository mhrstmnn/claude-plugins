// Starts the server the plugin's lspServers entry names, with its arguments and initialization
// options, the way Claude Code does. Needs typescript-language-server and a TypeScript with tsserver
// (5 or 6) installed globally, as the plugin's README says; the fixture has no TypeScript of its own.

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { isJsonObject, type JsonObject } from "../../../plugins/vue-lsp/server/messages.ts";
import { LspClient } from "../../lsp-client.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const fixtureRoot = path.join(repositoryRoot, "test", "typescript-lsp", "fixture");
const mainFile = path.join(fixtureRoot, "src", "main.ts");

interface ServerConfig {
  readonly command: string;
  readonly args: string[];
  readonly initializationOptions?: JsonObject;
}

function readServerConfig(): ServerConfig {
  const manifestPath = path.join(
    repositoryRoot,
    "plugins",
    "typescript-lsp",
    ".claude-plugin",
    "plugin.json",
  );
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const servers = isJsonObject(manifest) ? manifest["lspServers"] : undefined;
  const server = isJsonObject(servers) ? servers["typescript"] : undefined;
  if (!isJsonObject(server) || typeof server["command"] !== "string") {
    throw new Error("plugin.json has no typescript server with a command");
  }
  const args = Array.isArray(server["args"]) ? server["args"].map(String) : [];
  const options = server["initializationOptions"];
  return {
    command: server["command"],
    args,
    ...(isJsonObject(options) ? { initializationOptions: options } : {}),
  };
}

let client: LspClient;

beforeAll(async () => {
  const config = readServerConfig();
  client = new LspClient(config.command, config.args, { cwd: fixtureRoot, env: process.env });
  await client.initialize(fixtureRoot, config.initializationOptions);
});

afterAll(async () => {
  expect(await client.stop()).toBe(0);
});

describe("the TypeScript language server", () => {
  // First, while the project is still loading: a syntax server would answer with `import x` only.
  test("shows an import's type on hover right after opening a file", async () => {
    const text = readFileSync(mainFile, "utf8");
    const uri = client.open(mainFile, "typescript", text);
    const hover = await client.hoverText(uri, {
      line: 0,
      character: text.indexOf("formatGreeting"),
    });

    expect(hover).toContain("(alias) function formatGreeting(name: string): string");
    client.close(uri);
  });

  test("reports type errors", async () => {
    const text = `${readFileSync(mainFile, "utf8")}export const wrong: string = 42;\n`;
    const uri = client.open(mainFile, "typescript", text);

    const diagnostics = await client.diagnostics(uri);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Type 'number' is not assignable to type 'string'.",
    ]);
    client.close(uri);
  });
});
