const steps = [
  {
    target: "#example-choice",
    title: "Choose an example",
    body: "Each example pairs a deliberately buggy app with a test that catches it. Switching starts a fresh timeline and keeps your edits for each example.",
  },
  {
    target: ".behaviors-pane",
    title: "Edit the app",
    body: "Use the <code>Fix:</code> comment as a hint. Your edits stay in a draft. <strong>Apply changes</strong> appears after you edit and reruns the recorded steps with your fix.",
  },
  {
    target: ".tests-pane",
    title: "Describe correct behavior",
    body: "<code>always</code> checks every state; <code>next</code> checks the following state. Editing a test automatically rechecks the recorded timeline.",
  },
  {
    target: ".app-stage",
    title: "Try the app",
    body: "Interact with the todos here to record steps and check the test. Earlier states and failed runs are read-only.",
  },
  {
    target: "#reload-app",
    title: "Reload saved todos",
    body: "This simulates a browser refresh: saved todos remain, and unsaved changes can disappear. It records a step without clearing the timeline.",
  },
  {
    target: ".output-controls",
    title: "Run, replay, or start over",
    body: "<strong>Continue</strong> adds up to seven new steps and stops at a failure.<p><strong>Replay</strong> repeats the recorded steps. <strong>Start over</strong> clears the run. Both keep your edits.</p>",
  },
  {
    target: ".output-footer",
    title: "Inspect the result",
    body: "After recording steps, use the slider to inspect earlier states. Failures show a short explanation. Expand <strong>Bombadil report</strong> for the original expression and captured values.",
  },
];

const seenKey = "bombadil-sandbox:tour-seen:v1";

// The tour only explains existing UI. It never calls the app or test runner.
export function installTour(trigger: HTMLButtonElement) {
  const dialog = document.createElement("dialog");
  dialog.className = "tour-dialog";
  dialog.setAttribute("aria-label", "Guided tour");
  dialog.setAttribute("aria-describedby", "tour-body");
  dialog.innerHTML = `
    <div class="tour-highlight" aria-hidden="true"></div>
    <section class="tour-card">
      <div class="tour-top"><span id="tour-count"></span><button class="tour-close" aria-label="Close tour" title="Close tour"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <div aria-live="polite" aria-atomic="true"><h2 id="tour-title"></h2><div id="tour-body"></div></div>
      <div class="tour-actions"><button class="control-button tour-back">Back</button><button class="control-button primary tour-next">Next</button></div>
    </section>`;
  document.body.append(dialog);
  const highlight = dialog.querySelector<HTMLElement>(".tour-highlight")!;
  const card = dialog.querySelector<HTMLElement>(".tour-card")!;
  const back = dialog.querySelector<HTMLButtonElement>(".tour-back")!;
  const next = dialog.querySelector<HTMLButtonElement>(".tour-next")!;
  let index = 0;
  let originalScroll = { x: 0, y: 0 };
  let originalOverflow = "";
  let finished = false;
  let exitScroll = originalScroll;
  let frame = 0;

  const target = () => document.querySelector<HTMLElement>(steps[index].target);
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));
  function position() {
    if (!dialog.open) return;
    const bounds = target()?.getBoundingClientRect();
    const width = innerWidth,
      height = innerHeight;
    const panel = card.getBoundingClientRect();
    if (!bounds) return;
    const left = clamp(bounds.left - 5, 8, width - 8);
    const top = clamp(bounds.top - 5, 8, height - 8);
    const right = clamp(bounds.right + 5, left, width - 8);
    const bottom = clamp(bounds.bottom + 5, top, height - 8);
    Object.assign(highlight.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    let x = bounds.left,
      y = bounds.bottom + 16;
    if (y + panel.height > height - 16) {
      if (bounds.top - panel.height - 16 >= 16)
        y = bounds.top - panel.height - 16;
      else if (bounds.right + panel.width + 16 <= width - 16) {
        x = bounds.right + 16;
        y = bounds.top + 16;
      } else if (bounds.left - panel.width - 16 >= 16) {
        x = bounds.left - panel.width - 16;
        y = bounds.top + 16;
      } else {
        x = width - panel.width - 16;
        y = height - panel.height - 16;
      }
    }
    Object.assign(card.style, {
      left: `${clamp(x, 16, width - panel.width - 16)}px`,
      top: `${clamp(y, 16, height - panel.height - 16)}px`,
    });
  }
  function schedulePosition() {
    if (!frame && dialog.open)
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
  }
  const observer = new ResizeObserver(schedulePosition);
  function render() {
    dialog.querySelector("#tour-count")!.textContent =
      `${index + 1} / ${steps.length}`;
    dialog.querySelector("#tour-title")!.textContent = steps[index].title;
    // These are static, authored tour descriptions, never application data.
    dialog.querySelector("#tour-body")!.innerHTML = steps[index].body;
    const backFocused = document.activeElement === back;
    back.disabled = index === 0;
    if (backFocused && back.disabled) next.focus({ preventScroll: true });
    next.textContent = index === steps.length - 1 ? "Done" : "Next";
    target()?.scrollIntoView({
      block: innerWidth <= 1100 ? "start" : "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    position();
  }
  function advance() {
    if (index < steps.length - 1) {
      index++;
      render();
    } else {
      finished = true;
      exitScroll = { x: scrollX, y: scrollY };
      dialog.close();
    }
  }
  function start() {
    if (dialog.open) return;
    try {
      localStorage.setItem(seenKey, "1");
    } catch {
      // Manual tours remain available when browser storage is blocked.
    }
    index = 0;
    finished = false;
    originalScroll = { x: scrollX, y: scrollY };
    originalOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog.showModal();
    render();
    next.focus({ preventScroll: true });
    observer.observe(card);
    document
      .querySelectorAll<HTMLElement>(".output-footer, .app-stage")
      .forEach((el) => observer.observe(el));
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
  }
  trigger.onclick = start;
  back.onclick = () => {
    if (index > 0) {
      index--;
      render();
    }
  };
  next.onclick = advance;
  dialog.querySelector<HTMLButtonElement>(".tour-close")!.onclick = () =>
    dialog.close();
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const buttons = [
        ...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      ];
      const first = buttons[0],
        last = buttons.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      advance();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      back.click();
    }
  });
  dialog.addEventListener("close", () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("scroll", schedulePosition, true);
    document.documentElement.style.overflow = originalOverflow;
    const continueButton =
      document.querySelector<HTMLButtonElement>("#new-run");
    const focus = finished
      ? continueButton?.disabled
        ? document.querySelector<HTMLButtonElement>("#reset-app")
        : continueButton
      : trigger;
    focus?.focus({ preventScroll: true });
    const scroll = finished ? exitScroll : originalScroll;
    window.scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
  });
  return {
    startOnce() {
      try {
        if (localStorage.getItem(seenKey)) return;
        // Only auto-open if the browser can remember it, including dismissal.
        localStorage.setItem(seenKey, "1");
      } catch {
        return;
      }
      start();
    },
  };
}
