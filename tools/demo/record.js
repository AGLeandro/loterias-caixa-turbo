/* record.js - grava docs/demo.gif a partir da página de demonstração (tools/demo/index.html).
 *
 *   npm run demo
 *
 * Sem dependências npm: sobe um servidor HTTP local, abre o Chrome headless via
 * DevTools Protocol (WebSocket nativo do Node 22+), captura quadros enquanto o
 * popup e o content script reais rodam no volante simulado e gera o GIF com ffmpeg.
 * Variáveis opcionais: CHROME_PATH, FFMPEG_PATH.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const SAIDA = path.join(RAIZ, "docs", "demo.gif");
const PORTA_HTTP = 4173;
const PORTA_CDP = 9333;
const LARGURA = 1180;
const ALTURA = 640;
const INTERVALO_MS = 100; // ~10 quadros por segundo
const SEGURAR_FIM_MS = 2500; // tempo que o quadro final fica na tela
const LIMITE_MS = 40000;

const CHROME = process.env.CHROME_PATH || {
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
}[process.platform];
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };

// No popup aberto com ?demo, a ponte chrome.* do iframe vem da página pai (bridge.js). Entra antes de qualquer script.
const PONTE_POPUP = '<script>Object.defineProperty(window, "chrome", { configurable: true, value: parent.__demoChromeParaPopup() });</script>';

/** Corpo servido para um arquivo; injeta a ponte no popup de demonstração. */
function corpoDe(arquivo, url) {
  const corpo = fs.readFileSync(arquivo);
  if (url.pathname !== "/extension/popup.html" || !url.searchParams.has("demo")) return corpo;
  return corpo.toString("utf8").replace("<head>", "<head>" + PONTE_POPUP);
}

/** Servidor estático da raiz do repositório. */
function iniciarServidor() {
  if (!fs.readFileSync(path.join(RAIZ, "extension", "popup.html"), "utf8").includes("<head>")) {
    throw new Error("popup.html sem <head>: não há onde injetar a ponte chrome.* da demonstração.");
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let arquivo = path.join(RAIZ, decodeURIComponent(url.pathname));
    if (!arquivo.startsWith(RAIZ)) return res.writeHead(403).end();
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).isDirectory()) arquivo = path.join(arquivo, "index.html");
    if (!fs.existsSync(arquivo)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    res.end(corpoDe(arquivo, url));
  });
  return new Promise((r) => server.listen(PORTA_HTTP, "127.0.0.1", () => r(server)));
}

/** Espera o Chrome subir, abre uma aba própria e devolve um cliente CDP mínimo. */
async function conectarCDP() {
  const base = `http://127.0.0.1:${PORTA_CDP}`;
  for (let i = 0; !(await fetch(`${base}/json/version`).then((r) => r.ok, () => false)); i++) {
    if (i === 50) throw new Error("Chrome não respondeu no DevTools Protocol.");
    await sleep(200);
  }
  // Aba própria: o alvo inicial do Chrome pode ser substituído durante a inicialização.
  const { webSocketDebuggerUrl } = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro; });

  let ultimoId = 0;
  const pendentes = new Map(); // id -> { ok, erro, method }
  ws.onmessage = (ev) => {
    const { id, result, error } = JSON.parse(ev.data);
    const p = pendentes.get(id);
    if (!p) return; // eventos sem id
    pendentes.delete(id);
    error ? p.erro(new Error(`${p.method}: ${error.message}`)) : p.ok(result);
  };
  const enviar = (method, params = {}) => new Promise((ok, erro) => {
    pendentes.set(++ultimoId, { ok, erro, method });
    ws.send(JSON.stringify({ id: ultimoId, method, params }));
  });
  return { enviar, fechar: () => ws.close() };
}

/** Abre a demonstração e salva quadros em `dir` até o fim da execução. Retorna [{ nome, t }]. */
async function capturarQuadros(cdp, dir) {
  await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: LARGURA, height: ALTURA, deviceScaleFactor: 1, mobile: false });
  await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await cdp.enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_HTTP}/tools/demo/?autoplay` });

  const quadros = [];
  const inicio = Date.now();
  let fimEm = null;
  while (!fimEm || Date.now() - fimEm < SEGURAR_FIM_MS) {
    if (Date.now() - inicio > LIMITE_MS) throw new Error("A demonstração não terminou dentro do tempo limite.");
    const t0 = Date.now();
    const shot = await cdp.enviar("Page.captureScreenshot", { format: "png" }).catch(() => null); // null enquanto troca de documento
    if (shot) {
      const nome = `f${String(quadros.length).padStart(4, "0")}.png`;
      fs.writeFileSync(path.join(dir, nome), Buffer.from(shot.data, "base64"));
      quadros.push({ nome, t: t0 - inicio });
    }
    if (!fimEm) {
      const { result } = await cdp.enviar("Runtime.evaluate", { expression: "!!window.__demoBus?.done", returnByValue: true });
      if (result.value) fimEm = Date.now();
    }
    await sleep(Math.max(0, INTERVALO_MS - (Date.now() - t0)));
  }
  return quadros;
}

/** Monta o GIF respeitando a duração real de cada quadro (concat demuxer do ffmpeg). */
function gerarGif(quadros, dir) {
  const ultimo = quadros[quadros.length - 1];
  const lista = quadros.map((q, i) => {
    const proximo = quadros[i + 1]?.t ?? q.t + SEGURAR_FIM_MS;
    return `file '${q.nome}'\nduration ${((proximo - q.t) / 1000).toFixed(3)}`;
  });
  fs.writeFileSync(path.join(dir, "lista.txt"), [...lista, `file '${ultimo.nome}'`, ""].join("\n"));

  const filtro = "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "lista.txt", "-vf", filtro, "-loop", "0", SAIDA], { cwd: dir, stdio: "inherit" });
}

async function main() {
  const server = await iniciarServidor();
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "lct-chrome-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lct-frames-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--mute-audio",
    `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`,
    `--window-size=${LARGURA},${ALTURA}`, "about:blank",
  ], { stdio: "ignore" });

  try {
    const cdp = await conectarCDP();
    const quadros = await capturarQuadros(cdp, dir);
    cdp.fechar();
    gerarGif(quadros, dir);
    const kb = Math.round(fs.statSync(SAIDA).size / 1024);
    console.log(`GIF gerado: ${path.relative(RAIZ, SAIDA)} (${quadros.length} quadros, ${kb} KB)`);
  } finally {
    chrome.kill();
    server.close();
    await sleep(300); // Chrome libera o perfil antes de apagarmos
    for (const d of [perfil, dir]) {
      try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* temporário; o SO limpa depois */ }
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
