# Validation

Validated on macOS with Node.js 26.5.0, Rust 1.98.1, Google Chrome, and official Bombadil 0.7.5.

- `npm run build`: produces the static browser application and the original Rust evaluator as WebAssembly.
- `npm run typecheck`: TypeScript checks pass.
- `cargo test --locked -p bombadil-sandbox-runtime`: native Rust adapter tests pass.
- `npm test`: 14 tests cover application module behavior, persistence closure capture, captured diagnostic values, native violation reports, next-step semantics, bounded eventualities, negation, exceptions, fresh reevaluation, and state-based lesson transition guards.
- `npm run test:browser`: exercises the three-pane layout, default three-action defect, successful fix/replay, historical scrubbing, test-edit reevaluation, editable add/delete/filter behaviors, syntax-error recovery, runaway behavior and property code, reset cancellation, responsive layout, and local-only network behavior. The top-right example switcher must be the only dropdown and is checked at desktop and mobile widths; selection must load that example's test and remain at the initial state without autoplay. Clicking Continue must discover each example's first defect between steps 3 and 7: persistence at 3, count at 4, visibility at 5, blank text at 6, filter changes at 5, and adding at 7. The guided sequences have matching lengths. The fixed module must pass the same recorded random actions. Checks also cover per-example code drafts and test edits, and switching while steps are running. Optional WebMCP tools are tested through a mock registry, not a native WebMCP implementation.
- Official native Bombadil 0.7.5: the controlled buggy app fails specifically on `persistence` after reload (exit 2). The corrected app reaches reload and completes its bounded test without violations (exit 0).

The WASM reevaluation check processes 100 simple observations in roughly 1 ms on this device. This is a local observation, not a cross-device performance guarantee.

This does not establish exhaustive parity with every native Bombadil API or every browser. The sandbox uses a scoped input driver and a fixed observation schema. GitHub Actions passes the build, typecheck, Rust tests, Node tests, browser suite, and native Bombadil compatibility check. The sandbox is published at https://aranke.github.io/bombadil-sandbox/.
