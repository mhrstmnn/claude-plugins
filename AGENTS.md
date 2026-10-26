# AGENTS.md

Plugins for Claude Code, in a repository that is also their marketplace (`mhrstmnn`). The README lists the plugins.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace, with one entry per plugin.
- `plugins/<name>/`: one plugin each, with its `.claude-plugin/plugin.json` and a README for users. Everything in it ships to users, so tests and fixtures stay out of it.
- `test/<name>/`: a plugin's tests. `unit/` runs with `pnpm test`; `integration/` runs with `pnpm run test:integration` and may use the network.
- The tooling at the root (TypeScript, Oxlint, oxfmt, Vitest, lefthook) serves every plugin.

## Commands

- `pnpm run check`: tsc, Oxlint and oxfmt.
- `pnpm test` and `pnpm run test:integration`.
- `claude plugin validate .` checks the marketplace and its plugins; `claude plugin validate --profile directory plugins/<name>` also checks what Anthropic's plugin directory would require of a submission.

## Adding a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` and a README.
2. Add an entry for it to `.claude-plugin/marketplace.json`, with the same description.
3. Add a row to the table in the README.
4. Put its tests in `test/<name>/`.

## Every plugin

- Bump `version` in a plugin's `plugin.json` with every change users should get. Claude Code updates an installed plugin only when its version changes.

## typescript-lsp

- A copy of Anthropic's official `typescript-lsp` config with `initializationOptions.tsserver.useSyntaxServer` set to `never`. Keep its command and file types in step with the official plugin.
- Its integration test runs the server the manifest names, so it needs typescript-language-server and TypeScript 6 installed globally; CI installs them with npm.

## vue-lsp

- `server/main.ts` is the entry point Claude Code starts, `server/runtime.ts` installs the dependencies into `CLAUDE_PLUGIN_DATA`, and `server/messages.ts` frames protocol messages and rewrites `initialize`. `server/runtime/package.json` pins what gets installed.
- The server's stdout carries the protocol. The server code writes diagnostics to stderr only, and so does any child process it runs.
- Node runs the server's `.ts` files directly with type stripping, so they use erasable syntax only (no enums, namespaces or parameter properties), import each other with the `.ts` extension, and import nothing outside Node's standard library.
- Changing a version in `server/runtime/package.json` makes every user's server install the runtime again on its next start. Run the integration test after such a change.
