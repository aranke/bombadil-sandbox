import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BrowserEvaluator } from "./evaluator.bundle.mjs";
import { properties } from "./build/model.js";
import { renderBombadilReport } from "./build/diagnostics.js";
const bytes = await readFile(
  new URL("../dist/evaluator.wasm", import.meta.url),
);
const observation = (overrides = {}) => ({
  ready: true,
  todos: [{ id: 1, text: "A", completed: false }],
  visible: [{ id: 1, text: "A", completed: false }],
  remaining: 1,
  filter: "all",
  lastAction: null,
  ...overrides,
});
test("actual upstream WASM detects a persistence violation with captured before/after values", async () => {
  const evaluator = await BrowserEvaluator.create(bytes);
  evaluator.initialize({
    persistence: `always(() => { const before=JSON.stringify(todos.current); return next(() => lastAction.current?.type !== 'reload' || JSON.stringify(todos.current)===before); })`,
  });
  assert.equal(evaluator.step(observation(), 0).persistence.status, "pending");
  assert.equal(
    evaluator.step(
      observation({
        todos: [{ id: 1, text: "A", completed: true }],
        lastAction: { type: "toggle", id: 1 },
      }),
      10,
    ).persistence.status,
    "pending",
  );
  const result = evaluator.step(
    observation({ lastAction: { type: "reload" } }),
    20,
  );
  assert.equal(result.persistence.status, "violation");
  const diagnostic = JSON.stringify(result.persistence.violation);
  assert.match(diagnostic, /todos@10ms/);
  assert.match(diagnostic, /todos@20ms/);
  evaluator.dispose();
});
test("fixed reload passes and finite invariants remain pending", async () => {
  const e = await BrowserEvaluator.create(bytes);
  e.initialize({
    p: `always(() => {const before=JSON.stringify(todos.current);return next(() => lastAction.current?.type !== 'reload' || JSON.stringify(todos.current)===before);})`,
  });
  e.step(observation(), 0);
  assert.equal(
    e.step(observation({ lastAction: { type: "reload" } }), 5).p.status,
    "pending",
  );
  e.dispose();
});
test("eventuality honors recorded time, success, timeout, and unfinished traces", async () => {
  const e = await BrowserEvaluator.create(bytes);
  e.initialize({
    p: 'eventually(() => ready.current).within(100, "milliseconds")',
  });
  assert.equal(e.step(observation({ ready: false }), 0).p.status, "pending");
  assert.equal(e.step(observation({ ready: false }), 99).p.status, "pending");
  assert.equal(e.step(observation(), 100).p.status, "satisfied");
  e.initialize({
    p: 'eventually(() => ready.current).within(100, "milliseconds")',
  });
  e.step(observation({ ready: false }), 0);
  assert.equal(
    e.step(observation({ ready: false }), 101).p.status,
    "violation",
  );
  e.dispose();
});
test("negation, Boolean formulas, exceptions, validation, and fresh reevaluation", async () => {
  const e = await BrowserEvaluator.create(bytes);
  e.initialize({
    p: "always(not(() => ready.current).or(() => remaining.current === 1))",
  });
  assert.equal(e.step(observation(), 0).p.status, "pending");
  assert.equal(e.step(observation({ remaining: 2 }), 1).p.status, "violation");
  e.initialize({ p: "always(() => remaining.current === 2)" });
  assert.equal(e.step(observation({ remaining: 2 }), 0).p.status, "pending");
  assert.throws(
    () => e.initialize({ p: "always(() => )" }),
    /Test expression:/,
  );
  assert.throws(() => e.initialize({ p: "42" }), /Expected a Bombadil formula/);
  e.initialize({ p: 'always(() => {throw Error("predicate failed")})' });
  assert.throws(() => e.step(observation(), 1), /predicate failed/);
  e.dispose();
});
test("reevaluating 100 recorded observations stays responsive", async () => {
  const e = await BrowserEvaluator.create(bytes);
  e.initialize({ p: "always(() => remaining.current >= 0)" });
  const start = performance.now();
  for (let i = 0; i < 100; i++) e.step(observation(), i);
  console.log(
    `100-state WASM evaluation: ${(performance.now() - start).toFixed(1)} ms`,
  );
  e.dispose();
});

test("lesson transitions apply only when their observed state changes", async () => {
  const e = await BrowserEvaluator.create(bytes);
  const twoTodos = [
    { id: 1, text: "A", completed: false },
    { id: 2, text: "B", completed: false },
  ];
  e.initialize({ p: properties.filterPreservesCount.source });
  e.step(observation(), 0);
  // Adding a todo changes the count without changing the filter: allowed.
  assert.equal(
    e.step(observation({ todos: twoTodos, remaining: 2 }), 1).p.status,
    "pending",
  );
  assert.equal(
    e.step(observation({ todos: twoTodos, remaining: 2, filter: "active" }), 2)
      .p.status,
    "pending",
  );
  assert.equal(
    e.step(
      observation({ todos: twoTodos, remaining: 0, filter: "completed" }),
      3,
    ).p.status,
    "violation",
  );

  e.initialize({ p: properties.addingPreservesFilter.source });
  e.step(observation(), 0);
  // Filtering without adding an item is allowed.
  assert.equal(
    e.step(observation({ filter: "completed" }), 1).p.status,
    "pending",
  );
  assert.equal(
    e.step(observation({ todos: twoTodos, filter: "all" }), 2).p.status,
    "violation",
  );
  e.initialize({ p: properties.addingPreservesFilter.source });
  e.step(observation({ filter: "completed" }), 0);
  assert.equal(
    e.step(observation({ todos: twoTodos, filter: "completed" }), 1).p.status,
    "pending",
  );
  e.dispose();
});

test("native Bombadil reports retain formulas, implication context, values and timeout times", async () => {
  const e = await BrowserEvaluator.create(bytes);
  const source = properties.filterPreservesCount.source;
  e.initialize({ p: source });
  e.step(observation(), 0);
  const verdict = e.step(
    observation({ filter: "completed", remaining: 2 }),
    250,
  ).p;
  assert.equal(verdict.status, "violation");
  const report = renderBombadilReport(verdict.report);
  assert.match(report, /it should always be the case that/);
  assert.match(report, /remaining\.current === before/);
  assert.match(report, /failing the implication because/);
  assert.match(report, /<code>remaining<\/code> = <code>1<\/code>/);
  assert.match(report, /<code>remaining<\/code> = <code>2<\/code>/);
  assert.match(report, /00:00\.250/);
  assert.match(report, /from the prior state at/);
  e.initialize({
    p: 'eventually(() => ready.current).within(100, "milliseconds")',
  });
  e.step(observation({ ready: false }), 0);
  const timeout = e.step(observation({ ready: false }), 101).p;
  assert.match(
    renderBombadilReport(timeout.report),
    /was never true before <time>00:00\.101<\/time>/,
  );
  e.initialize({ p: "always(() => remaining.current === 99)" });
  const edited = e.step(observation(), 0).p;
  assert.match(
    renderBombadilReport(edited.report),
    /remaining\.current === 99/,
  );
  assert.match(
    renderBombadilReport(edited.report),
    /<code>remaining<\/code> = <code>1<\/code>/,
  );
  e.dispose();
});
