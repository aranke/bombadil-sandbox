# Contributing to Bombadil Sandbox

Bug reports, improvements to the teaching examples, and code contributions are welcome.

## Issues and feature requests

Check [existing issues](https://github.com/aranke/bombadil-sandbox/issues) before opening a new one. For bugs, include steps to reproduce, the expected and actual behavior, your browser version, and any relevant changes to the App or Tests code. Screenshots or a recorded action sequence can help.

For larger changes, open an issue first to discuss the approach.

## Development setup

Install Node.js 22 or newer, Rust stable, and Google Chrome for local browser tests. Fork the repository and clone your fork, then:

```sh
cd bombadil-sandbox
git switch -c your-change
rustup target add wasm32-unknown-unknown
npm ci
npm run build
npm run dev
```

Open [localhost:4173](http://127.0.0.1:4173). Rebuild after source changes; the server serves `dist/` without hot reload.

## Making changes

- Keep changes focused and preserve the examples' teaching goals.
- Add or update relevant tests when changing behavior.
- Keep documentation in sync with user-facing changes.
- Run `npm run format` to format TypeScript, JavaScript, and documentation. Use `cargo fmt -p bombadil-sandbox-runtime` for the Rust adapter.
- Rebuild and include updated files in `dist/`, which contains the checked-in static app.

The upstream files in `vendor/` are pinned Bombadil source. Keep changes to the sandbox adapter separate from upstream updates, and preserve the source attribution and license described in [vendor/README.md](vendor/README.md).

## Testing

After building, run:

```sh
npm run typecheck
npm test
cargo test --locked -p bombadil-sandbox-runtime
```

With the local server running in another terminal:

```sh
npm run test:browser
```

The browser suite uses installed Google Chrome locally and Playwright Chromium in CI. Screenshots are saved in `test-results/` and should not be committed.

For changes to evaluator integration or exported specifications, also run the native compatibility check with the official Bombadil 0.7.8 executable:

```sh
BOMBADIL_BIN=/path/to/bombadil npm run test:native
```

GitHub Actions runs the build, typecheck, Rust and Node tests, browser suite, and native compatibility check for pull requests.

## Pull requests

Open a pull request against `main`. Explain the problem, what changed, and how you tested it. Include screenshots for visual changes and link any related issue. Keep unrelated cleanup in a separate pull request and respond to review feedback.

Merging into `main` automatically publishes the app to GitHub Pages.
