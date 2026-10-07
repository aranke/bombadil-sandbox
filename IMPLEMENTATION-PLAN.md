# Bombadil: fully client-side TodoMVC playground

Implementation plan for https://github.com/antithesishq/bombadil/issues/231.
Prepared 2026-09-16 against Bombadil commit `b8bc4a658abc5933c84d1afb9fff1ce24e05520f`.
This document proposes implementation; no runtime prototype has been built or verified yet.

## Outcome

A reader opens a static website, watches Bombadil explore a small TodoMVC application, edits a property or the relevant application code, and immediately sees how the execution changes. Installation, an account, a backend runner, and browser extensions are unnecessary.

The primary lesson is the relationship between an action, the state it changes, and the property that observes that state. The interface should reveal those relationships throughout the execution history.

## Decisions for version one

- Ship one small, pinned vanilla JavaScript TodoMVC example, retaining upstream attribution and license. All assets are bundled locally.
- Use the existing TypeScript formula API and Rust `bombadil-ltl` evaluator. Add a browser host and example-specific action driver.
- Support the formula subset used by the tutorial: predicates, `always`, `now`, `next`, bounded `eventually`, and Boolean combinators. Unsupported API usage produces an explicit diagnostic.
- Provide guided property editing and an editable application module for the persistence exercise. Keep extractor definitions fixed initially; this makes immediate reevaluation of recorded observations reliable.
- Provide action-weight controls rather than an arbitrary generator editor initially.
- Include play, pause, step, reset, replay, and history scrubbing. Manual interaction is available in a separate try-it mode; starting an automated run resets to a known state.
- Scope automation to the embedded application. Arbitrary websites, full Chrome input fidelity, network instrumentation, coverage-guided exploration, automatic shrinking, and full npm imports are outside version one.
- Keep evaluation state visible: violation, pending, satisfied where definitive, and no violation observed over a finite run. Do not display an unbounded invariant as proven.

## Architecture

The playground shell owns the editors, tutorial, history, run revisions, and controls. It communicates with an evaluation worker and an isolated application frame.

The evaluation worker hosts the compiled specification, TypeScript runtime, seeded action selection, and a WebAssembly adapter around `bombadil-ltl`. Keeping property evaluation in a worker allows cancellation of runaway user predicates without freezing the shell.

The application frame hosts TodoMVC and a small bridge. The bridge performs supported UI interactions and returns fixed DOM observations. A separate renderer displays inert historical snapshots; scrubbing does not move the live application backward or rerun application scripts.

The shell coordinates one transition at a time:

1. Reset the application, storage fixture, specification runtime, and random generator for a new run.
2. Capture the initial observation and evaluate it.
3. Generate available actions from the current observation and select a concrete action.
4. Perform the action in the application frame and wait for the example's defined settle boundary.
5. Capture observations, elapsed run time, relevant visual state, and the action result.
6. Step the evaluator, append an immutable history entry, and update the interface.
7. Stop at a violation, user pause, action limit, or time budget.

Every request and response carries a run/revision identifier. Results from cancelled runs cannot update the current interface.

## Milestone 1: prove the evaluator bridge

Create a small adapter crate, provisionally `lib/bombadil-bombadil-sandbox-runtime/`, depending on `bombadil-ltl` and the necessary WebAssembly bindings. Avoid depending on the native browser driver or pulling the whole Boa-backed verifier into the browser build.

Expose operations to initialize properties, step observations at a timestamp, obtain structured status/violations, and dispose a run. Translate existing TypeScript formula objects into the Rust syntax representation. Assign JavaScript closures stable handles; the Rust domain calls them synchronously in the worker and receives a Boolean or another formula. Preserve closures created by `now` for as long as residual formulas reference them.

Reuse the TypeScript extractor-cell access tracking to attach the values actually read by a predicate to its violation. A new host adapter must preserve negation, time units, captured values, errors, and finite-trace behavior; sharing the evaluator alone does not establish compatibility.

Validate a small set of traces through the native verifier and browser host: a failing invariant, a next-step property with a captured value, a bounded eventuality before/at/after its deadline, and an unfinished eventuality. Include exceptions and disposal to test lifecycle behavior.

Exit criteria: the supported cases agree on statuses, failure positions, and relevant observed values in a real browser. Measure startup cost, bundle size, and evaluation latency. If this boundary cannot be made reliable at reasonable scope, document the blocker and revisit the design before building the complete UI; do not silently replace the evaluator or introduce a hosted runner.

## Milestone 2: make the example executable and replayable

Add `examples/todomvc/` with a known initial fixture and an opt-in missing-persistence-write defect. Seed the fixture with both active and completed items so useful properties are exercised immediately. Preserve application storage across reload actions; reset it only at new-run boundaries.

Implement supported interactions: focus, type text, submit, toggle completion, delete, select a filter, wait, and reload. Resolve targets against the live DOM immediately before acting. Use UI controls and events rather than calling application business logic. Report stale/unsupported targets as action outcomes or errors, never as successful execution.

Define settling for this small app using its render lifecycle and bounded waits. Do not claim the same policy handles arbitrary asynchronous applications. Synthetic browser events have different semantics from native Chrome automation; document this boundary.

Record concrete actions as well as the seed. Replay uses the recorded actions, not a fresh random walk. The trace also records app/specification revisions, initial fixture, runtime version, viewport, observations, timestamps, and action outcomes. If a target no longer exists after an edit, show replay divergence at that step.

Property reevaluation uses recorded timestamps. Fresh execution records fresh elapsed times; UI animation speed must not redefine temporal-property deadlines. The persistence exercise should use a settled next-transition property rather than timing-sensitive eventualities.

