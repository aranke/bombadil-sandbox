import type { TodoView } from "./model";

export function todoMarkup(
  { todos, filter, visibleIds, remaining }: TodoView,
  changed: number[] = [],
) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  return `<h1>todos</h1><form><input class="new-todo" placeholder="What would you like to do?" aria-label="New todo" maxlength="100" autocomplete="off"></form><ul class="todo-list" tabindex="0" aria-label="Todos">${todos.map((t) => `<li data-id="${t.id}" ${changed.includes(t.id) ? 'data-changed="true" title="Related to this failure"' : ""} ${!visibleIds.includes(t.id) ? "hidden" : ""}><label><input type="checkbox" ${t.completed ? "checked" : ""} aria-label="Complete ${escape(t.text)}"><span class="todo-text">${escape(t.text)}</span></label><button class="delete" aria-label="Delete ${escape(t.text)}">×</button></li>`).join("")}</ul><footer><span class="todo-count"><strong>${remaining}</strong> left</span><nav aria-label="Todo filter">${["all", "active", "completed"].map((f) => `<button data-filter="${f}" aria-pressed="${f === filter}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}</nav></footer>`;
}

export const todoStyles =
  "*{box-sizing:border-box}body{margin:0;background:transparent}#todoapp{padding:1px;font:16px system-ui,sans-serif;color:#262b28;background:transparent}h1{font:28px system-ui,sans-serif;font-weight:400;letter-spacing:-1px;margin:0 0 20px}form{margin:0}.new-todo{padding:12px 0;width:100%;border:0;border-bottom:1px solid #e5e8e6;background:transparent;border-radius:0;font:14px system-ui}.new-todo::placeholder{color:#727974}.todo-list{list-style:none;padding:0;margin:0;max-height:180px;overflow:auto}li{padding:12px 0;border-bottom:1px solid #e5e8e6;display:flex;gap:8px;align-items:center}li[hidden]{display:none}label{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.todo-text{overflow-wrap:anywhere}input[type=checkbox]{width:17px;height:17px;accent-color:#526e59;flex-shrink:0;margin:0}input:checked+.todo-text{text-decoration:line-through;color:#929a94}.delete{border:0;background:none;color:#929a94;font-size:20px;cursor:pointer}footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 0;font-size:12px;color:#727974}nav{display:flex;gap:6px}nav button{font:12px system-ui;border:0;padding:4px 2px;background:none;color:inherit;cursor:pointer}nav button[aria-pressed=true]{color:#262b28;text-decoration:underline;text-underline-offset:4px}.todo-count strong{font-weight:400}:focus-visible{outline:2px solid #6a8977;outline-offset:2px}li[data-changed]{background:#fff0eb;box-shadow:inset 3px 0 #b0372f;padding-left:9px}li[data-changed] .todo-text{color:#922b25}";

// Let the visible preview use its pane's height. Short lists keep their natural
// size; longer lists shrink only when they exceed the available space.
export const previewStyles = `
  :host { display: flex; flex: 1; min-width: 0; min-height: 0; }
  #todoapp { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  h1, form, footer { flex-shrink: 0; }
  .todo-list { flex: 0 1 auto; min-height: 0; max-height: none; }
`;
