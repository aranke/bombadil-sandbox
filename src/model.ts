export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}
export interface TodoView {
  todos: Todo[];
  visibleIds: number[];
  remaining: number;
  filter: string;
}
export type Action =
  | { type: "add"; text: string }
  | { type: "toggle" | "delete"; id: number }
  | { type: "filter"; filter: "all" | "active" | "completed" }
  | { type: "reload" | "wait" };
export interface Observation {
  ready: boolean;
  todos: Todo[];
  visible: Todo[];
  remaining: number;
  filter: string;
  lastAction: Action | null;
}
export interface Verdict {
  status: "pending" | "satisfied" | "violation";
  violation?: any;
  report?: BombadilReport;
}
export type BombadilReport =
  | { kind: "text" | "code" | "code-block" | "keyword" | "time"; text: string }
  | { kind: "snapshot"; name: string; value: unknown }
  | { kind: "join" | "snapshots"; children: BombadilReport[] }
  | { kind: "comma" };
export interface Entry {
  index: number;
  action: Action | null;
  observation: Observation;
  time: number;
  results: Record<string, Verdict>;
}
export const initialTodos: Todo[] = [
  { id: 1, text: "Plant something green", completed: false },
  { id: 2, text: "Take the long way home", completed: true },
];
// A short, reproducible default: add → toggle → reload with the default weights.
// Other seeds explore other sequences.
export const defaultSeed = 8;
export const brokenCode = `function createApp(storage) {
  const initialTodos = [
    { id: 1, text: "Plant something green", completed: false },
    { id: 2, text: "Take the long way home", completed: true },
  ];
  let todos = storage.load() ?? initialTodos;
  let filter = "all";

  function persist() {
    storage.save(todos);
  }

  function onToggle(id) {
    const todo = todos.find(todo => todo.id === id);
    todo.completed = !todo.completed;
  }

  function onAdd(text) {
    text = text.trim();
    if (!text) return;
    const id = Math.max(0, ...todos.map(todo => todo.id)) + 1;
    todos.push({ id, text, completed: false });
    persist();
  }

  function onDelete(id) {
    todos = todos.filter(todo => todo.id !== id);
    persist();
  }

  function onFilter(value) {
    filter = value;
  }

  function visibleTodos() {
    return todos.filter(todo =>
      filter === "all" ||
      todo.completed === (filter === "completed")
    );
  }

  function remainingCount() {
    return todos.filter(todo => !todo.completed).length;
  }

  function view() {
    return {
      todos,
      visibleIds: visibleTodos().map(todo => todo.id),
      remaining: remainingCount(),
      filter,
    };
  }

  return { onAdd, onToggle, onDelete, onFilter, view };
}`;
export const fixedCode = brokenCode.replace(
  "todo.completed = !todo.completed;",
  "todo.completed = !todo.completed;\n    persist();",
);
export const properties = {
  persistence: {
    title: "Reload preserves todos",
    file: "reload-preserves-todos.ts",
    description:
      "Remember the current todos. After reloading the app, they should still be the same.",
    source: `always(() => {
  const before = JSON.stringify(todos.current);

  return next(() =>
    lastAction.current?.type !== "reload" ||
    JSON.stringify(todos.current) === before
  );
})`,
  },
  count: {
    title: "Count matches incomplete todos",
    file: "items-left.ts",
    description:
      "The number in the footer must equal the number of incomplete todos, including items hidden by the current filter.",
    source: `always(() =>
  remaining.current ===
    todos.current.filter(todo => !todo.completed).length
)`,
  },
  filters: {
    title: "Visible todos match the filter",
    file: "filter-visibility.ts",
    description:
      "An active view contains incomplete todos. A completed view contains completed todos.",
    source: `always(() => {
  const action = lastAction.current;
  if (action?.type === "filter" && filter.current !== action.filter)
    return false;

  const expected = todos.current.filter(todo =>
    filter.current === "all" ||
    todo.completed === (filter.current === "completed")
  );
  return JSON.stringify(visible.current) === JSON.stringify(expected);
})`,
  },
  ready: {
    title: "Todo input appears within 2 seconds",
    file: "app-readiness.ts",
    description:
      "An app that never loads should not pass just because there is nothing to check.",
    source: `eventually(() => ready.current).within(2, "seconds")`,
  },
  noBlank: {
    title: "No blank todos",
    file: "no-blank-todos.ts",
    description: "Every todo must contain text after trimming whitespace.",
    source: `always(() =>
  todos.current.every(todo => todo.text.trim() !== "")
)`,
  },
  filterPreservesCount: {
    title: "Changing filters preserves the count",
    file: "filter-preserves-count.ts",
    description:
      "Remember the items-left count. Selecting a filter must leave it unchanged.",
    source: `always(() => {
  const before = remaining.current;
  const beforeFilter = filter.current;

  return next(() => filter.current !== beforeFilter)
    .implies(next(() => remaining.current === before));
})`,
  },
  addingPreservesFilter: {
    title: "Adding a todo preserves the filter",
    file: "adding-preserves-filter.ts",
    description:
      "Remember the selected filter. Adding a todo must not change it.",
    source: `always(() => {
  const before = filter.current;
  const beforeCount = todos.current.length;

  return next(() => todos.current.length > beforeCount)
    .implies(next(() => filter.current === before));
})`,
  },
};
export type PropertyName = keyof typeof properties;
export const defaultSources = () =>
  Object.fromEntries(
    Object.entries(properties).map(([key, p]) => [key, p.source]),
  );
