import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const names = process.argv.slice(2);
if (!names.length) {
  console.error("Pass explicit test names after inspecting their fixtures; this runner does not automatically execute every upstream platform test.");
  process.exit(2);
}
const checks = Object.entries(pkg.scripts).filter(([name, command]) => name.startsWith("test:") && command.startsWith("node ") && (!names.length || names.includes(name)));
const results = [];
for (const [name, command] of checks) {
  const start = Date.now();
  const args = command.split(" ").slice(1);
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60000, env: { ...process.env, UV_THREADPOOL_SIZE: "2" } });
  const row = { name, exitCode: result.status, durationMs: Date.now() - start, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  results.push(row);
  fs.writeFileSync(path.join(root, names.length ? "local-rechecks.json" : "local-checks.json"), JSON.stringify(results, null, 2));
  if (result.status !== 0) console.log(`FAIL ${name}: ${(result.stderr || result.stdout).slice(-1200)}`);
}
fs.writeFileSync(path.join(root, names.length ? "local-rechecks.json" : "local-checks.json"), JSON.stringify(results, null, 2));
const failed = results.filter((row) => row.exitCode !== 0);
console.log(`${results.length - failed.length}/${results.length} sequential checks passed`);
process.exitCode = failed.length ? 1 : 0;
