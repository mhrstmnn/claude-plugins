# vue-lsp

A [Claude Code](https://code.claude.com) plugin that gives Claude code intelligence in Vue single-file components: type errors in `<script setup>` and in template expressions right after an edit, go to definition, find references and hover, including into the `.ts` files a component uses.

It serves `.vue` files only and complements a `typescript-lsp` plugin, which serves `.ts` and `.js` files: the official one, or [this marketplace's](../typescript-lsp/README.md), which includes types in its first answers. Install both for full coverage in a Vue project.

## Why a plugin of its own

Vue's language server (`@vue/language-server`) can't run alone in Claude Code. It hands all TypeScript work back to the editor through custom `tsserver/request` messages, which editors like VS Code and Neovim pass on to a TypeScript server, and Claude Code's language-server client doesn't. This plugin takes the other route Vue supports instead: [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server) with Vue's TypeScript plugin, `@vue/typescript-plugin`, which teaches tsserver to read `.vue` files.

That plugin has to be registered by path in the `initialize` request. Claude Code's plugin config can't express that portably, since it substitutes variables like `${CLAUDE_PLUGIN_DATA}` only in a server's command, arguments and environment. So the server command is a small wrapper that fills the path in.

## Install

```sh
claude plugin marketplace add mhrstmnn/claude-plugins
claude plugin install vue-lsp@mhrstmnn
```

Or in a session: `/plugin marketplace add mhrstmnn/claude-plugins`, then `/plugin install vue-lsp@mhrstmnn`. Restart Claude Code afterwards.

For `.ts` and `.js` files, install a `typescript-lsp` plugin too, with the typescript-language-server it needs on `PATH`. The two don't overlap: each claims its own file types, and this plugin's server starts only once Claude edits a `.vue` file. The `.vue` server still sees the project's `.ts` files, and picks up their edits from disk.

Requirements:

- Node.js 22.22.2 or newer as `node` on `PATH`. The wrapper is TypeScript that Node runs directly.
- npm, pnpm or Bun on `PATH`, tried in that order, for the install on first start.

## How it works

On its first start the server installs these pinned packages into the plugin's data directory (`~/.claude/plugins/data/vue-lsp-mhrstmnn/`), with install scripts turned off:

- `typescript-language-server`
- `@vue/typescript-plugin`
- `typescript` 6, as the fallback TypeScript

The first start takes a few seconds longer and needs network access. Later starts reuse the install, and a plugin update that changes the versions installs them again and removes the old ones.

It then starts typescript-language-server and passes the protocol through, adding the Vue plugin and the fallback TypeScript to the `initialize` request. A project's own TypeScript serves it when it has a tsserver: TypeScript 5 and 6, and `typescript-native-bridge`. A project on TypeScript 7, which has no tsserver, gets the bundled TypeScript 6.

It also turns off typescript-language-server's syntax server, which answers while a project loads but knows no types. A hover over an import would then show `import x` instead of x's type, and Claude, unlike a person in an editor, wouldn't ask again. Without it, the first answer waits until the project has loaded.

## Limitations

- `typescript-lsp` serves the `.ts` files, so where a `.ts` file imports a component, it sees the `*.vue` module shim instead of the component's props.
- A Vue project runs two TypeScript servers once Claude has edited both kinds of files, one per plugin.
- Go to definition on an imported function in a template also returns a helper type of Vue's generated template code, after the real definition.
- What only Vue's own language server provides is missing, such as HTML and CSS completion in templates. Claude rarely needs it.
- Tested on macOS and Linux. Windows should work but is untested.

## Development

The repository's [README](../../README.md#development) has the commands. `claude --plugin-dir plugins/vue-lsp` tries the plugin in a session without installing it.

## License

MIT
