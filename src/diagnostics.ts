import {
  properties,
  type BombadilReport,
  type Entry,
  type PropertyName,
} from "./model";

const filterName = (filter: string) =>
  `“${filter[0].toUpperCase()}${filter.slice(1)}”`;
const todoName = (text: string) => (text.trim() ? `“${text}”` : "A blank todo");
const quantity = (count: number, noun = "todo") =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export interface FailureDetail {
  message: string;
  ids: number[];
}

// Only explain built-in formulas whose meaning is known. Edited formulas get
// a neutral result rather than an explanation guessed from their property key.
export function failureDetail(
  entry: Entry,
  previous: Entry | undefined,
  property: PropertyName,
  source: string,
): FailureDetail {
  const fallback = {
    message:
      entry.index === 0
        ? "The test failed in the initial state."
        : `The test failed at step ${entry.index}.`,
    ids: [] as number[],
  };
  if (source !== properties[property].source) return fallback;
  const current = entry.observation;
  if (
    property === "persistence" &&
    previous &&
    entry.action?.type === "reload"
  ) {
    const before = new Map(previous.observation.todos.map((t) => [t.id, t]));
    const after = new Map(current.todos.map((t) => [t.id, t]));
    const ids: number[] = [];
    const changes: string[] = [];
    for (const [id, old] of before) {
      const todo = after.get(id);
      if (!todo) {
        ids.push(id);
        changes.push(
          `${todoName(old.text)} disappeared after reload. It should still be present.`,
        );
        continue;
      }
      if (old.completed !== todo.completed || old.text !== todo.text) {
        ids.push(id);
        if (old.completed !== todo.completed)
          changes.push(
            `${todoName(old.text)} became ${todo.completed ? "completed" : "incomplete"} after reload. It should still be ${old.completed ? "completed" : "incomplete"}.`,
          );
        if (old.text !== todo.text)
          changes.push(
            `Reloading renamed ${todoName(old.text)} to ${todoName(todo.text)}. Todo text should stay the same.`,
          );
      }
    }
    for (const [id, todo] of after)
      if (!before.has(id)) {
        ids.push(id);
        changes.push(
          `Reloading added ${todoName(todo.text)}. The todo list should stay the same.`,
        );
      }
    return {
      message: changes.length
        ? changes.join(" ")
        : "Reloading changed the order of the todos. The order should stay the same.",
      ids,
    };
  }
  if (property === "count") {
    const expected = current.todos.filter((t) => !t.completed).length;
    return {
      message: `The footer should show “${expected} left”, but it shows “${current.remaining} left”. Unfinished todos still count when hidden by a filter.`,
      ids: [],
    };
  }
  if (property === "filters") {
    if (
      entry.action?.type === "filter" &&
      current.filter !== entry.action.filter
    )
      return {
        message: `You selected ${filterName(entry.action.filter)}, but ${filterName(current.filter)} is active. The app should use the filter you selected.`,
        ids: [],
      };
    const expected = current.todos.filter(
      (t) =>
        current.filter === "all" ||
        t.completed === (current.filter === "completed"),
    );
    const missing = expected.filter(
      (t) => !current.visible.some((v) => v.id === t.id),
    );
    const extra = current.visible.filter(
      (t) => !expected.some((v) => v.id === t.id),
    );
    const problems: string[] = [];
    if (extra.length)
      problems.push(
        `showing ${quantity(extra.length, current.filter === "completed" ? "unfinished todo" : "completed todo")}`,
      );
    if (missing.length)
      problems.push(
        `hiding ${quantity(missing.length, current.filter === "completed" ? "completed todo" : current.filter === "active" ? "unfinished todo" : "todo")}`,
      );
    const rule =
      current.filter === "all"
        ? "It should show every todo."
        : `It should show only ${current.filter === "completed" ? "completed" : "unfinished"} todos.`;
    return {
      message: problems.length
        ? `The ${filterName(current.filter)} filter is ${problems.join(" and ")}. ${rule}`
        : `The visible todos do not match the ${filterName(current.filter)} filter. ${rule}`,
      ids: [...missing, ...extra].map((t) => t.id),
    };
  }
  if (property === "ready")
    return {
      message: "The app did not show a todo input within 2 seconds.",
      ids: [],
    };
  if (property === "noBlank") {
    const ids = current.todos
      .filter((todo) => todo.text.trim() === "")
      .map((todo) => todo.id);
    return {
      message:
        entry.action?.type === "add" &&
        ids.length === 1 &&
        previous &&
        !previous.observation.todos.some((todo) => todo.id === ids[0])
          ? "The app added a blank todo. Empty or whitespace-only entries should be ignored."
          : `${ids.length === 1 ? "A todo has" : `${quantity(ids.length)} have`} no text. Every todo must contain text.`,
      ids,
    };
  }
  if (
    property === "filterPreservesCount" &&
    previous &&
    entry.action?.type === "filter"
  ) {
    const added = current.todos.filter(
      (todo) =>
        !previous.observation.todos.some((before) => before.id === todo.id),
    );
    const removed = previous.observation.todos.filter(
      (todo) => !current.todos.some((after) => after.id === todo.id),
    );
    return {
      message: added.length
        ? `Selecting ${filterName(current.filter)} created ${added.length === 1 ? "a new" : added.length} ${added.every((todo) => !todo.completed) ? "unfinished " : ""}todo${added.length === 1 ? "" : "s"}. Filtering should only change which todos are shown.`
        : removed.length
          ? `Selecting ${filterName(current.filter)} removed ${quantity(removed.length)}. Filtering should only change which todos are shown.`
          : `After selecting ${filterName(current.filter)}, the footer should still show “${previous.observation.remaining} left”. It shows “${current.remaining} left”.`,
      ids: added.map((todo) => todo.id),
    };
  }
  if (
    property === "addingPreservesFilter" &&
    previous &&
    entry.action?.type === "add"
  )
    return {
      message: `Adding a todo switched the filter from ${filterName(previous.observation.filter)} to ${filterName(current.filter)}. Adding todos should keep the selected filter.`,
      ids: [],
    };
  return fallback;
}

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

// The wording and grouping come from Bombadil's unchanged markup renderer.
// This adapter supplies HTML styling and escapes all code and observed values.
export function renderBombadilReport(node: BombadilReport): string {
  switch (node.kind) {
    case "text":
    case "keyword":
      return escape(node.text);
    case "code":
      return `<code>${escape(node.text)}</code>`;
    case "code-block":
      return `<pre>${escape(node.text)}</pre>`;
    case "time":
      return `<time>${escape(node.text)}</time>`;
    case "comma":
      return ",";
    case "snapshot": {
      const value = JSON.stringify(node.value, null, 2);
      return typeof node.value === "object" && node.value !== null
        ? `<div class="bombadil-snapshot"><code>${escape(node.name)}</code> =<pre>${escape(value)}</pre></div>`
        : `<span><code>${escape(node.name)}</code> = <code>${escape(value)}</code></span>`;
    }
    case "snapshots":
      return `<div class="bombadil-snapshots">${node.children.map(renderBombadilReport).join(" and ")}</div>`;
    case "join":
      return node.children.reduce(
        (html, child) =>
          html +
          (html && child.kind !== "comma" ? " " : "") +
          renderBombadilReport(child),
        "",
      );
  }
}
