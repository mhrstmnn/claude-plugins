# typescript-lsp

A [Claude Code](https://code.claude.com) plugin that gives Claude code intelligence in TypeScript and JavaScript files: type errors right after an edit, go to definition, find references and hover, in `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs` and `.cjs` files.

It's Anthropic's official `typescript-lsp` plugin with one change. typescript-language-server normally runs two TypeScript servers: a full one, and a syntax-only one that answers while a project is still loading. The syntax server knows no types, so a hover over an import right after a file opens shows only `import x` instead of x's type. A person in an editor just hovers again; Claude takes the first answer and moves on. This plugin turns the syntax server off (`tsserver.useSyntaxServer: "never"`), so the first answers wait until the project has loaded and include the types. It also saves one server process per project.

For `.vue` files, add [vue-lsp](../vue-lsp/README.md) from the same marketplace.

## Install

It replaces the official plugin, since both claim the same file types:

```sh
npm install -g typescript-language-server typescript@6
claude plugin marketplace add mhrstmnn/claude-plugins
claude plugin uninstall typescript-lsp@claude-plugins-official   # if you have it
claude plugin install typescript-lsp@mhrstmnn
```

Restart Claude Code afterwards.

Requirements:

- `typescript-language-server` on `PATH`, as the official plugin needs too.
- A global TypeScript 5 or 6 next to it, for projects without TypeScript of their own. TypeScript 7 has no tsserver, so it can't be the global one. Projects on TypeScript 5 or 6 use their own.

## Credits

Based on the [official typescript-lsp](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/typescript-lsp) by Anthropic (Apache 2.0), whose server command and file types it keeps.

## License

MIT
