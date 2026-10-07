import { BrowserEvaluator } from "./evaluator";
let evaluator: BrowserEvaluator;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
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
        result = entries.map((entry: any) =>
          evaluator.step(entry.observation, entry.time),
        );
      } else throw Error("Unknown evaluator request");
      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
