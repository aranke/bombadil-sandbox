"use strict";
(() => {
  // vendor/bombadil-api/internal.ts
  var ExtractorCell = class {
    constructor(runtime2, extract2) {
      this.runtime = runtime2;
      this.extract = extract2;
      this.index = runtime2.registerExtractor(this);
    }
    name = null;
    index;
    snapshot;
    update(snapshot) {
      this.snapshot = snapshot;
    }
    get current() {
      this.runtime.checkNotExtracting();
      this.runtime.recordAccess(this.index);
      if (this.snapshot === void 0) {
        throw new Error(
          `snapshot ${this.name} is not set for current state (this is a bug in the runtime)`
        );
      } else {
        return this.snapshot;
      }
    }
    named(name) {
      this.name = name;
      return this;
    }
    /**
     * Runs the extractor and updates its cached value.
     */
    run(state) {
      const value = this.extract(state);
      this.update(value);
      return value;
    }
  };
  var Runtime = class {
    extractors = [];
    extractingDepth = 0;
    tracking = false;
    accesses = /* @__PURE__ */ new Set();
    customActions = {};
    registerExtractor(cell) {
      const index = this.extractors.length;
      this.extractors.push(cell);
      return index;
    }
    startTracking() {
      this.tracking = true;
      this.accesses.clear();
    }
    stopTracking() {
      this.tracking = false;
      const result = Array.from(this.accesses);
      this.accesses.clear();
      return result;
    }
    recordAccess(index) {
      if (this.tracking) {
        this.accesses.add(index);
      }
    }
    runExtractors(state) {
      return this.extractors.map((extractor, index) => {
        this.extractingDepth++;
        try {
          return {
            index,
            name: extractor.name,
            value: extractor.run(state)
          };
        } finally {
          this.extractingDepth--;
        }
      });
    }
    checkNotExtracting() {
      if (this.extractingDepth > 0) {
        throw new Error(
          "Cannot access cell.current from within an extractor. Extractors must only depend on the 'state' parameter. Use shared helper functions to avoid duplication."
        );
      }
    }
    registerCustomAction(action) {
      if (action.name in this.customActions) {
        throw new Error(`Custom action "${action.name}" is already registered.`);
      }
      this.customActions[action.name] = action;
    }
    async runCustomAction(name, args) {
      const action = this.customActions[name];
      if (!action) {
        return Promise.reject(
          new Error(`Custom action "${name}" is not registered.`)
        );
      }
      return action.run(...args);
    }
  };

  // vendor/bombadil-api/actions.ts
  var CharSet;
  ((CharSet2) => {
    function fromRange(from, to) {
      return [{ Range: [from, to] }];
    }
    CharSet2.fromRange = fromRange;
    function fromLiterals(...literals) {
      return literals.map((literal) => ({ Literal: literal }));
    }
    CharSet2.fromLiterals = fromLiterals;
    function union(...sets) {
      return sets.flat(1);
    }
    CharSet2.union = union;
  })(CharSet || (CharSet = {}));

  // vendor/bombadil-api/index.ts
  var runtime = new Runtime();
  function extract(query) {
    return new ExtractorCell(runtime, query);
  }
  var Formula = class {
    not() {
      return new Not(this);
    }
    and(that) {
      return new And(this, now(that));
    }
    or(that) {
      return new Or(this, now(that));
    }
    implies(that) {
      return new Implies(this, now(that));
    }
  };
  var Pure = class extends Formula {
    constructor(pretty, value) {
      super();
      this.pretty = pretty;
      this.value = value;
    }
    toString() {
      return this.pretty;
    }
  };
  var And = class extends Formula {
    constructor(left, right) {
      super();
      this.left = left;
      this.right = right;
    }
    toString() {
      return `(${this.left}) && (${this.right})`;
    }
  };
  var Or = class extends Formula {
    constructor(left, right) {
      super();
      this.left = left;
      this.right = right;
    }
  };
  var Implies = class extends Formula {
    constructor(left, right) {
      super();
      this.left = left;
      this.right = right;
    }
    toString() {
      return `${this.left}.implies(${this.right})`;
    }
  };
  var Not = class extends Formula {
    constructor(subformula) {
      super();
      this.subformula = subformula;
    }
    toString() {
      return `!(${this.subformula.toString()})`;
    }
  };
  var Next = class extends Formula {
    constructor(subformula) {
      super();
      this.subformula = subformula;
    }
    toString() {
      return `next(${this.subformula})`;
    }
  };
  var Always = class _Always extends Formula {
    constructor(boundMillis, subformula) {
      super();
      this.boundMillis = boundMillis;
      this.subformula = subformula;
    }
    within(n, unit) {
      if (this.boundMillis !== null) {
        throw new Error("time bound is already set for `always`");
      }
      let durationMillis;
      switch (unit) {
        case "milliseconds":
          durationMillis = n;
          break;
        case "seconds":
          durationMillis = n * 1e3;
          break;
      }
      return new _Always(durationMillis, this.subformula);
    }
    toString() {
      return this.boundMillis === null ? `always(${this.subformula})` : `always(${this.subformula}).within(${this.boundMillis}, "milliseconds")`;
    }
  };
  var Eventually = class _Eventually extends Formula {
    constructor(boundMillis, subformula) {
      super();
      this.boundMillis = boundMillis;
      this.subformula = subformula;
    }
    within(n, unit) {
      if (this.boundMillis !== null) {
        throw new Error("time bound is already set for `eventually`");
      }
      let durationMillis;
      switch (unit) {
        case "milliseconds":
          durationMillis = n;
          break;
        case "seconds":
          durationMillis = n * 1e3;
          break;
      }
      return new _Eventually(durationMillis, this.subformula);
    }
    toString() {
      return this.boundMillis === null ? `eventually(${this.subformula})` : `eventually(${this.subformula}).within(${this.boundMillis}, "milliseconds")`;
    }
  };
  var Thunk = class extends Formula {
    constructor(pretty, apply) {
      super();
      this.pretty = pretty;
      this.apply = apply;
    }
    toString() {
      return this.pretty;
    }
  };
  function not(value) {
    return new Not(now(value));
  }
  function now(x) {
    if (typeof x === "function") {
      let liftResult2 = function(result) {
        return typeof result === "boolean" ? new Pure(pretty, result) : result;
      };
      var liftResult = liftResult2;
      const pretty = x.toString().replaceAll(/\t/g, "  ").replaceAll(/(\|\||&&)/g, (_, operator) => "\n  " + operator);
      return new Thunk(pretty, () => liftResult2(x()));
    }
    return x;
  }
  function next(x) {
    return new Next(now(x));
  }
  function always(x) {
    return new Always(null, now(x));
  }
  function eventually(x) {
    return new Eventually(null, now(x));
  }

  // src/evaluator.ts
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var BrowserEvaluator = class _BrowserEvaluator {
    wasm;
    thunks = /* @__PURE__ */ new Map();
    thunkIds = /* @__PURE__ */ new WeakMap();
    nextId = 0;
    time = 0;
    cells = {};
    observations = {};
    static async create(bytes) {
      const evaluator2 = new _BrowserEvaluator();
      const { instance } = await WebAssembly.instantiate(bytes, {
        host: { evaluate: (id) => evaluator2.callback(id) }
      });
      evaluator2.wasm = instance.exports;
      return evaluator2;
    }
    write(value) {
      const bytes = encoder.encode(JSON.stringify(value));
      const p = this.wasm.allocate(bytes.length);
      new Uint8Array(this.wasm.memory.buffer, p, bytes.length).set(bytes);
      return { p, n: bytes.length };
    }
    read(packed) {
      const p = Number(packed & 0xffffffffn), n = Number(packed >> 32n);
      try {
        return JSON.parse(
          decoder.decode(new Uint8Array(this.wasm.memory.buffer, p, n))
        );
      } finally {
        this.wasm.deallocate(p, n);
      }
    }
    call(value) {
      const { p, n } = this.write(value);
      try {
        const reply = this.read(this.wasm.process(p, n));
        if (reply.error) throw Error(reply.error);
        return reply;
      } finally {
        this.wasm.deallocate(p, n);
      }
    }
    wire(formula, captured = {}) {
      if (formula instanceof Pure)
        return { op: "pure", value: formula.value, pretty: formula.toString() };
      if (formula instanceof Thunk) {
        let id = this.thunkIds.get(formula);
        if (id === void 0) {
          id = this.nextId++;
          this.thunks.set(id, {
            apply: formula.apply,
            captured: structuredClone(captured)
          });
          this.thunkIds.set(formula, id);
        }
        return { op: "thunk", id, pretty: formula.toString() };
      }
      if (formula instanceof Not)
        return { op: "not", child: this.wire(formula.subformula, captured) };
      if (formula instanceof And || formula instanceof Or || formula instanceof Implies)
        return {
          op: formula instanceof And ? "and" : formula instanceof Or ? "or" : "implies",
          left: this.wire(formula.left, captured),
          right: this.wire(formula.right, captured)
        };
      if (formula instanceof Next)
        return { op: "next", child: this.wire(formula.subformula, captured) };
      if (formula instanceof Always || formula instanceof Eventually) {
        const bound = formula.boundMillis;
        if (bound !== null && (!Number.isSafeInteger(bound) || bound < 0))
          throw Error("Time bounds must be non-negative whole milliseconds");
        return {
          op: formula instanceof Always ? "always" : "eventually",
          child: this.wire(formula.subformula, captured),
          bound
        };
      }
      throw Error(
        "Expected a Bombadil formula. Use always, now, next, eventually, or their Boolean combinators."
      );
    }
    callback(id) {
      let response;
      runtime.startTracking();
      try {
        const thunk = this.thunks.get(id);
        if (!thunk) throw Error("Unknown predicate closure");
        const result = thunk.apply();
        const accessed = runtime.stopTracking();
        const observations = { ...thunk.captured };
        for (const index of accessed) {
          const cell = runtime.extractors[index];
          const key = cell.name ?? String(index);
          observations[`${key}@${this.time}ms`] = this.observations[key];
        }
        response = { formula: this.wire(result, observations), observations };
      } catch (error) {
        runtime.stopTracking();
        response = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
      const { p, n } = this.write(response);
      return BigInt(n) << 32n | BigInt(p);
    }
    initialize(sources) {
      this.thunks.clear();
      this.thunkIds = /* @__PURE__ */ new WeakMap();
      this.nextId = 0;
      runtime.extractors.length = 0;
      this.cells = {};
      for (const name of [
        "ready",
        "todos",
        "visible",
        "remaining",
        "filter",
        "lastAction"
      ])
        this.cells[name] = extract((state) => state[name]).named(name);
      const bindings = {
        always,
        now,
        next,
        eventually,
        not,
        ...this.cells
      };
      const properties = {};
      for (const [name, source] of Object.entries(sources)) {
        try {
          const formula = new Function(
            ...Object.keys(bindings),
            `"use strict";return (${source}
);`
          )(...Object.values(bindings));
          properties[name] = this.wire(formula);
        } catch (error) {
          throw Error(
            `${Object.keys(sources).length === 1 ? "Test expression" : `Test \u201C${name}\u201D`}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      this.call({ kind: "init", properties });
    }
    step(observation, time) {
      if (!Number.isSafeInteger(time) || time < 0)
        throw Error("Invalid observation timestamp");
      this.time = time;
      this.observations = observation;
      runtime.runExtractors(observation);
      return this.call({ kind: "step", time });
    }
    dispose() {
      this.call({ kind: "dispose" });
      this.thunks.clear();
      runtime.extractors.length = 0;
    }
  };

  // src/worker.ts
  var evaluator;
  var queue = Promise.resolve();
  self.onmessage = (event) => {
    const { id, kind, sources, observation, time, entries, bytes } = event.data;
    queue = queue.then(async () => {
      try {
        let result;
        if (kind === "boot") {
          evaluator = await BrowserEvaluator.create(bytes);
          result = true;
        } else if (kind === "init") {
          evaluator.initialize(sources);
          result = true;
        } else if (kind === "step") result = evaluator.step(observation, time);
        else if (kind === "reevaluate") {
          evaluator.initialize(sources);
          result = entries.map(
            (entry) => evaluator.step(entry.observation, entry.time)
          );
        } else throw Error("Unknown evaluator request");
        self.postMessage({ id, result });
      } catch (error) {
        self.postMessage({
          id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  };
})();
//# sourceMappingURL=worker.js.map
