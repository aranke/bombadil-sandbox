// Runs the same controlled sequence through native Bombadil and real localStorage.
import { always, next, eventually } from "@antithesishq/bombadil";
import {
  extract,
  actions,
  registerCustomAction,
} from "@antithesishq/bombadil/browser";
const rawAction = extract((state) => state.lastAction);
const lastAction = extract((state) =>
  state.lastAction === "Reload" ? { type: "reload" } : null,
);
const ready = extract(({ document }) => !!document.querySelector(".new-todo"));
const todos = extract(({ document }) =>
  [...document.querySelectorAll<HTMLLIElement>("li[data-id]")].map((row) => ({
    id: Number(row.dataset.id),
    text: row.querySelector(".todo-text")!.textContent!,
    completed: row.querySelector<HTMLInputElement>("input")!.checked,
  })),
);
const remaining = extract(({ document }) =>
  Number(document.querySelector(".todo-count strong")?.textContent ?? 0),
);
export const persistence = always(() => {
  const before = JSON.stringify(todos.current);
  return next(
    () =>
      lastAction.current?.type !== "reload" ||
      JSON.stringify(todos.current) === before,
  );
});
export const count = always(
  () =>
    !ready.current ||
    remaining.current ===
      todos.current.filter((todo) => !todo.completed).length,
);
export const appReady = eventually(() => ready.current).within(2, "seconds");
const add = registerCustomAction("add", async (document) => {
  const input = document.querySelector<HTMLInputElement>(".new-todo")!;
  input.value = "Watch what happens";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("form")!.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
const toggle = registerCustomAction("toggle", async (document) => {
  document.querySelector<HTMLInputElement>('li[data-id="1"] input')!.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
export const guided = actions(() => {
  if (!ready.current) return ["Wait"];
  const action = rawAction.current;
  if (!action || (action === "Wait" && todos.current.length === 2))
    return [add()];
  if (
    typeof action === "object" &&
    "Custom" in action &&
    action.Custom.name === "add"
  )
    return [toggle()];
  if (
    typeof action === "object" &&
    "Custom" in action &&
    action.Custom.name === "toggle"
  )
    return ["Reload"];
  return ["Wait"];
});
