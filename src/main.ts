import { FrameRPC, applicationDocument, evaluatorDocument } from "./frames";
import { CodeEditor, installSplitters } from "./editor";
import { installTour } from "./tour";
import { todoMarkup, todoStyles, previewStyles } from "./presentation";
import { failureDetail, renderBombadilReport } from "./diagnostics";
import { examples, type ExampleName } from "./examples";
import {
  defaultSources,
  stepLabel,
  random,
  chooseAction,
  type Action,
  type Entry,
  type Observation,
  type PropertyName,
} from "./model";

const root = document.getElementById("app")!;
root.innerHTML = `
<div class="workspace">
  <section class="pane behaviors-pane" aria-labelledby="app-title">
    <header class="pane-heading"><h2 id="app-title">App</h2><button id="apply-behaviors" class="control-button" title="Apply the edited app code and replay the recorded steps from the initial todos. Until then, the preview uses the last applied code." hidden disabled>Apply changes</button></header>
    <div id="app-source" class="code-editor"></div>
  </section>
  <div class="splitter" role="separator" aria-label="Resize App and Tests" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div>
  <section class="pane tests-pane" aria-labelledby="tests-title">
    <header class="pane-heading"><h2 id="tests-title">Tests</h2></header>
    <div id="property-source" class="code-editor"></div>
  </section>
  <div class="splitter" role="separator" aria-label="Resize Tests and preview" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" tabindex="0"></div>
  <section class="pane output-pane" aria-label="App preview">
    <div id="output-status" class="output-status" hidden><span id="output-mode" hidden></span><button id="back-live" class="quiet" hidden>Back to latest</button></div>
    <div class="app-stage">
      <button id="reload-app" class="reload-button" aria-label="Reload app" title="Reload the app using saved todos and record the step. Unsaved changes may disappear." disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 3v6h-6"/><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 9"/></svg>
      </button>
      <div id="live-app" hidden></div><div id="recorded-app" aria-label="App state"></div>
    </div>
    <div class="output-footer">
      <div class="output-controls" role="group" aria-label="Output controls">
        <button id="reset-app" class="quiet" title="Restore the initial todos and clear saved data and recorded steps. Keep your code and test edits." disabled>Start over</button><button id="run" class="quiet" disabled>Replay</button><button id="new-run" class="control-button primary" title="Continue from the latest app state with up to seven random steps. Keep the existing timeline and check the selected test after each step." disabled>Continue</button>
      </div>
      <div id="timeline" class="timeline">
        <div id="timeline-scrub" class="timeline-scrub" hidden><input id="scrubber" class="scrubber" type="range" min="0" max="0" value="0" aria-label="Scrub through recorded states"><output id="position" for="scrubber">Start</output></div>
        <div id="result" role="status">Loading…</div>
      </div>
    </div>
  </section>
</div>
<span id="editor-keyboard-help" class="sr-only">Tab indents code. Press Escape then Tab to move focus out of the editor.</span>
`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
$<HTMLSelectElement>("example-choice").innerHTML = Object.entries(examples)
  .map(([key, example]) => `<option value="${key}">${example.title}</option>`)
  .join("");
const propertyInput = new CodeEditor($("property-source"), "Test expression"),
  codeInput = new CodeEditor($("app-source"), "App code");
installSplitters(document.querySelector<HTMLElement>(".workspace")!);
const tour = installTour($<HTMLButtonElement>("start-tour"));
const preview = $("recorded-app").attachShadow({ mode: "open" });
preview.innerHTML = `<style>${todoStyles}${previewStyles}</style><section id="todoapp"></section>`;
const previewRoot = preview.querySelector<HTMLElement>("#todoapp")!;
let renderedPreview = "",
  draftTodo = "",
  renderedFailure = "";
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let app: FrameRPC,
  evaluator: FrameRPC,
  workerSource: string,
  wasmBytes: ArrayBuffer;
let saved: unknown = null;
let selectedExample: ExampleName = "persistence";
const exampleEdits = new Map<
  ExampleName,
  {
    code: string;
    draftCode: string;
    sources: ReturnType<typeof defaultSources>;
  }
>();
let sources = defaultSources(),
  code = examples[selectedExample].code,
  draftCode = code;
let entries: Entry[] = [],
  selected = 0,
  property: PropertyName = "persistence",
  generation = 0,
  execution = 0,
  revision = 0;
