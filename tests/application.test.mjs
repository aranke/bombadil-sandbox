import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { applicationWorker } from "./build/application.js";
import { brokenCode, fixedCode } from "./build/model.js";

function runtime(code, saved = null) {
  let response;
  const context = createContext({
    structuredClone,
    self: {
      postMessage: (value) => {
        response = structuredClone(value);
      },
    },
  });
  runInContext(`(${applicationWorker.toString()})();`, context);
  const request = (data) => {
    context.request = { id: 1, ...data };
    runInContext("self.onmessage({data: request})", context, { timeout: 1000 });
    if (response.error) throw Error(response.error);
    return response.result;
  };
  return {
    initial: request({ kind: "init", code, saved }),
    step: (action) => request({ kind: "action", action }),
  };
}

test("module owns initial state, filtering, counts, and unsaved vs saved todos", () => {
  const app = runtime(brokenCode);
  assert.equal(app.initial.view.remaining, 1);
  assert.deepEqual(app.initial.view.visibleIds, [1, 2]);
  const filtered = app.step({ type: "filter", filter: "active" });
  assert.deepEqual(filtered.view.visibleIds, [1]);
  const changed = app.step({ type: "toggle", id: 1 });
  assert.equal(changed.view.remaining, 0);
  assert.equal(changed.savedChanged, false);
  assert.equal(
    runtime(brokenCode, changed.saved).initial.view.todos[0].completed,
    false,
  );
  const fixed = runtime(fixedCode).step({ type: "toggle", id: 1 });
  assert.equal(fixed.savedChanged, true);
  assert.equal(
    runtime(fixedCode, fixed.saved).initial.view.todos[0].completed,
    true,
  );
  const custom = runtime(
    fixedCode.replace("Plant something green", "My initial todo"),
  );
  assert.equal(custom.initial.view.todos[0].text, "My initial todo");
});

test("ordinary module closures persist and storage values are explicitly controlled", () => {
  const code = fixedCode
    .replace('let filter = "all";', 'let filter = "all"; let clicks = 0;')
    .replace("filter = value;", "filter = value; clicks++;")
    .replace("remaining: remainingCount(),", "remaining: clicks,");
  const app = runtime(code);
  assert.equal(
    app.step({ type: "filter", filter: "active" }).view.remaining,
    1,
  );
  assert.equal(app.step({ type: "filter", filter: "all" }).view.remaining, 2);
  const objectStorage = fixedCode
    .replace(
      "storage.load() ?? initialTodos",
      "storage.load()?.items ?? initialTodos",
    )
    .replace("storage.save(todos)", "storage.save({items: todos})");
  const result = runtime(objectStorage).step({ type: "toggle", id: 1 });
  assert.equal(
    runtime(objectStorage, result.saved).initial.view.todos[0].completed,
    true,
  );
});

test("incorrect display rules are returned unchanged for the DOM tests to catch", () => {
  const badCount = runtime(
    fixedCode.replace(
      "return todos.filter(todo => !todo.completed).length;",
      "return 99;",
    ),
  );
  assert.equal(badCount.initial.view.remaining, 99);
  const badFilter = runtime(
    fixedCode.replace('filter === "all" ||', "true ||"),
  );
  assert.deepEqual(
    badFilter.step({ type: "filter", filter: "active" }).view.visibleIds,
    [1, 2],
  );
  assert.throws(() => runtime("function createApp() { return {}; }"), /view/);
});
