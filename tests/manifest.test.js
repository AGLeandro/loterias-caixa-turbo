const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const pkg = require("../package.json");

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
