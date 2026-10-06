import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "extension");
const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, "utf8"));
const manifest = lerJson(path.join(DIR, "manifest.json"));
const pkg = lerJson(path.join(import.meta.dirname, "..", "package.json"));

test("usa Manifest V3", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("versão do manifest acompanha o package.json", () => {
  assert.equal(manifest.version, pkg.version);
});

test("pede apenas as permissões necessárias", () => {
  assert.deepEqual(manifest.permissions, ["scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.loteriasonline.caixa.gov.br/*"]);
});

test("todos os arquivos referenciados existem", () => {
  const arquivos = [
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of arquivos) {
    assert.ok(fs.existsSync(path.join(DIR, f)), `arquivo ausente: ${f}`);
  }
});

test("jogos.js é carregado antes do content.js", () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf("jogos.js") < js.indexOf("content.js"));
});
