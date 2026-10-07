import test from "node:test";
import assert from "node:assert/strict";
import { failureDetail, renderBombadilReport } from "./build/diagnostics.js";
import { properties, stepLabel } from "./build/model.js";

test("completion step labels describe recorded results, including edited handlers", () => {
  const todo = { id: 1, text: "A", completed: false };
  const previous = { observation: { todos: [todo] } };
  const entry = {
    action: { type: "toggle", id: 1 },
    observation: { todos: [{ ...todo, completed: true }] },
  };
  assert.equal(stepLabel(entry, previous, true), "Complete");
  assert.equal(stepLabel(entry, previous), "Complete todo #1");
  assert.equal(
    stepLabel({ ...previous, action: entry.action }, entry, true),
    "Uncomplete",
  );
  entry.observation.todos = [todo];
  assert.equal(stepLabel(entry, previous, true), "Unchanged");
  entry.observation.todos = [];
  assert.equal(stepLabel(entry, previous, true), "Removed");
});

test("native report code, names and captured values are escaped for HTML", () => {
  const html = renderBombadilReport({
    kind: "join",
    children: [
      { kind: "code-block", text: '<img src=x onerror="alert(1)">' },
      {
        kind: "snapshot",
        name: "<script>",
        value: { text: "</pre><script>alert(1)</script>" },
      },
    ],
  });
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;/);
});

test("reload diagnostics identify changed fields, removed items, and reordered lists", () => {
  const a = { id: 1, text: "A", completed: true };
  const b = { id: 2, text: "B", completed: false };
  const previous = { observation: { todos: [a, b] } };
  const entry = {
    index: 3,
    action: { type: "reload" },
    observation: { todos: [{ ...a, completed: false }, b] },
  };
  const explain = () =>
    failureDetail(
      entry,
      previous,
      "persistence",
      properties.persistence.source,
    );
  assert.deepEqual(explain(), {
    message:
      "“A” became incomplete after reload. It should still be completed.",
    ids: [1],
  });
  entry.observation.todos = [{ ...a, text: "renamed" }, b];
  assert.match(explain().message, /Reloading renamed “A” to “renamed”/);
  entry.observation.todos = [b];
  assert.match(explain().message, /“A” disappeared/);
  entry.observation.todos = [b, a];
  assert.deepEqual(explain(), {
    message:
      "Reloading changed the order of the todos. The order should stay the same.",
    ids: [],
  });
});

test("edited tests never receive a guessed persistence explanation", () => {
  const entry = { index: 0, action: null, observation: { todos: [] } };
  assert.deepEqual(
    failureDetail(entry, undefined, "persistence", "always(() => false)"),
    { message: "The test failed in the initial state.", ids: [] },
  );
});
