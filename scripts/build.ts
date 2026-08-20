import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });

const declarations = Bun.spawn(
  [
    process.execPath,
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "tsconfig.json"),
    "--emitDeclarationOnly",
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if ((await declarations.exited) !== 0) process.exit(1);

const result = await Bun.build({
  entrypoints: [
    resolve(root, "src/index.ts"),
    resolve(root, "src/protocol.ts"),
    resolve(root, "src/mcp.ts"),
    resolve(root, "src/integrations.ts"),
    resolve(root, "src/cli.ts"),
    resolve(root, "src/demo-integration-repair.ts"),
    resolve(root, "src/demo-ticket-policy.ts"),
  ],
  outdir: output,
  target: "node",
  format: "esm",
  minify: false,
  naming: "[name].[ext]",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
