import { todoMarkup, todoStyles } from "./presentation";
import { applicationWorker } from "./application";
import type { TodoView } from "./model";

// Both frames have opaque origins. User code cannot access the playground shell.
const policy =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src data:; form-action 'none'; base-uri 'none'";
function documentFor(script: string, body = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${body}<script>${script.replace(/<\/script/gi, "<\\/script")}<\/script></body></html>`;
}
function evaluationFrame() {
  let worker: Worker;
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const request = event.data;
    if (request.kind === "boot") {
      worker?.terminate();
      const url = URL.createObjectURL(
        new Blob([request.source], { type: "text/javascript" }),
      );
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e) => parent.postMessage(e.data, "*");
      worker.onerror = (e) =>
        parent.postMessage({ id: request.id, error: e.message }, "*");
      worker.postMessage({
        id: request.id,
        kind: "boot",
        bytes: request.bytes,
      });
    } else worker?.postMessage(request);
  });
}
export function evaluatorDocument() {
  return documentFor(`(${evaluationFrame.toString()})();`);
}

function applicationFrame(workerSource: string) {
  type Todo = { id: number; text: string; completed: boolean };
  let view: TodoView;
  let lastAction: any = null,
    manual = false;
  let pending: Promise<void> = Promise.resolve();
  let runtimeError = "";
  let worker: Worker;
  let serial = 0;
  const requests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const root = document.getElementById("todoapp")!;
  function stopWorker(error: Error) {
    worker?.terminate();
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    requests.clear();
  }
  function startWorker() {
    stopWorker(Error("App restarted"));
    const url = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = ({ data }) => {
      const request = requests.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      requests.delete(data.id);
      if (data.error) request.reject(Error(data.error));
      else request.resolve(data.result);
    };
    worker.onerror = (event) => stopWorker(Error(event.message));
  }
  function requestBehavior(
    kind: string,
    data: Record<string, unknown>,
  ): Promise<any> {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          stopWorker(
            Error("App code took too long to run. Check for an infinite loop."),
          ),
        700,
      );
      requests.set(id, { resolve, reject, timer });
      worker.postMessage({ id, kind, ...data });
    });
  }
  function validTodos(value: unknown): value is Todo[] {
    return (
      Array.isArray(value) &&
      value.length <= 1000 &&
      value.every(
        (t) =>
          t &&
          Number.isSafeInteger(t.id) &&
          t.id > 0 &&
          typeof t.text === "string" &&
          typeof t.completed === "boolean",
      ) &&
      new Set(value.map((t) => t.id)).size === value.length
    );
  }
  function acceptResult(result: any) {
    const candidate = result.view;
    if (
      !candidate ||
      !validTodos(candidate.todos) ||
      !Array.isArray(candidate.visibleIds) ||
      candidate.visibleIds.some(
        (id: unknown) =>
          !Number.isSafeInteger(id) ||
          !candidate.todos.some((todo: Todo) => todo.id === id),
      ) ||
      new Set(candidate.visibleIds).size !== candidate.visibleIds.length ||
      !Number.isSafeInteger(candidate.remaining) ||
      !["all", "active", "completed"].includes(candidate.filter)
    )
      throw Error(
        "view() must return valid todos, visibleIds drawn from those todos, an integer remaining count, and an all/active/completed filter.",
      );
    view = candidate;
    if (result.savedChanged)
      parent.postMessage({ event: "storage", value: result.saved }, "*");
    render();
  }
  async function applyBehavior(action: any) {
    acceptResult(await requestBehavior("action", { action }));
  }
  function track(promise: Promise<void>) {
    pending = promise.catch((error) => {
      runtimeError = error.message;
      if (manual)
        parent.postMessage(
          { event: "manual-error", error: error.message },
          "*",
        );
      throw error;
    });
    pending.catch(() => {});
  }
  function render() {
    root.innerHTML = todoMarkup(view);
    root.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = root.querySelector<HTMLInputElement>(".new-todo")!;
      track(applyBehavior({ type: "add", text: input.value }));
    });
    root.querySelectorAll<HTMLInputElement>("li input").forEach((el) =>
      el.addEventListener("change", () =>
        track(
          applyBehavior({
            type: "toggle",
            id: Number(el.closest("li")!.dataset.id),
          }),
        ),
      ),
    );
    root.querySelectorAll<HTMLButtonElement>(".delete").forEach(
      (el) =>
        (el.onclick = () => {
          track(
            applyBehavior({
              type: "delete",
              id: Number(el.closest("li")!.dataset.id),
            }),
          );
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
      (el) =>
        (el.onclick = () => {
          track(applyBehavior({ type: "filter", filter: el.dataset.filter! }));
        }),
    );
    parent.postMessage({ event: "resize", height: root.scrollHeight + 4 }, "*");
  }
  function observe() {
    const rows = [...root.querySelectorAll<HTMLLIElement>("li")];
    const read = (el: HTMLLIElement) => ({
      id: Number(el.dataset.id),
      text: el.querySelector(".todo-text")!.textContent!,
      completed: el.querySelector<HTMLInputElement>("input")!.checked,
    });
    return {
      ready: !!root.querySelector(".new-todo"),
      todos: rows.map(read),
      visible: rows.filter((el) => !el.hidden).map(read),
      remaining: Number(root.querySelector(".todo-count strong")!.textContent),
      filter: root.querySelector<HTMLElement>(
        '[data-filter][aria-pressed="true"]',
      )!.dataset.filter!,
      lastAction,
    };
  }
  async function action(a: any) {
    runtimeError = "";
    lastAction = a;
    if (a.type === "add") {
      const input = root.querySelector<HTMLInputElement>(".new-todo")!;
      input.focus();
      input.value = a.text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      root.querySelector("form")!.requestSubmit();
    } else if (a.type === "toggle" || a.type === "delete") {
      const row = root.querySelector<HTMLLIElement>(
        `li[data-id="${Number(a.id)}"]`,
      );
      if (!row || row.hidden)
        throw Error(
          "The recorded step cannot run because its todo is no longer visible.",
        );
      row
        .querySelector<HTMLElement>(a.type === "toggle" ? "input" : ".delete")!
        .click();
    } else if (a.type === "filter") {
      const el = root.querySelector<HTMLButtonElement>(
        `[data-filter="${a.filter}"]`,
      );
      if (!el) throw Error("Unsupported filter");
      el.click();
    } else if (a.type !== "wait") throw Error("Unsupported action");
    await pending;
    if (runtimeError) throw Error(runtimeError);
  }
  window.addEventListener("message", async (event) => {
    if (event.source !== parent || !event.data.kind) return;
    const { id, kind, ...data } = event.data;
    try {
      let result;
      if (kind === "init") {
        lastAction = data.lastAction ?? null;
        manual = !!data.manual;
        runtimeError = "";
        pending = Promise.resolve();
        startWorker();
        acceptResult(
          await requestBehavior("init", {
            code: data.code,
            saved: data.saved ?? null,
          }),
        );
        result = observe();
      } else if (kind === "action") {
        await action(data.action);
        result = observe();
      } else if (kind === "observe") result = observe();
      else throw Error("Unknown application request");
      parent.postMessage({ id, result }, "*");
    } catch (error) {
      parent.postMessage(
        { id, error: error instanceof Error ? error.message : String(error) },
        "*",
      );
    }
  });
}
export function applicationDocument() {
  return documentFor(
    `const todoMarkup = ${todoMarkup.toString()}; (${applicationFrame.toString()})(${JSON.stringify(`(${applicationWorker.toString()})();`)});`,
    `<style>
${todoStyles}
</style><section id="todoapp" aria-label="Todo application"></section>`,
  );
}

export function standaloneDocument(broken: string, fixed: string) {
  const boot = `const code=new URL(location.href).searchParams.has('fixed')?${JSON.stringify(fixed)}:${JSON.stringify(broken)};
  window.addEventListener('message',event=>{if(event.source===window&&event.data.event==='storage')localStorage.setItem('bombadil-todos',JSON.stringify(event.data.value));});
  window.postMessage({id:1,kind:'init',saved:JSON.parse(localStorage.getItem('bombadil-todos')||'null'),code,manual:true},'*');`;
  return applicationDocument().replace(
    "</body>",
    `<script>${boot.replace(/<\/script/gi, "<\\/script")}<\/script></body>`,
  );
}

export class FrameRPC {
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listener: (event: MessageEvent) => void;
  readonly ready: Promise<void>;
  constructor(
    readonly frame: HTMLIFrameElement,
    html: string,
    onEvent?: (data: any) => void,
  ) {
    this.listener = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== "null")
        return;
      const response = event.data;
      if (response.event) {
        onEvent?.(response);
        return;
      }
      const request = this.pending.get(response.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(response.id);
      if (response.error) request.reject(Error(response.error));
      else request.resolve(response.result);
    };
    window.addEventListener("message", this.listener);
    this.ready = new Promise((resolve) =>
      frame.addEventListener("load", () => resolve(), { once: true }),
    );
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.srcdoc = html;
  }
  async call(
    kind: string,
    data: Record<string, unknown> = {},
    timeout = 4000,
  ): Promise<any> {
    await this.ready;
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error("Code execution timed out. Use Start over to restart the run."),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.frame.contentWindow!.postMessage({ id, kind, ...data }, "*");
    });
  }
  dispose() {
    window.removeEventListener("message", this.listener);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Run cancelled"));
    }
    this.pending.clear();
    this.frame.remove();
  }
}
