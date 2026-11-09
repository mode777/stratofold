// Extracts every ```ts block from README.md into a temporary tsconfig
// project and type-checks it against the package sources, so documented
// snippets cannot drift from the API.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync("README.md", "utf8");
const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
if (blocks.length === 0) {
  throw new Error("README.md has no ```ts snippets to check");
}

const dir = ".readme-check";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
try {
  blocks.forEach((block, index) => {
    writeFileSync(join(dir, `snippet-${index}.ts`), block);
  });
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ES2022",
          moduleResolution: "bundler",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: "..",
          paths: { "@stratofold/client": ["src/index.ts"] },
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );
  execFileSync(join("node_modules", ".bin", "tsc"), ["-p", dir], {
    stdio: "inherit",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`checked ${blocks.length} README snippet(s)`);
