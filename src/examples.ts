import {
  brokenCode,
  fixedCode,
  guidedActions,
  defaultSeed,
  type Action,
  type PropertyName,
} from "./model";

interface Example {
  title: string;
  property: PropertyName;
  seed: number;
  code: string;
  actions: Action[];
}

// Lessons adapted to our DOM observations and action driver from Oskar
// Wickström's TodoMVC specification, revision 73202e6269b06cbf945c5a4735ca9fa47c4c7ab0:
// https://github.com/owickstrom/bombadil-playground/blob/73202e6269b06cbf945c5a4735ca9fa47c4c7ab0/todomvc/todomvc.ts
// Each fixture starts with one intentional defect; all other rules use fixedCode.
export const examples = {
  persistence: {
    title: "Reload persistence",
    property: "persistence",
    seed: defaultSeed,
    code: brokenCode.replace(
      "    todo.completed = !todo.completed;",
      "    todo.completed = !todo.completed;\n    // Fix: add persist(); here to save the completion change.",
    ),
    actions: guidedActions,
  },
  count: {
    title: "Items left",
    property: "count",
    seed: 24,
    code: fixedCode.replace(
      "return todos.filter(todo => !todo.completed).length;",
      "// Fix: count todos instead of visibleTodos() in the return below.\n    return visibleTodos().filter(todo => !todo.completed).length;",
    ),
    actions: [
      { type: "delete", id: 1 },
      { type: "filter", filter: "active" },
      { type: "filter", filter: "completed" },
      { type: "toggle", id: 2 },
    ],
  },
  filters: {
    title: "Filter visibility",
    property: "filters",
    seed: 131,
    code: fixedCode.replace(
      'todo.completed === (filter === "completed")',
      '// Fix: change "active" to "completed" in the comparison below.\n      todo.completed === (filter === "active")',
    ),
    actions: [
      { type: "add", text: "Walk by the river" },
      { type: "toggle", id: 3 },
      { type: "delete", id: 1 },
      { type: "add", text: "Read a little poetry" },
      { type: "filter", filter: "completed" },
    ],
  },
  noBlank: {
    title: "Blank todos",
    property: "noBlank",
    seed: 741,
    code: fixedCode.replace(
      "    if (!text) return;",
      "    // Fix: add if (!text) return; here to reject blank text.",
    ),
    actions: [
      { type: "delete", id: 1 },
      { type: "add", text: "Read a little poetry" },
      { type: "toggle", id: 3 },
      { type: "add", text: "Make room for a seedling" },
      { type: "add", text: "Write one good sentence" },
      { type: "add", text: "   " },
    ],
  },
  filterPreservesCount: {
    title: "Filter changes",
    property: "filterPreservesCount",
    seed: 131,
    code: fixedCode.replace(
      "    filter = value;",
      `    filter = value;
    // Fix: remove the next three lines; filtering must not create todos.
    const id = Math.max(0, ...todos.map(todo => todo.id)) + 1;
    todos.push({ id, text: "An unexpected todo", completed: false });
    persist();`,
    ),
    actions: [
      { type: "add", text: "Walk by the river" },
      { type: "toggle", id: 3 },
      { type: "delete", id: 1 },
      { type: "add", text: "Read a little poetry" },
      { type: "filter", filter: "completed" },
    ],
  },
  addingPreservesFilter: {
    title: "Adding todos",
    property: "addingPreservesFilter",
    seed: 2186,
    code: fixedCode.replace(
      "    todos.push({ id, text, completed: false });",
      '    todos.push({ id, text, completed: false });\n    filter = "all"; // Fix: remove this line to keep the selected filter.',
    ),
    actions: [
      { type: "delete", id: 2 },
      { type: "add", text: "Try something unfamiliar" },
      { type: "delete", id: 2 },
      { type: "filter", filter: "active" },
      { type: "toggle", id: 1 },
      { type: "filter", filter: "completed" },
      { type: "add", text: "Read a little poetry" },
    ],
  },
} satisfies Record<string, Example>;

export type ExampleName = keyof typeof examples;