let playing = false,
  busy = false,
  updating = false,
  loaded = false,
  manual = false,
  error = "",
  stale = false;
let currentStep: Promise<void> = Promise.resolve();
let startTime = 0;
let runSeed = examples[selectedExample].seed,
  rng = random(runSeed);
let editTimer: ReturnType<typeof setTimeout>;
let recoveryActions: Action[] | null = null;
const weights = { create: 3, interact: 5, reload: 2 };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function failure(entry = entries.at(-1)) {
  return entry?.results[property]?.status === "violation";
}
const activeSources = () => ({ [property]: sources[property] });
function syncEditor() {
  $<HTMLSelectElement>("example-choice").value = selectedExample;
  propertyInput.value = sources[property];
  codeInput.value = draftCode;
}
function showError(reason: unknown) {
  if (reason instanceof Error && reason.message === "Run cancelled") return;
  error = reason instanceof Error ? reason.message : String(reason);
  playing = false;
  busy = false;
  update();
}
function canInteract() {
  return (
    loaded &&
    !!entries.length &&
    selected === entries.length - 1 &&
    !playing &&
    !busy &&
    !updating &&
    !stale &&
    !error &&
    !failure()
  );
}
function update() {
  $<HTMLButtonElement>("start-tour").disabled =
    !loaded || playing || busy || updating;
  $<HTMLSelectElement>("example-choice").disabled = !loaded;
  const entry = entries[selected];
  const applyButton = $<HTMLButtonElement>("apply-behaviors");
  applyButton.hidden = draftCode === code;
  applyButton.disabled =
    !loaded || busy || updating || playing || draftCode === code;
  const runButton = $<HTMLButtonElement>("run");
  const canReplay = entries.length > 1 || !!recoveryActions?.length;
  runButton.textContent = playing ? "Stop" : "Replay";
  runButton.disabled =
    !loaded || updating || stale || (!playing && (busy || !canReplay));
  runButton.title = playing
    ? "Stop after the current step. Keep the recorded steps for Replay or Continue."
    : "Restore the initial todos and replay the recorded steps with the applied app code.";
  const continueButton = $<HTMLButtonElement>("new-run");
  continueButton.disabled = !canInteract();
  continueButton.title =
    selected < entries.length - 1
      ? "Use Back to latest before continuing with random steps. Earlier states are read-only."
      : failure() || error
        ? "Fix the test or apply corrected app code, or use Start over before continuing."
        : "Continue from the latest app state with up to seven random steps. Keep the existing timeline and check the selected test after each step.";
  // A rechecked test can fail earlier in an already-recorded timeline. Explain
  // the first failing state, matching Bombadil's retained violation report.
  const failedEntry =
    entry?.results[property]?.status === "violation"
      ? (entries
          .slice(0, selected + 1)
          .find(
            (candidate) => candidate.results[property]?.status === "violation",
          ) ?? entry)
      : entry;
  const detail =
    entry &&
    !error &&
    !stale &&
    !updating &&
    entry.results[property]?.status === "violation"
      ? failureDetail(
          failedEntry!,
          entries[(failedEntry?.index ?? selected) - 1],
          property,
          sources[property],
        )
      : null;
  const previewMarkup = entry
    ? todoMarkup(
        {
          ...entry.observation,
          visibleIds: entry.observation.visible.map((todo) => todo.id),
        },
        failedEntry === entry ? detail?.ids : undefined,
      )
    : "";
  // Preserve an unfinished input and its focus across status-only updates.
  const previewKey = `${generation}/${selected}/${previewMarkup}`;
  if (previewKey !== renderedPreview) {
    previewRoot.innerHTML = previewMarkup;
    renderedPreview = previewKey;
    const input = previewRoot.querySelector<HTMLInputElement>(".new-todo");
    if (input && selected === entries.length - 1) input.value = draftTodo;
  }
  // Freeze edits, not inspection: inert would also block scrolling the list.
  const readOnly = !canInteract();
  previewRoot
    .querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
    .forEach((control) => {
      control.disabled = readOnly;
    });
  const historical = selected < entries.length - 1;
  $("output-mode").textContent = historical
    ? "Earlier state · read-only"
    : playing
      ? "Running…"
      : "";
  $("output-mode").hidden = !$("output-mode").textContent;
  $("output-status").hidden = !$("output-mode").textContent && !historical;
  $<HTMLButtonElement>("back-live").hidden = !historical;
  $<HTMLButtonElement>("back-live").disabled = playing || busy || updating;
  $<HTMLButtonElement>("reload-app").disabled = !canInteract();
  $<HTMLButtonElement>("reset-app").disabled = !loaded;
  const scrubber = $<HTMLInputElement>("scrubber");
  scrubber.max = String(Math.max(0, entries.length - 1));
  scrubber.value = String(selected);
  scrubber.disabled = entries.length < 2 || playing || busy || updating;
  scrubber.setAttribute(
    "aria-valuetext",
    entry
      ? `State ${selected}: ${stepLabel(entry, entries[selected - 1])}`
      : "No recorded states",
  );
  $("timeline-scrub").hidden = entries.length < 2;
  $("position").textContent = selected ? `Step ${selected}` : "Start";
  const stepDescription = entry
    ? `${selected} of ${entries.length - 1}: ${stepLabel(entry, entries[selected - 1])}`
    : "Initial state";
  $("position").title = scrubber.title = stepDescription;
  const result = $("result");
  const failureKey = `${generation}/${selected}/${revision}`;
  const reportOpen =
    renderedFailure === failureKey &&
    result.querySelector<HTMLDetailsElement>("details")?.open;
  result.className = "";
  if (error) {
    result.className = "error";
    result.textContent = `${stale ? "Previous results are out of date. " : ""}${error}`;
  } else if (!loaded || (busy && !entries.length)) {
    result.textContent = "Loading…";
  } else if (updating || stale) {
    result.textContent = "Checking test…";
  } else if (entry) {
    const verdict = entry.results[property];
    if (verdict?.status === "violation") {
      result.className = "failure";
      const failedStep = failedEntry?.index ?? selected;
      const fallback =
        failedStep === 0
          ? "The test failed in the initial state."
          : `The test failed at step ${failedStep}.`;
      const description = detail?.message ?? fallback;
      const message =
        failedStep !== selected && description !== fallback
          ? `${failedStep === 0 ? "In the initial state" : `At step ${failedStep}`}, ${description[0].toLowerCase()}${description.slice(1)}`
          : description;
      result.innerHTML = `<div class="failure-cause">${message === fallback ? "" : '<span class="sr-only">Test failed. </span>'}${escape(message)}</div>${verdict.report ? `<details class="bombadil-report" ${reportOpen ? "open" : ""}><summary>Bombadil report</summary><div class="bombadil-report-body" tabindex="0" aria-label="Bombadil violation report">${renderBombadilReport(verdict.report)}</div></details>` : ""}`;
    } else {
      result.textContent =
        verdict?.status === "satisfied"
          ? "Test passed"
          : property === "ready"
            ? "Test pending"
            : "No failure so far";
    }
  }
  result.hidden =
    entries.length < 2 && result.textContent === "No failure so far";
  $("timeline").hidden = $("timeline-scrub").hidden && result.hidden;
  renderedFailure = failureKey;
}
async function newEvaluator(testSources = activeSources()) {
  evaluator?.dispose();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Isolated test evaluator";
  document.body.append(frame);
  const instance = new FrameRPC(frame, evaluatorDocument());
  evaluator = instance;
  await instance.call("boot", { source: workerSource, bytes: wasmBytes });
  await instance.call("init", { sources: testSources });
}
async function newApp(lastAction: Action | null = null): Promise<Observation> {
  app?.dispose();
  const frame = document.createElement("iframe");
  frame.title = "TodoMVC application";
  $("live-app").append(frame);
  app = new FrameRPC(frame, applicationDocument(), (message) => {
    if (message.event === "storage") saved = message.value;
    if (message.event === "manual-error") showError(message.error);
    if (message.event === "resize" && Number.isFinite(message.height))
      frame.style.height = `${Math.min(500, Math.max(285, message.height))}px`;
  });
  return app.call("init", { saved, code, lastAction, manual });
}
async function reset(kind: "guided" | "explore" | "replay" = "explore") {
  const token = ++generation;
  playing = false;
  busy = true;
  error = "";
  stale = false;
  updating = false;
  manual = false;
  rng = random(runSeed);
  recoveryActions = null;
  entries = [];
  selected = 0;
  saved = null;
  draftTodo = "";
  update();
  await newEvaluator();
  if (token !== generation) return;
  startTime = performance.now();
  const observation = await newApp();
  if (token !== generation) return;
  const time = Math.round(performance.now() - startTime);
  const results = await evaluator.call("step", { observation, time });
  if (token !== generation) return;
  entries = [{ index: 0, action: null, observation, time, results }];
  busy = false;
  update();
  return token;
}
async function perform(action: Action) {
  const token = generation;
  busy = true;
  update();
  try {
    const observation: Observation =
      action.type === "reload"
        ? await newApp(action)
        : await app.call("action", { action });
    if (token !== generation) return;
    const time = Math.max(
      (entries.at(-1)?.time ?? 0) + 1,
      Math.round(performance.now() - startTime),
    );
    const results = await evaluator.call("step", { observation, time });
    if (token !== generation) return;
    entries.push({ index: entries.length, action, observation, time, results });
    selected = entries.length - 1;
    if (failure()) playing = false;
  } catch (reason) {
    if (token === generation) showError(reason);
  } finally {
    if (token === generation) {
      busy = false;
      update();
    }
  }
}
async function execute(action: Action) {
  currentStep = perform(action);
  await currentStep;
}
async function run(
  kind: "guided" | "explore" | "replay",
  actions?: Action[],
  continueCurrent = false,
) {
  if (continueCurrent && !canInteract()) return;
  const executionToken = ++execution;
  const sequence = actions ?? examples[selectedExample].actions;
  let token = generation;
  if (!continueCurrent) {
    await currentStep;
    if (executionToken !== execution) return;
    let resetToken;
    try {
      resetToken = await reset(kind);
    } catch (reason) {
      if (executionToken === execution && kind !== "explore")
        recoveryActions = sequence.slice();
      throw reason;
    }
    if (resetToken === undefined) return;
    token = resetToken;
  }
  if (
    error ||
    failure() ||
    token !== generation ||
    executionToken !== execution
  ) {
    if (failure() && token === generation && kind === "replay")
      recoveryActions = sequence.slice();
    return;
  }
  playing = true;
  // Continuing keeps the app, saved todos, evaluator, timestamps and RNG intact.
  // Each burst gets its own time limit, independent of time spent editing manually.
  const runStarted = performance.now();
  update();
  for (
    let i = 0;
    i < (kind === "explore" ? 7 : sequence.length) &&
    playing &&
    token === generation &&
    executionToken === execution;
    i++
  ) {
    const action =
      kind === "explore"
        ? chooseAction(entries.at(-1)!.observation, rng, weights)
        : sequence[i];
    await execute(action);
    if (error && token === generation)
      recoveryActions =
        kind === "explore"
          ? [...entries.slice(1).map((e) => e.action!), action]
          : sequence.slice();
    if (error || failure()) break;
    await delay(250);
    if (performance.now() - runStarted > 60000) break;
  }
  if (token === generation && executionToken === execution) {
    playing = false;
    update();
  }
}
function launch(fn: () => Promise<unknown>) {
  fn().catch(showError);
}
async function reevaluate(myRevision: number) {
  playing = false;
  await currentStep;
  if (myRevision !== revision) return;
  updating = true;
  update();
  try {
    const testSources = activeSources();
    await newEvaluator(testSources);
    if (myRevision !== revision) return;
    const results = await evaluator.call(
      "reevaluate",
      { sources: testSources, entries },
      5000,
    );
    if (myRevision !== revision) return;
    entries = entries.map((e, i) => ({ ...e, results: results[i] }));
    error = "";
    stale = false;
  } catch (reason) {
    if (myRevision === revision) {
      stale = true;
      showError(reason);
    }
  } finally {
    if (myRevision === revision) {
      updating = false;
      update();
    }
  }
}
async function replayEdit(myRevision: number) {
  playing = false;
  await currentStep;
  if (myRevision !== revision) return;
  const sequence = recoveryActions ?? entries.slice(1).map((e) => e.action!);
  stale = false;
  await run("replay", sequence);
}
async function applyBehaviors() {
  if (!loaded || busy || updating || playing || draftCode === code) return;
  clearTimeout(editTimer);
  code = draftCode;
  await replayEdit(++revision);
}
function pause() {
  execution++;
  playing = false;
  update();
}
function restart() {
  clearTimeout(editTimer);
  execution++;
  revision++;
  generation++;
  playing = false;
  app?.dispose();
  evaluator?.dispose();
  currentStep = Promise.resolve();
  return reset();
}
async function selectExample(name: ExampleName) {
  if (!Object.hasOwn(examples, name)) throw Error("Unknown example");
  if (!loaded || name === selectedExample) return;
  exampleEdits.set(selectedExample, {
    code,
    draftCode,
    sources: { ...sources },
  });
  // Invalidate steps and debounced edits before changing either editor. The
  // picker remains available during execution so a new lesson can cancel it.
  clearTimeout(editTimer);
  revision++;
  execution++;
  generation++;
  playing = false;
  app?.dispose();
  evaluator?.dispose();
  currentStep = Promise.resolve();
  selectedExample = name;
  const edits = exampleEdits.get(name);
  code = edits?.code ?? examples[name].code;
  draftCode = edits?.draftCode ?? code;
  sources = edits ? { ...edits.sources } : defaultSources();
  property = examples[name].property;
  runSeed = examples[name].seed;
  Object.assign(weights, { create: 3, interact: 5, reload: 2 });
  syncEditor();
  await reset();
}
function replay() {
  const sequence = recoveryActions ?? entries.slice(1).map((e) => e.action!);
  return run("replay", sequence);
}
async function manualAction(action: Action) {
  if (!canInteract()) return;
  const token = generation;
  const recovery = entries
    .slice(1)
    .map((e) => e.action!)
    .concat(action);
  if (action.type === "add") draftTodo = "";
  await execute(action);
  if (token !== generation) return;
  if (error) recoveryActions = recovery;
  // Also undo native checkbox changes if the edited handler failed.
  renderedPreview = "";
  update();
  if (
    canInteract() &&
    (document.activeElement === document.body ||
      document.activeElement === $("recorded-app"))
  ) {
    const selector =
      action.type === "toggle"
        ? `li[data-id="${action.id}"] input`
        : action.type === "filter"
          ? `[data-filter="${action.filter}"]`
          : ".new-todo";
    previewRoot
      .querySelector<HTMLElement>(selector)
      ?.focus({ preventScroll: true });
  }
}
preview.addEventListener("input", (e) => {
  if ((e.target as HTMLElement).matches(".new-todo"))
    draftTodo = (e.target as HTMLInputElement).value;
});
preview.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = previewRoot.querySelector<HTMLInputElement>(".new-todo")?.value;
  if (text !== undefined) launch(() => manualAction({ type: "add", text }));
});
preview.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const row = input.closest<HTMLElement>("li[data-id]");
  if (row && input.matches('input[type="checkbox"]'))
    launch(() => manualAction({ type: "toggle", id: Number(row.dataset.id) }));
});
preview.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.matches(".delete"))
    launch(() =>
      manualAction({
        type: "delete",
        id: Number(button.closest<HTMLElement>("li")!.dataset.id),
      }),
    );
  else if (button.dataset.filter)
    launch(() =>
      manualAction({
        type: "filter",
        filter: button.dataset.filter as "all" | "active" | "completed",
      }),
    );
});
$("reload-app").onclick = () => launch(() => manualAction({ type: "reload" }));
$("reset-app").onclick = () => launch(restart);
$("back-live").onclick = () => {
  selected = entries.length - 1;
  renderedPreview = "";
  update();
};
$("run").onclick = () => {
  if (playing) pause();
  else launch(replay);
};
$("new-run").onclick = () => launch(() => run("explore", undefined, true));
function scheduleTestCheck(delayMs: number) {
  execution++;
  playing = false;
  stale = true;
  error = "";
  revision++;
  const rev = revision;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => launch(() => reevaluate(rev)), delayMs);
  update();
}
propertyInput.oninput = () => {
  sources[property] = propertyInput.value;
  scheduleTestCheck(450);
};
codeInput.oninput = () => {
  draftCode = codeInput.value;
  update();
};
$("apply-behaviors").onclick = () => launch(applyBehaviors);
$<HTMLSelectElement>("example-choice").onchange = (e) =>
  launch(() =>
    selectExample((e.target as HTMLSelectElement).value as ExampleName),
  );