Exit criteria: the controlled sequence add/toggle/reload exposes the persistence defect, and replay from the same initial state reproduces it. The fixed app passes that sequence. Assert the specific intended property failure, not merely any nonzero exit or error.

## Milestone 3: build the live explanation

Add the static playground under a dedicated directory, provisionally `examples/todomvc-playground/`.

The main view contains the running application, a property editor with observed values, and a timeline. Selecting a timeline entry shows the action and before/after states. Selecting a failed property shows its expression and the observations that explain the violation. Fixed extractor metadata maps observed values to the relevant controls for highlighting.

Use a compact read-only projection of the example's DOM for historical views. Historical displays must be inert and labelled as recorded state. Continuing exploration starts from the live end of the run; resuming from an earlier point would require reset-and-replay and can wait until a later version.

Implement precise edit behavior:

| Edit | Required work |
| --- | --- |
| Property only | Create a fresh verifier and reevaluate the entire recorded observation sequence. |
| Application code or defect toggle | Reset and execute the same recorded concrete actions against the new app revision. |
| Action weights | Begin a new exploration from the known initial fixture; keep the previous run available for comparison. |
| Extractors, in a future version | Rerun execution to collect the new observations. |

Debounce valid edits, cancel obsolete work, and keep the last valid result visibly marked as stale while compilation/evaluation is pending. Never relabel results from an older revision as current. Surface compilation and runtime errors next to the edited code.

Set initial performance goals, then measure them: under 200 ms for reevaluating a typical 100-state trace after a valid property edit, and immediate progress feedback during application replay. A timing miss should lead to profiling and scope adjustment, not undocumented correctness shortcuts.

Exit criteria: a reader can move directly from a failed expression to the action and values that caused it, then see the same history reevaluated after an edit.

## Milestone 4: author the guided exercise

Use a short progression:

1. Explore the app and see how actions become a history.
2. Check that the items-left count matches incomplete rows in the All view.
3. Check that Active and Completed display the correct rows.
4. Check that reload preserves committed todo text and completion state.
5. Enable the persistence defect and inspect the resulting counterexample.
6. Restore the missing persistence write and replay the same actions.
7. Adjust exploration weights and observe how the explored history changes.

Give the first demonstration a guaranteed, explicitly labelled guided sequence. Offer random exploration separately so teaching success does not depend on discovering a defect in a short random run.

Handle empty-list UI, initial readiness, and filter-specific visibility explicitly. A missing application must fail readiness instead of making every guarded invariant pass. Do not use application storage as the oracle for a property intended to check visible persistence behavior.

## Milestone 5: compatibility, isolation, and publication readiness

- Run a compact differential suite through the native verifier and the browser host for the supported formula subset, including closure capture and temporal boundaries.
- Exercise the buggy/fixed application using both the playground driver and native Bombadil. This checks the example's behavior without claiming identical input-event semantics.
- Test stale results, cancelled evaluations, syntax errors, replay divergence, storage reset versus reload, and worker cleanup.
- Bound trace size and run duration; preserve failures and stop explicitly at the configured limit.
- Execute editable code outside the shell's origin/privileges. Use a sandboxed application frame with a narrow message protocol, restrict resource loading, and validate message source and run identity. For an opaque-origin frame, provide per-run storage through the bridge so reload semantics remain defined; test parity with native local storage in the supplied example. Verify the sandbox policy supports the worker/module setup before committing to the final layout.
- Avoid claiming an iframe guarantees recovery from every infinite application loop. Keep version-one app editing guided and verify recovery behavior in supported browsers.
- Build the static artifact, test the intended hosting subpath, and verify runtime operation makes no backend or third-party requests after assets load.
- Test keyboard navigation and textual status indicators. Timeline meaning must not depend on color alone.
- Link the playground from the browser manual and issue's example documentation. Include downloadable app/specification files and native CLI instructions. Do not label playground traces as native replay-compatible unless that conversion has been implemented and tested.

Publication is a separate execution step. The implementation should first produce a reviewable static build; this planning task does not publish anything or post to GitHub.

## Suggested PR sequence

1. Evaluator adapter, native/browser compatibility fixtures, and minimal browser harness.
2. TodoMVC fixture, scoped action driver, concrete trace recording, and replay.
3. Playground interface, live property reevaluation, and application edit replay.
4. Guided tutorial, CI integration, static build, and manual links.

Milestone 1 gates the runtime design. Milestone 2 gates the history and replay interface. The tutorial and publication wiring follow a working end-to-end implementation.

## Definition of done

A new visitor can open the playground, see the labelled guided failure, identify the responsible action and observed values, edit the persistence code, and verify the fix against the same concrete actions. They can then explore randomly and edit a property with immediate historical feedback. The supported property semantics are checked against native Bombadil, and all execution occurs locally in the visitor's browser.

## Source references

- Issue and discussion: https://github.com/antithesishq/bombadil/issues/231
- Evaluator and domain interface: `lib/bombadil-ltl/src/{eval,formula,syntax}.rs`
- Existing host behavior: `lib/bombadil/src/specification/{verifier,js,snapshots,domain}.rs`
- TypeScript API and tracking: `lib/bombadil/src/specification/{index,internal,actions}.ts`
- Existing browser actions: `lib/bombadil/src/specification/browser/`
- Browser CI pattern: `.github/workflows/ci.yml`
- Existing TodoMVC reference: https://github.com/owickstrom/bombadil-playground/blob/main/todomvc/todomvc.ts
