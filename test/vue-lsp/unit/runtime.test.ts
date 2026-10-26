import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  ensureRuntime,
  findExecutable,
  type PackageManager,
  runtimePaths,
} from "../../../plugins/vue-lsp/server/runtime.ts";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "vue-lsp-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

describe("findExecutable", () => {
  test("finds the first executable on the search path", () => {
    writeExecutable(path.join(scratch, "b", "tool"), "");
    writeExecutable(path.join(scratch, "c", "tool"), "");
    const searchPath = [
      "",
      path.join(scratch, "a"),
      path.join(scratch, "b"),
      path.join(scratch, "c"),
    ].join(path.delimiter);
    expect(findExecutable("tool", searchPath, "darwin")).toBe(path.join(scratch, "b", "tool"));
  });

  test("skips files that aren't executable and directories", () => {
    mkdirSync(path.join(scratch, "a", "tool"), { recursive: true });
    writeFileSync(path.join(scratch, "b-tool"), "");
    expect(findExecutable("tool", path.join(scratch, "a"), "linux")).toBeUndefined();
    expect(findExecutable("b-tool", scratch, "linux")).toBeUndefined();
  });
});

function writeManifest(): string {
  const manifestPath = path.join(scratch, "package.json");
  writeFileSync(manifestPath, '{"dependencies":{"typescript":"6.0.3"}}');
  return manifestPath;
}

// A stand-in package manager that "installs" by creating the server's entry point.
function fakeInstaller(exitCode: number): { manager: PackageManager; executable: string } {
  const executable = path.join(scratch, "bin", "fake-install");
  writeExecutable(
    executable,
    `#!/bin/sh\nmkdir -p node_modules/typescript-language-server/lib\ntouch node_modules/typescript-language-server/lib/cli.mjs\nexit ${String(exitCode)}\n`,
  );
  return { manager: { name: "fake", installArguments: [] }, executable };
}

describe("ensureRuntime", () => {
  test("installs into a directory named after the manifest and reuses it", () => {
    const dataDirectory = path.join(scratch, "data");
    const manifestPath = writeManifest();
    let installs = 0;
    const options = {
      dataDirectory,
      manifestPath,
      log: () => {},
      findPackageManager: () => {
        installs += 1;
        return fakeInstaller(0);
      },
    };
    const first = ensureRuntime(options);
    const second = ensureRuntime(options);
    expect(installs).toBe(1);
    expect(second).toEqual(first);
    expect(first).toEqual(runtimePaths(first.pluginLocation));
    expect(readdirSync(dataDirectory)).toEqual([path.basename(first.pluginLocation)]);
    expect(path.basename(first.pluginLocation)).toMatch(/^runtime-[0-9a-f]{16}$/);
  });

  test("replaces the runtime of an earlier manifest", () => {
    const dataDirectory = path.join(scratch, "data");
    mkdirSync(path.join(dataDirectory, "runtime-0000000000000000"), { recursive: true });
    const runtime = ensureRuntime({
      dataDirectory,
      manifestPath: writeManifest(),
      log: () => {},
      findPackageManager: () => fakeInstaller(0),
    });
    expect(readdirSync(dataDirectory)).toEqual([path.basename(runtime.pluginLocation)]);
  });

  test("leaves nothing behind when the install fails", () => {
    const dataDirectory = path.join(scratch, "data");
    expect(() =>
      ensureRuntime({
        dataDirectory,
        manifestPath: writeManifest(),
        log: () => {},
        findPackageManager: () => fakeInstaller(3),
      }),
    ).toThrow(/exit code 3/);
    expect(readdirSync(dataDirectory)).toEqual([]);
  });

  test("says which package managers it looked for", () => {
    expect(() =>
      ensureRuntime({
        dataDirectory: path.join(scratch, "data"),
        manifestPath: writeManifest(),
        log: () => {},
        findPackageManager: () => undefined,
      }),
    ).toThrow(/npm, pnpm, bun/);
  });
});
