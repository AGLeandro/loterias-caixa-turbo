import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Checa a sintaxe de todo .js do projeto (inclusive os que dependem do navegador e não podem ser importados no Node).
const RAIZ = path.join(import.meta.dirname, "..");
const arquivos = ["extension", "tools", "tests"].flatMap((dir) =>
  fs.readdirSync(path.join(RAIZ, dir), { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(dir, f)),
);

test("encontra os scripts do projeto", () => {
  assert.ok(arquivos.includes(path.join("extension", "content.js")));
});

for (const arquivo of arquivos) {
  test(`sintaxe válida: ${arquivo.replaceAll("\\", "/")}`, () => {
    execFileSync(process.execPath, ["--check", path.join(RAIZ, arquivo)], { stdio: "pipe" });
  });
}
