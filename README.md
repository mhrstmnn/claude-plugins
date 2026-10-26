# Claude Code plugins

My plugins for [Claude Code](https://code.claude.com). The repository is also their marketplace, so Claude Code installs them straight from here.

| Plugin                               | What it does                                                                                                                                             |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vue-lsp](plugins/vue-lsp/README.md) | Vue language server, next to the official `typescript-lsp`: type errors right after an edit, go to definition, find references and hover in `.vue` files |

## Install

Add the marketplace once, then install the plugins you want:

```sh
claude plugin marketplace add mhrstmnn/claude-plugins
claude plugin install vue-lsp@mhrstmnn
```

In a session, the same works with `/plugin marketplace add mhrstmnn/claude-plugins` and `/plugin install vue-lsp@mhrstmnn`. A plugin's README lists what it needs and anything else to do.

## Development

```sh
pnpm install
pnpm run check              # tsc, Oxlint, oxfmt
pnpm test                   # unit tests
pnpm run test:integration   # tests that install and run real dependencies
claude plugin validate .    # checks the marketplace and plugin manifests
claude --plugin-dir plugins/<name>   # tries a plugin in a session without installing it
```

## License

MIT
