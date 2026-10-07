import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const binary = process.env.BOMBADIL_BIN || "bombadil";
for (const fixed of [false, true]) {
  const output = await mkdtemp(join(tmpdir(), "bombadil-native-"));
  const run = spawnSync(
    binary,
    [
      "browser",
      "test",
      `http://127.0.0.1:4173/todomvc.html${fixed ? "?fixed=1" : ""}`,
      "tests/native.spec.ts",
      "--headless",
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "--time-limit=3s",
      "--exit-on-violation",
      "--output-path",
      output,
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        ...(process.env.CI
          ? { CHROME: process.env.CHROME || chromium.executablePath() }
          : {}),
      },
    },
  );
  console.log(run.stdout);
  console.log(run.stderr);
  if (run.error) throw run.error;
  assert.equal(
    run.status,
    fixed ? 0 : 2,
    `${fixed ? "Fixed" : "Buggy"} native run exited unexpectedly`,
  );
  if (!fixed)
    assert.match(
      run.stdout + run.stderr,
      /persistence/,
      "Must fail the persistence property",
    );
  const trace = await readFile(join(output, "trace.jsonl"), "utf8");
  assert.match(trace, /Reload/, "The native driver must actually reload");
  console.log(
    `${fixed ? "Fixed" : "Buggy"} app: expected native result; trace at ${output}`,
  );
}
