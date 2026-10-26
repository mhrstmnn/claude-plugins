// Starts the plugin's server the way Claude Code does, with an empty data directory, so the run
// covers the install from the registry, the proxy, and typescript-language-server with the Vue
// plugin. The fixture has no TypeScript of its own, so the bundled one serves it.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { LspClient } from "./lsp-client.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const fixtureRoot = path.join(repositoryRoot, "test", "vue-lsp", "fixture");
const vueFile = path.join(fixtureRoot, "src", "Greeting.vue");

let dataDirectory: string;
let client: LspClient;

beforeAll(async () => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), "vue-lsp-data-"));
  client = new LspClient(
    process.execPath,
    [path.join(repositoryRoot, "plugins", "vue-lsp", "server", "main.ts")],
    { cwd: fixtureRoot, env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDirectory } },
  );
  await client.initialize(fixtureRoot);
});

afterAll(async () => {
  expect(await client.stop()).toBe(0);
  rmSync(dataDirectory, { recursive: true, force: true });
});

function lineOf(text: string, needle: string): number {
  return text.split("\n").findIndex((line) => line.includes(needle));
}

describe("the Vue language server", () => {
  test("reports type errors in a component's script and template", async () => {
    const text = readFileSync(vueFile, "utf8")
      .replace("const props", 'const count: number = "three";\nconst props')
      .replace("formatGreeting(props.name)", "formatGreeting(count)");
    const uri = client.open(vueFile, "vue", text);

    const diagnostics = await client.diagnostics(uri);
    const messages = diagnostics.map(
      (diagnostic) => `${String(diagnostic.range.start.line)}: ${diagnostic.message}`,
    );
    expect(messages).toContain(
      `${String(lineOf(text, "const count"))}: Type 'string' is not assignable to type 'number'.`,
    );
    expect(messages).toContain(
      `${String(lineOf(text, "formatGreeting(count)"))}: Argument of type 'number' is not assignable to parameter of type 'string'.`,
    );
    client.close(uri);
  });

  test("goes from a template expression to its definition in a .ts file", async () => {
    const text = readFileSync(vueFile, "utf8");
    const uri = client.open(vueFile, "vue", text);
    const line = lineOf(text, "{{ formatGreeting");
    const files = await client.definitionFiles(uri, {
      line,
      character: text.split("\n")[line]?.indexOf("formatGreeting") ?? 0,
    });

    // For an imported function, Vue's plugin also returns a helper type of its generated template
    // code, after the real definition.
    expect(files[0]).toBe(path.join(fixtureRoot, "src", "greeting.ts"));
    client.close(uri);
  });

  test("serves plain TypeScript files as well", async () => {
    const tsFile = path.join(fixtureRoot, "src", "main.ts");
    const text = `${readFileSync(tsFile, "utf8")}export const wrong: string = 42;\n`;
    const uri = client.open(tsFile, "typescript", text);

    const diagnostics = await client.diagnostics(uri);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Type 'number' is not assignable to type 'string'.",
    ]);
  });
});
