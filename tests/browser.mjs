import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  fixedCode,
  initialTodos,
  chooseAction,
  random,
  defaultSeed,
  properties,
} from "./build/model.js";
import { examples } from "./build/examples.js";
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(15000);
// A mock registry tests the optional tool contract, not browser WebMCP support.
await page.addInitScript(() => {
  window.testTools = {};
  Object.defineProperty(document, "modelContext", {
    value: {
      registerTool(tool) {
        window.testTools[tool.name] = tool;
      },
    },
  });
});
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("Browser:", m.text());
});
page.on("request", (req) => {
  if (
    /^https?:/.test(req.url()) &&
    !req.url().startsWith("http://127.0.0.1:4173")
  )
    external.push(req.url());
});
const state = () => page.evaluate(() => window.bombadilSandbox?.getState());
const idle = () =>
  page.waitForFunction(() => {
    const s = window.bombadilSandbox?.getState();
    return s && !s.playing && !s.busy && !s.updating && !s.stale;
  });
const savedToggle = async () => {
  await page.locator("#app-source .cm-content").fill(fixedCode);
  await page.locator("#apply-behaviors").click();
};
const scrub = async (value) => {
  await page.locator("#scrubber").fill(String(value));
};
try {
  await page.goto("http://127.0.0.1:4173");
  await page.waitForFunction(
    () =>
      window.bombadilSandbox && !window.bombadilSandbox.getState().busy,
    {},
    { timeout: 10000 },
  );
  // A fresh browser gets the tour once, after initialization. Dismissing it
  // counts as seen, and revisiting preserves access through the Tour button.
  const firstVisitTour = page.getByRole("dialog", {
    name: "Guided tour",
    exact: true,
  });
  assert.equal(await firstVisitTour.isVisible(), true);
  assert.equal(
    await firstVisitTour.locator("#tour-count").textContent(),
    "1 / 7",
  );
  assert.equal((await state()).entries.length, 1);
  assert.equal((await state()).playing, false);
  await page.keyboard.press("Escape");
  await page.reload();
  await idle();
  assert.equal(await firstVisitTour.isVisible(), false);
  console.log("Browser checks: first-visit tour and persistence passed");
  const toolNames = await page.evaluate(() => Object.keys(window.testTools));
  assert.deepEqual(toolNames.sort(), [
    "read_playground_state",
    "run_guided_example",
  ]);
  const invalidInput = await page.evaluate(async () => {
    try {
      await window.testTools.run_guided_example.execute({ unexpected: true });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(invalidInput, true);
  assert.equal(await page.locator("#run").isVisible(), true);
  assert.equal(await page.locator("#app-source .cm-content").isVisible(), true);
  assert.equal(
    await page.locator("#property-source .cm-content").isVisible(),
    true,
  );
  assert.equal(await page.locator("#run").textContent(), "Replay");
  assert.equal(await page.locator("#run").isDisabled(), true);
  assert.equal(await page.locator("#new-run").isVisible(), true);
  assert.equal(await page.locator("#new-run").textContent(), "Continue");
  assert.equal(
    await page
      .getByRole("button", { name: "Reload app", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await page.locator("#reset-app").textContent(), "Start over");
  assert.equal(await page.locator("#position").textContent(), "Start");
  assert.equal(await page.locator(".timeline").isVisible(), false);
  assert.equal(await page.getByRole("combobox").count(), 1);
  assert.equal(
    await page
      .getByRole("combobox", { name: "Example", exact: true })
      .inputValue(),
    "persistence",
  );
  assert.ok(await page.locator("#app-source .cm-lineNumbers").count());
  assert.ok(await page.locator("#app-source .cm-line span").count());
  // The optional tour explains the UI without changing drafts or running steps.
  const tourButton = page.getByRole("button", {
    name: "Start guided tour",
    exact: true,
  });
  const tour = page.getByRole("dialog", { name: "Guided tour", exact: true });
  assert.equal(await tour.isVisible(), false);
  const tourOriginalCode = (await state()).draftCode;
  await page
    .locator("#app-source .cm-content")
    .fill(tourOriginalCode + "\n// Tour draft");
  await page
    .locator("#recorded-app .new-todo")
    .fill("Keep this unfinished todo");
  const beforeTour = await state();
  await tourButton.click();
  assert.equal(await tour.isVisible(), true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        document.querySelector(".tour-dialog").contains(document.activeElement),
      ),
      true,
    );
  }
  await page.keyboard.press("ArrowRight");
  assert.equal(await tour.locator("#tour-count").textContent(), "2 / 7");
  await tour.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await tour.locator("#tour-count").textContent(), "1 / 7");
  await page.keyboard.press("Escape");
  assert.equal(await tour.isVisible(), false);
  assert.equal(
    await tourButton.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(await state(), beforeTour);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await tourButton.click();
    for (let i = 0; i < 7; i++) {
      assert.equal(
        await tour.locator("#tour-count").textContent(),
        `${i + 1} / 7`,
      );
      assert.equal(
        await tour.locator(".tour-card").evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
        true,
        "Tour cards stay within the viewport",
      );
      if ((width === 1440 && i === 1) || (width === 390 && i === 5)) {
        await page.screenshot({ path: `test-results/tour-${width}.png` });
      }
      await tour
        .getByRole("button", { name: i === 6 ? "Done" : "Next", exact: true })
        .click();
    }
    assert.equal(await tour.isVisible(), false);
    assert.deepEqual(await state(), beforeTour);
    assert.equal(
      await page.locator("#recorded-app .new-todo").inputValue(),
      "Keep this unfinished todo",
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#recorded-app .new-todo").fill("");
  await page.locator("#app-source .cm-content").fill(tourOriginalCode);
  await page.locator("#app-source .cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  // Mouse and keyboard selections remain usable in both code editors.
  for (const [editorId, word] of [
    ["app-source", "function"],
    ["property-source", "always"],
  ]) {
    const content = page.locator(`#${editorId} .cm-content`);
    await content.click();
    await page.keyboard.press("ControlOrMeta+Home");
    await content.locator(".cm-line").first().scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const source = async () => {
      const current = await state();
      return editorId === "app-source"
        ? current.draftCode
        : current.sources[current.selectedTest];
    };
    const original = await source();
    const endpoints = await content
      .locator(".cm-line")
      .first()
      .evaluate((line, length) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const start = walker.nextNode();
        let end = start,
          offset = length;
        while (offset > end.textContent.length) {
          offset -= end.textContent.length;
          end = walker.nextNode();
        }
        const range = document.createRange();
        range.setStart(start, 0);
        range.collapse(true);
        const from = range.getBoundingClientRect();
        range.setStart(end, offset);
        range.collapse(true);
        const to = range.getBoundingClientRect();
        return { from: from.x, to: to.x, y: from.y + from.height / 2 };
      }, word.length);
    await page.mouse.move(endpoints.from, endpoints.y);
    await page.mouse.down();
    await page.mouse.move(endpoints.to, endpoints.y, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), word);
    assert.match(
      await content
        .locator(".cm-activeLine")
        .evaluate((line) => getComputedStyle(line).backgroundColor),
      /^rgba\([^)]*,\s*0(?:\.\d+)?\)$/,
      "Current-line shading must let the selection highlight show through",
    );
    await content.screenshot({
      path: `test-results/${editorId}-selection.png`,
    });
    await page.keyboard.type(word);
    assert.equal(await source(), original);
    await page.keyboard.press("ControlOrMeta+Home");
    for (let i = 0; i < word.length; i++)
      await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await page.evaluate(() => getSelection().toString()), word);
    await page.keyboard.type(word);
    assert.equal(await source(), original);
    await page.keyboard.press("ControlOrMeta+A");
    assert.equal(
      await page.evaluate(() => getSelection().toString()),
      original,
    );
    await page.keyboard.insertText(original);
    assert.equal(await source(), original);
    await idle();
  }
  // Tab/Shift-Tab indent and undo indentation without leaving the editor.
  await page.locator("#app-source .cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Tab");
  await page.waitForFunction(() =>
    window.bombadilSandbox.getState().draftCode.startsWith("  function"),
  );
  await page.keyboard.press("Shift+Tab");
  await idle();
  assert.match((await state()).draftCode, /^function/);
  assert.equal(await page.locator("#apply-behaviors").isDisabled(), true);
  assert.equal(await page.locator("#apply-behaviors").isVisible(), false);
  const pane = page.locator(".behaviors-pane");
  const originalWidth = (await pane.boundingBox()).width;
  const separator = page.getByRole("separator", {
    name: "Resize App and Tests",
  });
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  assert.ok((await pane.boundingBox()).width > originalWidth);
  await page.keyboard.press("ArrowLeft");
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + 100);
  await page.mouse.up();
  assert.ok((await pane.boundingBox()).width > originalWidth + 30);

  assert.equal(
    await page.locator(".toolbar, .tabs, .settings, .steps").count(),
    0,
  );
  assert.equal(await page.locator(".pane").count(), 3);
  assert.equal(await page.locator(".output-pane #scrubber").count(), 1);
  const appliedBeforeDraft = (await state()).code;
  await page.locator("#app-source .cm-content").fill("while (true) {}");
  await page.waitForTimeout(900);
  assert.equal((await state()).error, "");
  assert.equal((await state()).entries.length, 1);
  await page.locator("#reset-app").click();
  await idle();
  assert.equal((await state()).code, appliedBeforeDraft);
  assert.equal((await state()).draftCode, "while (true) {}");
  // Manual output controls use the same driver and verifier as generated actions.
  const todoInput = page.locator("#recorded-app .new-todo");
  await todoInput.fill("Manual todo");
  const initialTestSource = (await state()).sources.persistence;
  await page.locator("#property-source .cm-content").fill("always(() => true)");
  await idle();
  assert.equal(
    await todoInput.inputValue(),
    "Manual todo",
    "Editing the test preserves an unfinished todo",
  );
  await page.locator("#property-source .cm-content").fill(initialTestSource);
  await idle();
  assert.equal(
    await page.locator("#app-source .cm-content").innerText(),
    "while (true) {}",
  );
  await todoInput.press("Enter");
  await idle();
  assert.equal((await state()).entries.length, 2);
  assert.equal(
    (await state()).entries.at(-1).observation.todos.at(-1).text,
    "Manual todo",
  );
  assert.equal(await todoInput.inputValue(), "");
  assert.equal(
    await page
      .locator("#recorded-app")
      .evaluate((el) =>
        el.shadowRoot.activeElement?.classList.contains("new-todo"),
      ),
    true,
  );
  // The manual add used applied code, not the unexecuted infinite-loop draft.
  assert.equal((await state()).error, "");
  await page.locator("#app-source .cm-content").fill(appliedBeforeDraft);
  assert.equal(await page.locator("#apply-behaviors").isDisabled(), true);
  assert.equal(await page.locator("#apply-behaviors").isVisible(), false);
  await page.locator('#recorded-app li[data-id="3"] input').click();
  await idle();
  assert.match(
    await page.locator("#position").getAttribute("title"),
    /Complete/,
  );
  assert.equal(
    (await state()).entries.length,
    3,
    "One click records one action",
  );
  await page.locator('#recorded-app [data-filter="active"]').click();
  await idle();
  assert.equal((await state()).entries.at(-1).observation.filter, "active");
  await page.locator('#recorded-app [data-filter="all"]').click();
  await idle();
  await page.locator('#recorded-app li[data-id="1"] .delete').click();
  await idle();
  assert.equal((await state()).entries.at(-1).observation.todos.length, 2);
  const manualActions = (await state()).entries.map((e) => e.action);
  await todoInput.fill("Keep this draft");
  await scrub(1);
  assert.equal(await page.locator("#new-run").isDisabled(), true);
  assert.equal(
    await page.locator("#recorded-app .new-todo").isDisabled(),
    true,
  );
  assert.equal(await todoInput.inputValue(), "");
  await page.locator("#back-live").click();
  assert.equal(await todoInput.inputValue(), "Keep this draft");
  assert.equal(
    await page.locator("#recorded-app .new-todo").isDisabled(),
    false,
  );
  await page.locator("#run").click();
  await idle();
  assert.deepEqual(
    (await state()).entries.map((e) => e.action),
    manualActions,
    "Manual actions replay exactly",
  );
  await page.locator('#recorded-app li[data-id="3"] input').click();
  await idle();
  assert.match(
    await page.locator("#position").getAttribute("title"),
    /Uncomplete/,
  );
  await page.locator("#reload-app").click();
  await idle();
  assert.equal(
    (await state()).entries.at(-1).results.persistence.status,
    "violation",
  );
  assert.match(
    await page.locator("#result").textContent(),
    /“Manual todo” became completed after reload. It should still be incomplete/,
  );
  assert.equal(await page.locator("#reload-app").isDisabled(), true);
  assert.equal(await page.locator("#new-run").isDisabled(), true);
  await page.locator("#reset-app").click();
  await idle();
  assert.equal((await state()).entries.length, 1);
  assert.equal(
    await page.locator("#recorded-app .new-todo").isDisabled(),
    false,
  );
  await page.locator("#new-run").click();
  await page.waitForFunction(
    () =>
      window.bombadilSandbox.getState().entries.at(-1)?.results.persistence
        .status === "violation",
  );
  await idle();
  assert.equal(
    (await state()).entries.length,
    4,
    "Default run should fail after only three actions",
  );
  assert.deepEqual(
    (await state()).entries.slice(1).map((e) => e.action.type),
    ["add", "toggle", "reload"],
  );
  assert.equal(await page.locator("#run").textContent(), "Replay");
  assert.equal(await page.locator("#new-run").isVisible(), true);
  assert.match(
    await page.locator("#result").textContent(),
    /became incomplete after reload. It should still be completed/,
  );
  assert.equal(
    await page.locator('#recorded-app li[data-id="3"][data-changed]').count(),
    1,
  );
  await scrub(2);
  assert.equal((await state()).selected, 2);
  assert.equal(
    await page.locator('#recorded-app li[data-id="3"] input').isChecked(),
    true,
  );
  assert.equal(await page.locator("#recorded-app [data-changed]").count(), 0);
  await scrub(3);
  // Editing the example's test rechecks history without resetting the app.
  const persistenceSource = (await state()).sources.persistence;
  const failureHistory = (await state()).entries.map(
    ({ results, ...entry }) => entry,
  );
  await page
    .locator("#property-source .cm-content")
    .fill(properties.count.source);
  await idle();
  assert.equal((await state()).selectedTest, "persistence");
  assert.equal((await state()).selected, 3);
  assert.deepEqual(
    (await state()).entries.map(({ results, ...entry }) => entry),
    failureHistory,
  );
  assert.deepEqual(Object.keys((await state()).entries.at(-1).results), [
    "persistence",
  ]);
  assert.equal(await page.locator("#new-run").isEnabled(), true);
  await page.locator("#reload-app").click();
  await idle();
  assert.equal((await state()).entries.length, 5);
  assert.equal((await state()).sources.persistence, properties.count.source);
  assert.equal(await page.locator("#new-run").isEnabled(), true);
  await page.locator("#property-source .cm-content").fill(persistenceSource);
  await idle();
  assert.equal((await state()).entries.length, 5);
  assert.equal((await state()).selected, 4);
  assert.equal(
    (await state()).entries.at(-1).results.persistence.status,
    "violation",
  );
  assert.equal(await page.locator("#new-run").isDisabled(), true);
  // A broken test in one example must not block another example.
  await page.locator("#property-source .cm-content").fill("always(() => )");
  await page.waitForFunction(
    () => !!window.bombadilSandbox.getState().error,
  );
  await page.locator("#example-choice").selectOption("count");
  await idle();
  await page.locator("#reload-app").click();
  await idle();
  assert.equal((await state()).error, "");
  assert.deepEqual(Object.keys((await state()).entries.at(-1).results), [
    "count",
  ]);
  await page.locator("#example-choice").selectOption("persistence");
  await page.waitForFunction(
    () => !!window.bombadilSandbox.getState().error,
  );
  await page.locator("#property-source .cm-content").fill(persistenceSource);
  await idle();
  await page.locator("#reset-app").click();
  await idle();
  await page.evaluate(() => window.bombadilSandbox.runGuided());
  await page.waitForFunction(() =>
    document.querySelector("#result")?.classList.contains("failure"),
  );
  let s = await state();
  assert.equal(s.entries.length, 4);
  assert.equal(
    s.entries[1].observation.todos.length,
    3,
    "Add must actually submit the todo",
  );
  assert.equal(s.entries[3].results.persistence.status, "violation");
  assert.equal(s.entries[2].observation.todos[0].completed, true);
  assert.equal(s.entries[3].observation.todos[0].completed, false);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/violation-desktop.png",
    fullPage: true,
  });
  await scrub(2);
  assert.equal(await page.locator("#recorded-app").isVisible(), true);
  assert.equal((await state()).selected, 2);
  const beforeBehaviorDraft = await state();
  const beforeDraftOutput = await page
    .locator("#recorded-app #todoapp")
    .innerHTML();
  await page.locator("#app-source .cm-content").fill(fixedCode);
  await page.waitForTimeout(900);
  assert.deepEqual((await state()).entries, beforeBehaviorDraft.entries);
  assert.equal((await state()).selected, beforeBehaviorDraft.selected);
  assert.equal((await state()).code, beforeBehaviorDraft.code);
  assert.equal((await state()).draftCode, fixedCode);
  assert.equal((await state()).pendingBehaviors, true);
  assert.equal(await page.locator("#apply-behaviors").isVisible(), true);
  assert.equal((await state()).playing, false);
  assert.equal(
    await page.locator("#recorded-app #todoapp").innerHTML(),
    beforeDraftOutput,
  );
  assert.equal(
    (await page.locator("#app-source .cm-line").allTextContents()).join("\n"),
    fixedCode,
  );
  await page.locator("#apply-behaviors").click();
  await page.waitForFunction(() => {
    const s = window.bombadilSandbox.getState();
    return (
      !s.playing &&
      !s.busy &&
      s.entries.length === 4 &&
      s.code.includes("todo.completed = !todo.completed;\n    persist();") &&
      s.entries[3].results.persistence.status === "pending"
    );
  });
  s = await state();
  assert.equal(s.entries[3].observation.todos[0].completed, true);
  assert.equal(s.error, "");
  assert.equal(await page.locator("#recorded-app [data-changed]").count(), 0);
  const liveMarkup = await page
    .frameLocator("#live-app iframe")
    .locator("#todoapp")
    .innerHTML();
  assert.equal(
    await page.locator("#recorded-app #todoapp").innerHTML(),
    liveMarkup,
    "Recorded and live views use identical markup",
  );
  await page.screenshot({
    path: "test-results/fixed-desktop.png",
    fullPage: true,
  });
  // Applying onAdd reruns the current trace through the edited behavior.
  await page
    .locator("#app-source .cm-content")
    .fill(
      fixedCode.replace(
        "{ id, text, completed: false }",
        "{ id, text: text.toUpperCase(), completed: false }",
      ),
    );
  await page.locator("#apply-behaviors").click();
  await idle();
  assert.equal(
    (await state()).entries[1].observation.todos.at(-1).text,
    "WATCH WHAT HAPPENS",
  );
  await savedToggle();
  await idle();
  await page
    .locator("#property-source .cm-content")
    .fill("always(() => false)");
  await page.waitForFunction(
    () =>
      window.bombadilSandbox.getState().entries[0]?.results.persistence
        .status === "violation",
  );
  assert.match(
    await page.locator("#result").textContent(),
    /The test failed in the initial state/,
  );
  assert.doesNotMatch(
    await page.locator("#result").textContent(),
    /after reload/,
  );
  assert.equal(await page.locator("#recorded-app [data-changed]").count(), 0);
  await page.locator(".bombadil-report summary").click();
  assert.match(
    await page.locator(".bombadil-report-body").textContent(),
    /false/,
  );
  await page.locator(".bombadil-report summary").click();
  await page.locator("#property-source .cm-content").fill("always(() => )");
  await page.waitForFunction(() =>
    document
      .querySelector("#result")
      .textContent.toLowerCase()
      .includes("out of date"),
  );
  await page.locator("#property-source .cm-content").fill("always(() => true)");
  await page.waitForFunction(
    () =>
      window.bombadilSandbox.getState().entries[0]?.results.persistence
        .status === "pending" && !window.bombadilSandbox.getState().error,
  );
  await page.locator("#app-source .cm-content").fill("while (true) {}");
  await page.waitForTimeout(900);
  assert.equal((await state()).error, "");
  assert.equal((await state()).code, fixedCode);
  await page.locator("#apply-behaviors").click();
  await page.waitForFunction(
    () => window.bombadilSandbox.getState().error.includes("too long"),
    {},
    { timeout: 10000 },
  );
  await savedToggle();
  await idle();
  assert.equal(
    (await state()).entries.length,
    4,
    "Fixing a failed handler must replay the complete original sequence",
  );
  // Cancelling an active run must not allow a late response to refill the history.
  await page.locator("#run").click();
  await page.waitForFunction(
    () => window.bombadilSandbox.getState().entries.length >= 2,
  );
  await page.evaluate(() => window.bombadilSandbox.reset());
  await idle();
  await page.waitForTimeout(800);
  assert.equal((await state()).entries.length, 1);
  assert.equal((await state()).error, "");
  // A runaway property is isolated, times out, and is recoverable by editing it.
  await page
    .locator("#property-source .cm-content")
    .fill("always(() => { while (true) {} })");
  await page.waitForFunction(
    () => window.bombadilSandbox.getState().error.includes("timed out"),
    {},
    { timeout: 10000 },
  );
  await page.locator("#property-source .cm-content").fill("always(() => true)");
  await page.waitForFunction(
    () =>
      !window.bombadilSandbox.getState().error &&
      document
        .querySelector("#result")
        .textContent.includes("No failure so far"),
  );
  // The optional structured journey uses exactly the same state as the UI.
  const toolResult = await page.evaluate(() =>
    window.testTools.run_guided_example.execute({}),
  );
  console.log("Browser checks: editor, replay and error recovery passed");
  assert.equal(toolResult.actions, 3);
  assert.equal(toolResult.error, "");
  const readBack = await page.evaluate(() =>
    window.testTools.read_playground_state.execute({}),
  );
  assert.equal(readBack.actions, 3);
  // A scrubbed trace can be replayed through the same single control.
  await scrub(1);
  await page.locator("#run").click();
  await idle();
  assert.equal((await state()).entries.length, 4);
  assert.equal((await state()).selected, 3);
  // Property changes must not modify the already recorded app observations.
  const prior = await page.evaluate(() =>
    JSON.stringify(
      window.bombadilSandbox.getState().entries.map((e) => e.observation),
    ),
  );
  await page
    .locator("#property-source .cm-content")
    .fill("always(() => remaining.current >= 0)");
  await page.waitForFunction(() =>
    document.querySelector("#result").textContent.includes("No failure so far"),
  );
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        window.bombadilSandbox.getState().entries.map((e) => e.observation),
      ),
    ),
    prior,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile layout should not overflow",
  );
  // Output uses the shared renderer, including its footer, at mobile width.
  assert.equal(await page.locator("#recorded-app footer").isVisible(), true);
  assert.equal(await page.locator("#recorded-app .new-todo").isVisible(), true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  console.log("Browser checks: mobile preview passed");
  const editsBeforeNewRun = (await state()).code;
  // Continuing must append to manual history, not reset the app or evaluator.
  await todoInput.fill("Keep my manual setup");
  await todoInput.press("Enter");
  await idle();
  const manualTodo = (await state()).entries.at(-1).observation.todos.at(-1);
  await page
    .locator(`#recorded-app li[data-id="${manualTodo.id}"] input`)
    .click();
  await idle();
  await page.locator('#recorded-app [data-filter="completed"]').click();
  await idle();
  await todoInput.fill("Keep my unfinished draft");
  const beforeContinuation = (await state()).entries;
  await page.locator("#new-run").click();
  await page.waitForFunction(
    (length) => window.bombadilSandbox.getState().entries.length > length,
    beforeContinuation.length,
  );
  assert.equal(await page.locator("#run").textContent(), "Stop");
  await page.locator("#run").click();
  await idle();
  assert.equal((await state()).error, "");
  assert.equal((await state()).code, editsBeforeNewRun);
  let continued = (await state()).entries;
  assert.deepEqual(
    continued.slice(0, beforeContinuation.length),
    beforeContinuation,
  );
  const firstNewState = continued[beforeContinuation.length].observation;
  assert.equal(firstNewState.filter, "completed");
  assert.deepEqual(
    firstNewState.todos.find((t) => t.id === manualTodo.id),
    {
      ...manualTodo,
      completed: true,
    },
  );
  assert.equal(await todoInput.inputValue(), "Keep my unfinished draft");
  const stoppedHistory = continued;
  await page.locator("#new-run").click();
  await page.waitForFunction(
    (length) =>
      window.bombadilSandbox.getState().entries.length >= length + 2,
    stoppedHistory.length,
  );
  await page.locator("#run").click();
  await idle();
  continued = (await state()).entries;
  assert.deepEqual(continued.slice(0, stoppedHistory.length), stoppedHistory);
  const expectedRandom = random(defaultSeed);
  for (let i = beforeContinuation.length; i < continued.length; i++) {
    assert.deepEqual(
      continued[i].action,
      chooseAction(continued[i - 1].observation, expectedRandom, {
        create: 3,
        interact: 5,
        reload: 2,
      }),
      "Continue preserves the random sequence across Stop",
    );
  }
  const exploredActions = (await state()).entries.map((e) => e.action);
  await page.locator("#run").click();
  await idle();
  assert.deepEqual(
    (await state()).entries.map((e) => e.action),
    exploredActions,
    "Replay must use the concrete explored actions",
  );
  // A long timeline must keep the scrubber and current step on-screen.
  while ((await state()).entries.length < 13) {
    const priorLength = (await state()).entries.length;
    await todoInput.fill("Long timeline check");
    await todoInput.press("Enter");
    await idle();
    assert.ok(
      (await state()).entries.length > priorLength,
      "Adding a todo must extend the timeline",
    );
  }
  const lastState = (await state()).entries.length - 1;
  const assertTimelineVisible = async (index) => {
    assert.equal((await state()).selected, index);
    assert.equal(await page.locator("#scrubber").inputValue(), String(index));
    const fits = await page.evaluate(() => {
      const viewport = document.querySelector(".timeline-scrub");
      const clip = viewport.getBoundingClientRect();
      return ["#scrubber", "#position"].every((selector) => {
        const bounds = viewport.querySelector(selector).getBoundingClientRect();
        return bounds.left >= clip.left - 1 && bounds.right <= clip.right + 1;
      });
    });
    assert.equal(
      fits,
      true,
      "The entire scrubber and current step stay visible",
    );
  };
  await assertTimelineVisible(lastState);
  await scrub(0);
  await assertTimelineVisible(0);
  await scrub(1);
  await assertTimelineVisible(1);
  await scrub(6);
  await assertTimelineVisible(6);
  await page.locator("#back-live").click();
  await assertTimelineVisible(lastState);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(100);
  await assertTimelineVisible(lastState);
  await page.screenshot({
    path: "test-results/long-timeline-mobile.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  console.log("Browser checks: long mobile timeline passed");
  await page.evaluate(() => window.bombadilSandbox.exportTrace());
  assert.equal(
    (await downloadPromise).suggestedFilename(),
    "bombadil-sandbox-trace.json",
  );
  // Failure and historical states freeze controls, but must still scroll.
  console.log("Browser checks: preparing overflow history");
  await page.locator('#recorded-app [data-filter="all"]').click();
  await idle();
  while ((await state()).entries.at(-1).observation.todos.length < 24) {
    const priorCount = (await state()).entries.at(-1).observation.todos.length;
    console.log("Overflow todos", priorCount);
    await todoInput.fill("Overflow check");
    console.log("Overflow input filled");
    await todoInput.press("Enter");
    console.log("Overflow input submitted");
    await idle();
    assert.ok(
      (await state()).entries.at(-1).observation.todos.length > priorCount,
      "Adding a todo must extend the list",
    );
  }
  // Keep an identical, scrollable All snapshot immediately before the failure.
  console.log("Browser checks: overflow history prepared");
  await page.locator('#recorded-app [data-filter="all"]').click();
  await idle();
  console.log("Browser checks: overflow filter selected");
  await page
    .locator("#property-source .cm-content")
    .fill("always(() => false)");
  await idle();
  console.log("Browser checks: overflow test changed");
  assert.equal(
    (await state()).entries.at(-1).results.persistence.status,
    "violation",
  );
  const failedHistory = (await state()).entries;
  const list = page.locator("#recorded-app .todo-list");
  const assertCanScroll = async () => {
    console.log("Browser checks: checking read-only scrolling");
    assert.equal(
      await list.evaluate((el) => el.scrollHeight > el.clientHeight),
      true,
    );
    assert.equal(
      await page
        .locator("#recorded-app #todoapp")
        .evaluate((el) =>
          [...el.querySelectorAll("input, button")].every(
            (control) => control.disabled,
          ),
        ),
      true,
    );
    await list.hover();
    console.log("Browser checks: list hovered");
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(
      () =>
        document
          .querySelector("#recorded-app")
          .shadowRoot.querySelector(".todo-list").scrollTop > 0,
    );
    // Keyboard scrolling remains available even though all app controls are disabled.
    await list.evaluate((el) => {
      el.scrollTop = 0;
    });
    await list.focus();
    console.log("Browser checks: list focused");
    await page.keyboard.press("ArrowDown");
    console.log("Browser checks: list keyboard event sent");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#recorded-app")
        .shadowRoot.querySelector(".todo-list").scrollTop > 0,
    );
    console.log("Browser checks: scrolling passed");
  };
  await assertCanScroll();
  const allState = failedHistory.findLastIndex(
    (entry, index) =>
      index < failedHistory.length - 1 &&
      entry.observation.filter === "all" &&
      entry.observation.visible.length > 4,
  );
  assert.ok(allState >= 0);
  await scrub(allState);
  await assertCanScroll();
  console.log("Browser checks: comparing preserved history");
  assert.deepEqual(
    (await state()).entries,
    failedHistory,
    "Scrolling does not change the recorded state",
  );
  console.log("Browser checks: preserved history passed");
  // Simulate a static host mounting dist/ under a repository subpath.
  console.log("Browser checks: installing nested route");
  await page.route("**/nested/**", async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace("/nested/", "/"),
    });
    await route.fulfill({ response });
  });
  console.log("Browser checks: nested route installed");
  console.log("Browser checks: navigating nested mount");
  await page.goto("http://127.0.0.1:4173/nested/", { waitUntil: "domcontentloaded" });
  console.log("Browser checks: nested navigation", await page.locator(".tour-dialog").evaluate(el => el.open));
  await page.waitForFunction(
    () => window.bombadilSandbox?.getState().entries.length === 1,
  );
  assert.equal((await state()).error, "");
  assert.deepEqual(external, [], "No external runtime requests");
  assert.deepEqual(errors, [], "No uncaught page errors");
  // Editable application rules must reach the DOM unchanged, including bugs.
  const applyModule = async (source) => {
    await page.locator("#app-source .cm-content").fill(source);
    await page.locator("#apply-behaviors").click();
    await idle();
    assert.equal((await state()).error, "");
  };
  await page.locator("#example-choice").selectOption("count");
  await idle();
  await applyModule(
    fixedCode.replace(
      "return todos.filter(todo => !todo.completed).length;",
      "return 99;",
    ),
  );
  assert.equal(
    await page.locator("#recorded-app .todo-count strong").textContent(),
    "99",
  );
  assert.equal((await state()).entries[0].observation.remaining, 99);
  assert.equal((await state()).entries[0].results.count.status, "violation");
  assert.match(
    await page.locator("#result").textContent(),
    /footer should show “1 left”, but it shows “99 left”/,
  );
  await applyModule(fixedCode);
  await page.locator("#example-choice").selectOption("filters");
  await idle();
  await applyModule(fixedCode.replace('filter === "all" ||', "true ||"));
  await page.locator('#recorded-app [data-filter="active"]').click();
  await idle();
  assert.equal(
    (await state()).entries.at(-1).results.filters.status,
    "violation",
  );
  assert.equal(await page.locator("#recorded-app li:not([hidden])").count(), 2);
  await scrub(0);
  await page.locator("#back-live").click();
  assert.equal(
    await page.locator("#recorded-app li:not([hidden])").count(),
    2,
    "Historical rendering must not repair broken visibility rules",
  );
  await applyModule(fixedCode);
  assert.equal(
    (await state()).entries.at(-1).results.filters.status,
    "pending",
  );
  await applyModule(fixedCode.replace("filter = value;", 'filter = "all";'));
  assert.equal(
    (await state()).entries.at(-1).results.filters.status,
    "violation",
  );
  assert.match(
    await page.locator("#result").textContent(),
    /You selected “Active”, but “All” is active/,
  );
  await applyModule(fixedCode);
  await applyModule(
    fixedCode.replace(
      "visibleIds: visibleTodos().map(todo => todo.id)",
      "visibleIds: []",
    ),
  );
  assert.equal(
    (await state()).entries[0].results.filters.status,
    "violation",
    "Hiding every todo must not vacuously pass the filter test",
  );
  await applyModule(
    fixedCode.replace("Plant something green", "My editable initial todo"),
  );
  assert.equal(
    (await state()).entries[0].observation.todos[0].text,
    "My editable initial todo",
  );
  await page.locator('#recorded-app li[data-id="1"] input').click();
  await idle();
  await page.locator("#reload-app").click();
  await idle();
  assert.equal(
    (await state()).entries.at(-1).observation.todos[0].completed,
    true,
  );
  assert.equal(
    (await state()).entries.at(-1).observation.todos[0].text,
    "My editable initial todo",
  );
  assert.equal(
    (await state()).entries.at(-1).observation.filter,
    "all",
    "Reload initializes filter state through createApp, not a hidden override",
  );
  await page.locator("#reset-app").click();
  await idle();
  assert.equal(
    (await state()).entries[0].observation.todos[0].completed,
    false,
  );
  assert.equal(
    (await state()).entries[0].observation.todos[0].text,
    "My editable initial todo",
  );
  assert.deepEqual(errors, [], "No uncaught errors from edited app modules");
  // The same worker-backed behavior module powers the standalone application.
  const standalone = await browser.newPage();
  await standalone.goto("http://127.0.0.1:4173/todomvc.html?fixed");
  await standalone.locator(".new-todo").waitFor();
  const custom = fixedCode
    .replace(
      "{ id, text, completed: false }",
      "{ id, text: text.toUpperCase(), completed: false }",
    )
    .replace(
      "todos = todos.filter(todo => todo.id !== id);",
      'todos = todos.map(todo => todo.id === id ? { ...todo, text: "Deleted" } : todo);',
    )
    .replace("filter = value;", 'filter = "completed";');
  await standalone.evaluate(
    ({ todos, code }) =>
      new Promise((resolve, reject) => {
        const ready = (event) => {
          if (
            event.source !== window ||
            event.data.id !== 22 ||
            !("result" in event.data || "error" in event.data)
          )
            return;
          window.removeEventListener("message", ready);
          if (event.data.error) reject(Error(event.data.error));
          else resolve(event.data.result);
        };
        window.addEventListener("message", ready);
        window.postMessage(
          { id: 22, kind: "init", saved: todos, code, manual: true },
          "*",
        );
      }),
    { todos: initialTodos, code: custom },
  );
  await standalone.locator(".new-todo").fill("custom behavior");
  await standalone.locator(".new-todo").press("Enter");
  await standalone.getByText("CUSTOM BEHAVIOR", { exact: true }).waitFor();
  await standalone.locator('li[data-id="1"] .delete').click();
  await standalone.getByText("Deleted", { exact: true }).waitFor();
  await standalone.locator('[data-filter="active"]').click();
  await standalone.waitForFunction(
    () =>
      document
        .querySelector('[data-filter="completed"]')
        .getAttribute("aria-pressed") === "true",
  );
  assert.equal(await standalone.locator("li:not([hidden])").count(), 1);
  await standalone.close();
  // The preview should use spare height instead of capping the list at 180px.
  await page.reload();
  await idle();
  await page.setViewportSize({ width: 1440, height: 720 });
  for (let i = 1; i <= 4; i++) {
    await todoInput.fill(`Space check ${i}`);
    await todoInput.press("Enter");
    await idle();
  }
  const fullList = page.locator("#recorded-app .todo-list");
  assert.equal(
    await fullList.evaluate((el) => el.scrollHeight <= el.clientHeight),
    true,
    "Six todos fit without list scrolling when the preview has room",
  );
  await page.screenshot({ path: "test-results/full-height-output.png" });
  for (const height of [520, 720]) {
    await page.setViewportSize({ width: 1440, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      true,
      "Short desktop windows do not require page scrolling",
    );
    const pinned = await page.evaluate(() =>
      [".output-controls", ".timeline", "#recorded-app"].every((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight + 1;
      }),
    );
    assert.equal(
      pinned,
      true,
      "Preview controls and timeline stay within the viewport",
    );
  }
  // Every lesson demonstrates a specific DOM-observed failure, then passes the
  // identical concrete steps after applying the repaired application module.
  await page.reload();
  console.log("Browser checks: testing all six lessons");
  await idle();
  await page.setViewportSize({ width: 1440, height: 1100 });
  const picker = page.getByRole("combobox", { name: "Example", exact: true });
  assert.equal(await picker.isEnabled(), true);
  const pickerBounds = await picker.boundingBox();
  assert.ok(pickerBounds.x > 1100 && pickerBounds.y < 48);
  const explanations = {
    persistence: /after reload/,
    count: /footer should show “1 left”, but it shows “0 left”/,
    filters: /showing 1 unfinished todo and hiding 2 completed todos/,
    noBlank: /app added a blank todo/,
    filterPreservesCount: /Selecting “Completed” created a new unfinished todo/,
    addingPreservesFilter: /filter from “Completed” to “All”/,
  };
  const failureSteps = {
    persistence: 3,
    count: 4,
    filters: 5,
    noBlank: 6,
    filterPreservesCount: 5,
    addingPreservesFilter: 7,
  };
  for (const [name, example] of Object.entries(examples)) {
    if (name !== "persistence") await picker.selectOption(name);
    await idle();
    const initial = await state();
    assert.equal(initial.example, name);
    assert.equal(initial.selectedTest, example.property);
    assert.equal(await page.getByRole("combobox").count(), 1);
    assert.equal(initial.playing, false);
    assert.equal(
      initial.entries.length,
      1,
      "Selection records only the initial state",
    );
    assert.equal(initial.selected, 0);
    assert.equal(await page.locator("#new-run").isEnabled(), true);
    assert.equal(await page.locator("#run").isDisabled(), true);
    await page.waitForTimeout(350);
    assert.equal(
      (await state()).entries.length,
      1,
      "Selection must not autoplay later",
    );
    await page.locator("#new-run").click();
    await idle();
    const broken = await state();
    assert.equal(broken.example, name);
    assert.equal(broken.selectedTest, example.property);
    assert.equal(broken.code, example.code);
    assert.equal(broken.error, "");
    assert.equal(broken.entries[0].results[example.property].status, "pending");
    assert.equal(
      broken.entries.at(-1).results[example.property].status,
      "violation",
      name,
    );
    assert.ok(
      broken.entries.length >= 4 && broken.entries.length <= 8,
      `${name}: Continue should find the first failure between steps 3 and 7`,
    );
    assert.equal(broken.entries.at(-1).index, failureSteps[name], name);
    const recordedActions = broken.entries
      .slice(1)
      .map((entry) => entry.action);
    if (name === "noBlank") {
      assert.deepEqual(recordedActions.at(-1), { type: "add", text: "   " });
    }
    if (name === "addingPreservesFilter") {
      assert.equal(recordedActions.at(-1).type, "add");
    }
    if (name !== "persistence")
      assert.deepEqual(
        recordedActions,
        example.actions,
        "Guided steps match the checked default run",
      );
    assert.match(
      await page.locator(".failure-cause").textContent(),
      explanations[name],
    );
    const report = page.locator(".bombadil-report");
    assert.equal(await report.evaluate((el) => el.open), false);
    assert.ok(broken.entries.at(-1).results[example.property].report);
    await report.locator("summary").click();
    assert.equal(
      await report.locator(".bombadil-report-body").isVisible(),
      true,
    );
    assert.match(
      await report.textContent(),
      /it should always be the case that/,
    );
    if (name === "filterPreservesCount") {
      assert.match(
        await report.textContent(),
        /failing the implication because/,
      );
      const originalDraft = broken.draftCode;
      await page
        .locator("#app-source .cm-content")
        .fill(originalDraft + "\n// Inspecting the failure");
      assert.equal(await report.evaluate((el) => el.open), true);
      await page.locator("#app-source .cm-content").fill(originalDraft);
      await page.screenshot({
        path: "test-results/bombadil-report-desktop.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".output-pane").scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.locator(".output-pane").screenshot({
        path: "test-results/bombadil-report-mobile.png",
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    await report.locator("summary").click();
    if (name === "filterPreservesCount")
      await page
        .locator(".output-footer")
        .screenshot({ path: "test-results/filter-failure-summary.png" });
    if (name === "count")
      await page.screenshot({
        path: "test-results/example-desktop.png",
        fullPage: true,
      });
    if (name === "addingPreservesFilter") {
      const controls = await page.locator(".output-controls").boundingBox();
      const timeline = await page.locator(".timeline").boundingBox();
      await page.screenshot({
        path: "test-results/simplified-output.png",
        clip: {
          x: controls.x,
          y: controls.y,
          width: controls.width,
          height: timeline.y + timeline.height - controls.y,
        },
      });
    }
    await savedToggle();
    await idle();
    const repaired = await state();
    assert.equal(repaired.error, "");
    assert.deepEqual(
      repaired.entries.slice(1).map((entry) => entry.action),
      recordedActions,
    );
    assert.equal(
      repaired.entries.at(-1).results[example.property].status,
      "pending",
      name,
    );
    assert.equal(await page.locator("#new-run").isEnabled(), true);
    if (name === "noBlank") {
      // A repaired example should finish a short check, rather than exploring
      // 100 steps. Further clicks append another burst to the same history.
      await page.locator("#reset-app").click();
      await idle();
      await page.locator("#new-run").click();
      await idle();
      const firstBurst = await state();
      assert.equal(firstBurst.entries.length, 8);
      assert.equal(firstBurst.entries.at(-1).results.noBlank.status, "pending");
      assert.equal(firstBurst.playing, false);
      assert.equal(firstBurst.error, "");
      await page.locator("#new-run").click();
      await idle();
      const secondBurst = await state();
      assert.equal(secondBurst.entries.length, 15);
      assert.deepEqual(secondBurst.entries.slice(0, 8), firstBurst.entries);
      assert.equal(
        secondBurst.entries.at(-1).results.noBlank.status,
        "pending",
      );
      // Rechecking a saved history must explain the original failure even if
      // a later step removed the blank todo and the selected state is clean.
      await page.locator("#reset-app").click();
      await idle();
      await page
        .locator("#property-source .cm-content")
        .fill("always(() => true)");
      await idle();
      await page.locator("#app-source .cm-content").fill(example.code);
      await page.locator("#apply-behaviors").click();
      await idle();
      await todoInput.fill("   ");
      await todoInput.press("Enter");
      await idle();
      const blankId = (await state()).entries
        .at(-1)
        .observation.todos.at(-1).id;
      await page
        .locator(`#recorded-app li[data-id="${blankId}"] .delete`)
        .click();
      await idle();
      await page
        .locator("#property-source .cm-content")
        .fill(properties.noBlank.source);
      await idle();
      assert.equal((await state()).selected, 2);
      assert.match(
        await page.locator(".failure-cause").textContent(),
        /At step 1, the app added a blank todo/,
      );
      assert.equal(
        await page.locator("#recorded-app [data-changed]").count(),
        0,
      );
      await page.locator("#reset-app").click();
      await idle();
      await savedToggle();
      await idle();
    }
  }
  // Applied code, unsaved drafts, and pending test edits belong to their lesson.
  await picker.selectOption("count");
  await idle();
  const personalDraft = fixedCode + "\n// My count notes";
  const personalTest = "always(() => remaining.current >= 0)";
  await page.locator("#app-source .cm-content").fill(personalDraft);
  await page.locator("#property-source .cm-content").fill(personalTest);
  await picker.selectOption("filters");
  await idle();
  assert.equal((await state()).selectedTest, "filters");
  assert.notEqual((await state()).sources.filters, personalTest);
  await picker.selectOption("count");
  await idle();
  assert.equal((await state()).code, fixedCode);
  assert.equal((await state()).draftCode, personalDraft);
  assert.equal((await state()).pendingBehaviors, true);
  assert.equal((await state()).sources.count, personalTest);
  // Changing lessons while a sequence runs must cancel its outstanding work.
  await picker.selectOption("persistence");
  await idle();
  await page.evaluate(() => {
    void window.bombadilSandbox.runGuided();
  });
  await page.waitForFunction(
    () => window.bombadilSandbox.getState().playing,
  );
  await picker.selectOption("addingPreservesFilter");
  await idle();
  await page.waitForTimeout(600);
  const switched = await state();
  assert.equal(switched.example, "addingPreservesFilter");
  assert.equal(switched.error, "");
  assert.equal(switched.playing, false);
  assert.equal(
    switched.entries.length,
    1,
    "Switching cancels the old run and leaves the new example idle",
  );
  assert.equal(switched.entries[0].action, null);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await picker.isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "test-results/example-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: guided defect, captured state, scrub, fix/replay, live edits, syntax errors, runaway app/property code, reset cancellation, single-control replay, WebMCP mock contract, six lesson failures and fixes, per-example edits, switching during execution, mobile layout, local-only requests.",
  );
} catch (error) {
  console.log("State:", await state());
  console.log("Result:", await page.locator("#result").textContent());
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
