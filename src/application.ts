// Serialized into an isolated worker. The editable module receives exactly one
// explicit dependency: a synchronous, structured-clone storage adapter.
export function applicationWorker() {
  let app: any;
  let saved: unknown = null;
  let savedChanged = false;
  self.onmessage = ({ data }) => {
    try {
      savedChanged = false;
      if (data.kind === "init") {
        saved = structuredClone(data.saved);
        const factory = new Function(
          `"use strict";\n${data.code}\n;return createApp;`,
        )();
        app = factory({
          load: () => structuredClone(saved),
          save: (value: unknown) => {
            saved = structuredClone(value);
            savedChanged = true;
          },
        });
        if (!app || typeof app.view !== "function")
          throw Error("createApp(storage) must return handlers and view().");
        for (const name of ["onAdd", "onToggle", "onDelete", "onFilter"])
          if (typeof app[name] !== "function")
            throw Error(`createApp(storage) must return ${name}().`);
      } else {
        const action = data.action;
        let result;
        switch (action.type) {
          case "add":
            result = app.onAdd(action.text);
            break;
          case "toggle":
            result = app.onToggle(action.id);
            break;
          case "delete":
            result = app.onDelete(action.id);
            break;
          case "filter":
            result = app.onFilter(action.filter);
            break;
          default:
            throw Error("Unsupported app step");
        }
        if (result?.then) throw Error("App handlers must be synchronous.");
      }
      self.postMessage({
        id: data.id,
        result: { view: app.view(), savedChanged, saved },
      });
    } catch (error) {
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