$<HTMLInputElement>("scrubber").oninput = (e) => {
  selected = Number((e.target as HTMLInputElement).value);
  update();
};
function download(name: string, contents: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const exportTrace = () =>
  download(
    "bombadil-sandbox-trace.json",
    JSON.stringify(
      {
        format: "bombadil-sandbox/1",
        engineCommit: "b8bc4a658abc5933c84d1afb9fff1ce24e05520f",
        seed: runSeed,
        viewport: { width: innerWidth, height: innerHeight },
        initialTodos: entries[0]?.observation.todos ?? [],
        code,
        sources,
        selectedTest: property,
        example: selectedExample,
        entries,
      },
      null,
      2,
    ),
  );
const exportSpec = () =>
  download(
    "specification.ts",
    `// Use with the supplied TodoMVC example. Playground trace files use a separate format.\nimport { always, now, next, eventually, not } from '@antithesishq/bombadil';\nimport { extract } from '@antithesishq/bombadil/browser';\nexport * from '@antithesishq/bombadil/browser/defaults';\nconst todos = extract(({document}) => [...document.querySelectorAll('li[data-id]')].map(row => ({id:Number((row as HTMLElement).dataset.id),text:row.querySelector('.todo-text')!.textContent!,completed:row.querySelector<HTMLInputElement>('input')!.checked})));\nconst visible = extract(({document}) => [...document.querySelectorAll<HTMLLIElement>('li[data-id]')].filter(row => !row.hidden).map(row => ({id:Number(row.dataset.id),text:row.querySelector('.todo-text')!.textContent!,completed:row.querySelector<HTMLInputElement>('input')!.checked})));\nconst remaining = extract(({document}) => Number(document.querySelector('.todo-count strong')?.textContent ?? 0));\nconst filter = extract(({document}) => document.querySelector<HTMLElement>('[data-filter][aria-pressed=true]')?.dataset.filter ?? 'all');\nconst ready = extract(({document}) => !!document.querySelector('.new-todo'));\nconst lastAction = extract(state => state.lastAction === 'Reload' ? {type:'reload'} : null);\n${Object.entries(
      activeSources(),
    )
      .map(([name, source]) => `export const ${name} = ${source};`)
      .join("\n\n")}`,
    "text/plain",
  );
syncEditor();
update();
try {
  const [worker, wasm] = await Promise.all([
    fetch(new URL("./worker.js", import.meta.url)),
    fetch(new URL("./evaluator.wasm", import.meta.url)),
  ]);
  if (!worker.ok || !wasm.ok)
    throw Error(
      "A playground asset could not be loaded. Rebuild and refresh the browser page.",
    );
  [workerSource, wasmBytes] = await Promise.all([
    worker.text(),
    wasm.arrayBuffer(),
  ]);
  loaded = true;
  await reset();
  tour.startOnce();
} catch (reason) {
  showError(reason);
}

// A small public surface for automated playground controls; see README.
export const playground = {
  runGuided: () => run("guided"),
  run: async (
    seed = examples[selectedExample].seed,
    actionWeights = weights,
  ) => {
    runSeed = seed >>> 0;
    Object.assign(weights, actionWeights);
    await run("explore");
  },
  replay,
  pause,
  reset: restart,
  selectExample,
  exportTrace,
  exportSpec,
  getState: () => ({
    playing,
    busy,
    updating,
    stale,
    error,
    entries,
    selected,
    code,
    draftCode,
    pendingBehaviors: draftCode !== code,
    selectedTest: property,
    example: selectedExample,
    sources,
  }),
};
(window as any).bombadilSandbox = playground;

const modelContext = (document as any).modelContext;
if (modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const summary = () => ({
    actions: Math.max(0, entries.length - 1),
    playing,
    error,
    properties: entries.at(-1)?.results ?? {},
  });
  for (const tool of [
    {
      name: "read_playground_state",
      description: "Read the current Bombadil timeline and test results.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: any) => {
        if (!input || Object.keys(input).length)
          throw Error("Expected an empty object");
        return summary();
      },
    },
    {
      name: "run_guided_example",
      description:
        "Restore the initial todos, clear the timeline, and run the selected example's short demonstration using the last applied behaviors and selected test.",
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input: any) => {
        if (!input || Object.keys(input).length)
          throw Error("Expected an empty object");
        if (busy || updating || stale)
          throw Error("Wait for the current edit or step to finish");
        await run("guided");
        return summary();
      },
    },
  ]) {
    try {
      Promise.resolve(
        modelContext.registerTool(
          {
            ...tool,
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. */
    }
  }
}
