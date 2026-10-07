import * as api from "@antithesishq/bombadil";
import type { Observation, Verdict } from "./model";

type Exports = {
  memory: WebAssembly.Memory;
  allocate: (n: number) => number;
  deallocate: (p: number, n: number) => void;
  process: (p: number, n: number) => bigint;
};
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export class BrowserEvaluator {
  private wasm!: Exports;
  private thunks = new Map<
    number,
    { apply: () => api.Formula; captured: Record<string, unknown> }
  >();
  private thunkIds = new WeakMap<api.Formula, number>();
  private nextId = 0;
  private time = 0;
  private cells: Record<string, any> = {};
  private observations: Record<string, unknown> = {};
  static async create(bytes: BufferSource) {
    const evaluator = new BrowserEvaluator();
    const { instance } = await WebAssembly.instantiate(bytes, {
      host: { evaluate: (id: number) => evaluator.callback(id) },
    });
    evaluator.wasm = instance.exports as unknown as Exports;
    return evaluator;
  }
  private write(value: unknown) {
    const bytes = encoder.encode(JSON.stringify(value));
    const p = this.wasm.allocate(bytes.length);
    new Uint8Array(this.wasm.memory.buffer, p, bytes.length).set(bytes);
    return { p, n: bytes.length };
  }
  private read(packed: bigint) {
    const p = Number(packed & 0xffffffffn),
      n = Number(packed >> 32n);
    try {
      return JSON.parse(
        decoder.decode(new Uint8Array(this.wasm.memory.buffer, p, n)),
      );
    } finally {
      this.wasm.deallocate(p, n);
    }
  }
  private call(value: unknown) {
    const { p, n } = this.write(value);
    try {
      const reply = this.read(this.wasm.process(p, n));
      if (reply.error) throw Error(reply.error);
      return reply;
    } finally {
      this.wasm.deallocate(p, n);
    }
  }
  private wire(
    formula: api.Formula,
    captured: Record<string, unknown> = {},
  ): any {
    if (formula instanceof api.Pure)
      return { op: "pure", value: formula.value, pretty: formula.toString() };
    if (formula instanceof api.Thunk) {
      let id = this.thunkIds.get(formula);
      if (id === undefined) {
        id = this.nextId++;
        this.thunks.set(id, {
          apply: formula.apply,
          captured: structuredClone(captured),
        });
        this.thunkIds.set(formula, id);
      }
      return { op: "thunk", id, pretty: formula.toString() };
    }
    if (formula instanceof api.Not)
      return { op: "not", child: this.wire(formula.subformula, captured) };
    if (
      formula instanceof api.And ||
      formula instanceof api.Or ||
      formula instanceof api.Implies
    )
      return {
        op:
          formula instanceof api.And
            ? "and"
            : formula instanceof api.Or
              ? "or"
              : "implies",
        left: this.wire(formula.left, captured),
        right: this.wire(formula.right, captured),
      };
    if (formula instanceof api.Next)
      return { op: "next", child: this.wire(formula.subformula, captured) };
    if (formula instanceof api.Always || formula instanceof api.Eventually) {
      const bound = formula.boundMillis;
      if (bound !== null && (!Number.isSafeInteger(bound) || bound < 0))
        throw Error("Time bounds must be non-negative whole milliseconds");
      return {
        op: formula instanceof api.Always ? "always" : "eventually",
        child: this.wire(formula.subformula, captured),
        bound,
      };
    }
    throw Error(
      "Expected a Bombadil formula. Use always, now, next, eventually, or their Boolean combinators.",
    );
  }
  private callback(id: number): bigint {
    let response;
    api.runtime.startTracking();
    try {
      const thunk = this.thunks.get(id);
      if (!thunk) throw Error("Unknown predicate closure");
      const result = thunk.apply();
      const accessed = api.runtime.stopTracking();
      const observations: Record<string, unknown> = { ...thunk.captured };
      for (const index of accessed) {
        const cell = api.runtime.extractors[index];
        const key = cell.name ?? String(index);
        observations[`${key}@${this.time}ms`] = this.observations[key];
      }
      response = { formula: this.wire(result, observations), observations };
    } catch (error) {
      api.runtime.stopTracking();
      response = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const { p, n } = this.write(response);
    return (BigInt(n) << 32n) | BigInt(p);
  }
  initialize(sources: Record<string, string>) {
    this.thunks.clear();
    this.thunkIds = new WeakMap();
    this.nextId = 0;
    api.runtime.extractors.length = 0;
    this.cells = {};
    for (const name of [
      "ready",
      "todos",
      "visible",
      "remaining",
      "filter",
      "lastAction",
    ])
      this.cells[name] = api
        .extract<any, any>((state) => state[name])
        .named(name);
    const bindings = {
      always: api.always,
      now: api.now,
      next: api.next,
      eventually: api.eventually,
      not: api.not,
      ...this.cells,
    };
    const properties: Record<string, unknown> = {};
    for (const [name, source] of Object.entries(sources)) {
      try {
        const formula = new Function(
          ...Object.keys(bindings),
          `"use strict";return (${source}\n);`,
        )(...Object.values(bindings));
        properties[name] = this.wire(formula);
      } catch (error) {
        throw Error(
          `${Object.keys(sources).length === 1 ? "Test expression" : `Test “${name}”`}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.call({ kind: "init", properties });
  }
  step(observation: Observation, time: number): Record<string, Verdict> {
    if (!Number.isSafeInteger(time) || time < 0)
      throw Error("Invalid observation timestamp");
    this.time = time;
    this.observations = observation as unknown as Record<string, unknown>;
    api.runtime.runExtractors(observation);
    return this.call({ kind: "step", time });
  }
  dispose() {
    this.call({ kind: "dispose" });
    this.thunks.clear();
    api.runtime.extractors.length = 0;
  }
}