export const guidedActions: Action[] = [
  { type: "add", text: "Watch what happens" },
  { type: "toggle", id: 1 },
  { type: "reload" },
];
export function stepLabel(
  entry: Entry,
  previous: Entry | undefined,
  compact = false,
): string {
  const { action } = entry;
  if (!action) return compact ? "Start" : "Initial state";
  switch (action.type) {
    case "add":
      return compact ? "Add" : "Add a todo";
    case "toggle": {
      // Edited handlers may leave completion unchanged or remove the todo.
      // Describe the observed result rather than assuming a successful toggle.
      const before = previous?.observation.todos.find(
        (t) => t.id === action.id,
      );
      const after = entry.observation.todos.find((t) => t.id === action.id);
      if (!after) return compact ? "Removed" : `Todo #${action.id} removed`;
      if (before?.completed === after.completed)
        return compact
          ? "Unchanged"
          : `Todo #${action.id}: completion unchanged`;
      const verb = after.completed ? "Complete" : "Uncomplete";
      return compact ? verb : `${verb} todo #${action.id}`;
    }
    case "delete":
      return compact ? "Delete" : "Delete a todo";
    case "filter":
      return compact
        ? "Filter"
        : `${action.filter[0].toUpperCase() + action.filter.slice(1)} filter`;
    case "reload":
      return "Reload";
    case "wait":
      return "Wait";
  }
}
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function chooseAction(
  observation: Observation,
  rng: () => number,
  weights: { create: number; interact: number; reload: number },
): Action {
  // Include validation boundaries so empty-input bugs are reachable.
  const texts = [
    "Read a little poetry",
    "Make room for a seedling",
    "Walk by the river",
    "Write one good sentence",
    "Try something unfamiliar",
    "",
    "   ",
  ];
  const groups: { weight: number; actions: Action[] }[] = [
    {
      weight: weights.create,
      actions:
        observation.todos.length < 18
          ? [{ type: "add", text: texts[Math.floor(rng() * texts.length)] }]
          : [],
    },
    {
      weight: weights.interact,
      actions: [
        ...observation.visible.flatMap(
          (todo) =>
            [
              { type: "toggle", id: todo.id },
              { type: "delete", id: todo.id },
            ] as Action[],
        ),
        ...(["all", "active", "completed"] as const)
          .filter((f) => f !== observation.filter)
          .map((filter) => ({ type: "filter", filter }) as Action),
      ],
    },
    { weight: weights.reload, actions: [{ type: "reload" }] },
  ];
  const available = groups.filter((g) => g.weight > 0 && g.actions.length);
  const total = available.reduce((n, g) => n + g.weight, 0);
  let n = rng() * total;
  for (const group of available) {
    n -= group.weight;
    if (n < 0) return group.actions[Math.floor(rng() * group.actions.length)];
  }
  return { type: "wait" };
}
