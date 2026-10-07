import { basicSetup, EditorView } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { Annotation } from "@codemirror/state";

const programmatic = Annotation.define<boolean>();

export class CodeEditor {
  oninput = () => {};
  private view: EditorView;
  constructor(parent: HTMLElement, label: string) {
    this.view = new EditorView({
      parent,
      extensions: [
        basicSetup,
        javascript(),
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": label,
          "aria-describedby": "editor-keyboard-help",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.every((t) => t.annotation(programmatic))
          )
            this.oninput();
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--mono)",
            lineHeight: "1.7",
          },
          ".cm-content": { padding: "16px 0" },
          ".cm-line": { padding: "0 12px" },
          ".cm-gutters": {
            background: "#fafbf9",
            color: "#89928b",
            border: "none",
          },
          // Selection is drawn behind the text, so line shading must be translucent.
          ".cm-activeLine": { background: "#f0f5f060" },
          ".cm-activeLineGutter": { background: "#f0f5f0" },
          ".cm-selectionBackground": { background: "#dce8df" },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
            { background: "#bdd8c6" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    });
  }
  get value() {
    return this.view.state.doc.toString();
  }
  set value(value: string) {
    if (value !== this.value)
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: value },
        selection: { anchor: 0 },
        scrollIntoView: true,
        annotations: programmatic.of(true),
      });
  }
}

export function installSplitters(workspace: HTMLElement) {
  const sizes = [35, 32.5, 32.5];
  const handles = [...workspace.querySelectorAll<HTMLElement>(".splitter")];
  const apply = () => {
    workspace.style.setProperty(
      "--pane-columns",
      `${sizes[0]}fr 6px ${sizes[1]}fr 6px ${sizes[2]}fr`,
    );
    handles.forEach((h, i) => {
      const total = sizes[i] + sizes[i + 1];
      h.setAttribute(
        "aria-valuenow",
        String(Math.round((sizes[i] / total) * 100)),
      );
      h.setAttribute(
        "aria-valuetext",
        `${Math.round((sizes[i] / total) * 100)} percent of adjacent panes`,
      );
    });
  };
  handles.forEach((handle, index) => {
    const move = (delta: number, initial: number) => {
      const total = sizes[index] + sizes[index + 1];
      const min = (200 / workspace.clientWidth) * 100;
      sizes[index] = Math.max(min, Math.min(total - min, initial + delta));
      sizes[index + 1] = total - sizes[index];
      apply();
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.focus();
      const x = e.clientX,
        initial = sizes[index];
      handle.setPointerCapture(e.pointerId);
      handle.onpointermove = (event) =>
        move(((event.clientX - x) / workspace.clientWidth) * 100, initial);
      handle.onpointerup = () => {
        handle.onpointermove = null;
      };
      handle.onlostpointercapture = () => {
        handle.onpointermove = null;
      };
    };
    handle.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      move(
        (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1),
        sizes[index],
      );
    };
  });
  apply();
}
