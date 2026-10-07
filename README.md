# Bombadil Sandbox

Learn property-based UI testing by finding and fixing bugs in a small todo app. Edit the app and its tests, run a sequence of actions, and inspect the state where a test fails.

**[Open the sandbox →](https://aranke.github.io/bombadil-sandbox/)**

## Try it

The guided tour opens on your first visit. You can reopen it with **Tour**.

1. Choose an example in the top right.
2. Click **Continue** to run up to seven actions. Each example's default run exposes its bug within three to seven steps.
3. Read the failure explanation. Expand **Bombadil report** for the failing formula and captured values, or scrub the timeline to inspect earlier states.
4. Follow the `// Fix:` hint in **App**, then click **Apply changes** to rerun the recorded actions with your fix.

You can also interact with the todo app yourself. **Replay** repeats the recorded actions; **Start over** restores the initial todos and clears the timeline. The reload icon reopens the app from its saved todos.

The six examples cover reload persistence, items-left counts, filter visibility, blank todos, filter changes, and adding todos. Editing **Tests** rechecks the recorded states without rerunning the app. Code edits survive switching examples, but are cleared when you reload the browser page.

## Run locally

The repository includes a static build. You only need Node.js 22 or newer to serve it:

```sh
git clone https://github.com/aranke/bombadil-sandbox.git
cd bombadil-sandbox
npm run dev
```

Open [localhost:4173](http://127.0.0.1:4173).

## Develop

Building requires Node.js 22+, Rust stable, and the WebAssembly target:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build
npm run dev
```

Rebuild after changing source files; the server serves `dist/` without hot reload.

Run the checks after building:

```sh
npm run typecheck
npm test
cargo test --locked -p bombadil-sandbox-runtime
```

With the local server running, use `npm run test:browser` for the browser suite. It uses installed Google Chrome on macOS and Playwright Chromium in CI. The optional `npm run test:native` check requires the official Bombadil 0.7.8 executable; set `BOMBADIL_BIN` to its path.

Pushing to `main` builds and publishes `dist/` through GitHub Pages. Tests run in a separate workflow.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and pull request checks.

## How it works

The sandbox runs entirely in the browser. CodeMirror provides the editors; isolated frames and workers execute the editable code. Bombadil's upstream Rust temporal-logic evaluator runs as WebAssembly. Short failure explanations accompany reports produced by Bombadil's own renderer.

This app uses a small todo fixture and a dedicated action driver. For the vendored source version, license, and adapter details, see [vendor/README.md](vendor/README.md).

## Credits

Built around [Bombadil](https://github.com/antithesishq/bombadil), with teaching examples adapted from [Oskar Wickström's TodoMVC specification](https://github.com/owickstrom/bombadil-playground/blob/73202e6269b06cbf945c5a4735ca9fa47c4c7ab0/todomvc/todomvc.ts). This is an independent sandbox, not an official Bombadil distribution.

Licensed under [MIT](LICENSE). Vendored Bombadil code retains its copyright notice in [vendor/LICENCE](vendor/LICENCE).
