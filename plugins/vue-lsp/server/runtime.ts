// Installs the language server and its TypeScript plugin into the plugin's data directory the first
// time the server starts, and again when the pinned versions in runtime/package.json change.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { RuntimePaths } from "./messages.ts";

export interface PackageManager {
  readonly name: string;
  readonly installArguments: readonly string[];
}

/** Tried in this order. npm comes first because it ships with Node and installs a plain tree. */
export const packageManagers: readonly PackageManager[] = [
  {
    name: "npm",
    installArguments: ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  },
  {
    // pnpm defaults to a frozen lockfile under CI, and the runtime has no lockfile.
    name: "pnpm",
    installArguments: ["install", "--prod", "--ignore-scripts", "--no-frozen-lockfile"],
  },
  { name: "bun", installArguments: ["install", "--production", "--ignore-scripts"] },
];

const runtimePrefix = "runtime-";
const stagingPrefix = ".install-";
const abandonedStagingAge = 60 * 60 * 1000;

export function runtimePaths(directory: string): RuntimePaths {
  const nodeModules = path.join(directory, "node_modules");
  return {
    pluginLocation: directory,
    typescriptLibrary: path.join(nodeModules, "typescript", "lib"),
    serverEntry: path.join(nodeModules, "typescript-language-server", "lib", "cli.mjs"),
  };
}

/** Returns the executable's path if a directory on the search path has it. */
export function findExecutable(
  name: string,
  searchPath: string = process.env["PATH"] ?? "",
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const extensions =
    platform === "win32" ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === "") continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension.toLowerCase());
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this directory.
      }
    }
  }
  return undefined;
}

export interface EnsureRuntimeOptions {
  readonly dataDirectory: string;
  readonly manifestPath: string;
  readonly findPackageManager?: () => { manager: PackageManager; executable: string } | undefined;
  readonly log?: (line: string) => void;
}

function findFirstPackageManager(): { manager: PackageManager; executable: string } | undefined {
  for (const manager of packageManagers) {
    const executable = findExecutable(manager.name);
    if (executable !== undefined) return { manager, executable };
  }
  return undefined;
}

function isInstalled(directory: string): boolean {
  return existsSync(runtimePaths(directory).serverEntry);
}

/** Returns the runtime for the manifest's versions, installing it first if it's missing. */
export function ensureRuntime(options: EnsureRuntimeOptions): RuntimePaths {
  const manifest = readFileSync(options.manifestPath, "utf8");
  const manifestHash = createHash("sha256").update(manifest).digest("hex").slice(0, 16);
  const directory = path.join(options.dataDirectory, runtimePrefix + manifestHash);
  if (!isInstalled(directory)) {
    install(directory, manifest, options);
    removeOtherRuntimes(options.dataDirectory, directory);
  }
  return runtimePaths(directory);
}

function install(directory: string, manifest: string, options: EnsureRuntimeOptions): void {
  const log = options.log ?? ((line: string) => process.stderr.write(`vue-lsp: ${line}\n`));
  const found = (options.findPackageManager ?? findFirstPackageManager)();
  if (found === undefined) {
    throw new Error(
      `can't install the language server: none of ${packageManagers.map((manager) => manager.name).join(", ")} is on PATH`,
    );
  }

  // Installs into a staging directory and renames it into place, so a session never sees half
  // an install, and two sessions starting at once don't install into the same directory.
  mkdirSync(options.dataDirectory, { recursive: true });
  const staging = mkdtempSync(path.join(options.dataDirectory, stagingPrefix));
  try {
    writeFileSync(path.join(staging, "package.json"), manifest);
    log(`installing the language server with ${found.manager.name} into ${directory}`);
    // stdout carries the protocol, so the package manager's output goes to stderr.
    const result = spawnSync(found.executable, found.manager.installArguments, {
      cwd: staging,
      stdio: ["ignore", 2, 2],
      shell: /\.(?:bat|cmd)$/i.test(found.executable),
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `${found.manager.name} install failed with exit code ${String(result.status)}`,
      );
    }
    try {
      renameSync(staging, directory);
    } catch (error) {
      // Another session finished the same install first.
      if (!isInstalled(directory)) throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Removes runtimes of earlier versions and staging directories that crashed installs left. */
function removeOtherRuntimes(dataDirectory: string, currentDirectory: string): void {
  for (const entry of readdirSync(dataDirectory)) {
    const entryPath = path.join(dataDirectory, entry);
    try {
      const isOldRuntime = entry.startsWith(runtimePrefix) && entryPath !== currentDirectory;
      const isAbandonedStaging =
        entry.startsWith(stagingPrefix) &&
        Date.now() - statSync(entryPath).mtimeMs > abandonedStagingAge;
      if (isOldRuntime || isAbandonedStaging) rmSync(entryPath, { recursive: true, force: true });
    } catch {
      // Cleanup is best effort; a leftover directory only costs disk space.
    }
  }
}
