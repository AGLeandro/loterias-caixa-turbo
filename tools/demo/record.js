/* record.js - grava docs/demo.gif a partir da página de demonstração (tools/demo/index.html).
 *
 *   npm run demo
 *
 * Sem dependências npm: sobe um servidor HTTP local, abre o Chrome headless via
 * DevTools Protocol (WebSocket nativo do Node 22+), captura quadros enquanto o
 * popup e o content script reais rodam no volante simulado e gera o GIF com ffmpeg.
 * Variáveis opcionais: CHROME_PATH, FFMPEG_PATH.
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const SAIDA = path.join(RAIZ, "docs", "demo.gif");
const PORTA_HTTP = 4173;
const PORTA_CDP = 9333;
const LARGURA = 1180;
const ALTURA = 640;
const INTERVALO_MS = 100; // ~10 quadros por segundo
const LIMITE_MS = 40000;

const CHROME = process.env.CHROME_PATH || {
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
}[process.platform];
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".css": "text/css" };

/** Servidor estático da raiz do repositório; injeta a ponte chrome.* no popup quando aberto com ?demo. */
function iniciarServidor() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let arquivo = path.join(RAIZ, decodeURIComponent(url.pathname));
    if (!arquivo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).isDirectory()) arquivo = path.join(arquivo, "index.html");
    if (!fs.existsSync(arquivo)) { res.writeHead(404).end(); return; }

    let corpo = fs.readFileSync(arquivo);
    if (url.pathname === "/extension/popup.html" && url.searchParams.has("demo")) {
      const stub = '<script>Object.defineProperty(window, "chrome", { configurable: true, value: parent.__demoChromeParaPopup() });</script>';
      corpo = corpo.toString("utf8").replace('<script src="jogos.js"></script>', stub + '<script src="jogos.js"></script>');
    }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    res.end(corpo);
  });
  return new Promise((r) => server.listen(PORTA_HTTP, "127.0.0.1", () => r(server)));
}

/** Cliente CDP mínimo sobre WebSocket. */
async function conectarCDP() {
  for (let i = 0; i < 50; i++) {
    try {
      // Cria uma aba própria: o alvo inicial do Chrome pode ser substituído durante a inicialização.
      const pagina = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?about:blank`, { method: "PUT" })).json();
      if (pagina && pagina.webSocketDebuggerUrl) {
        const ws = new WebSocket(pagina.webSocketDebuggerUrl);
        await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro; });
        let id = 0;
        const pendentes = new Map();
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pendentes.has(msg.id)) {
            const { ok, erro, metodo } = pendentes.get(msg.id);
            msg.metodo = metodo;
            pendentes.delete(msg.id);
            msg.error ? erro(new Error(msg.error.message + " (" + msg.metodo + ")")) : ok(msg.result);
          }
        };
        const enviar = (method, params = {}) => new Promise((ok, erro) => {
          pendentes.set(++id, { ok, erro, metodo: method });
          ws.send(JSON.stringify({ id, method, params }));
        });
        return { enviar, fechar: () => ws.close() };
      }
    } catch (_) { /* Chrome ainda subindo */ }
    await sleep(200);
  }
  throw new Error("Não foi possível conectar ao Chrome via DevTools Protocol.");
}

async function main() {
  const server = await iniciarServidor();
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "lct-chrome-"));
  const quadros = fs.mkdtempSync(path.join(os.tmpdir(), "lct-frames-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--mute-audio",
    `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`,
    `--window-size=${LARGURA},${ALTURA}`, "about:blank",
  ], { stdio: "ignore" });

  try {
    const cdp = await conectarCDP();
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: LARGURA, height: ALTURA, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await cdp.enviar("Page.enable");
    await cdp.enviar("Runtime.enable");
    await cdp.enviar("Page.navigate", { url: `http://127.0.0.1:${PORTA_HTTP}/tools/demo/?autoplay` });

    const lista = [];
    const inicio = Date.now();
    let fimEm = null;
    while (Date.now() - inicio < LIMITE_MS) {
      const t0 = Date.now();
      let data;
      try {
        ({ data } = await cdp.enviar("Page.captureScreenshot", { format: "png" }));
      } catch (_) { // página ainda trocando de documento
        await sleep(INTERVALO_MS);
        continue;
      }
      const nome = `f${String(lista.length).padStart(4, "0")}.png`;
      fs.writeFileSync(path.join(quadros, nome), Buffer.from(data, "base64"));
      lista.push({ nome, t: t0 - inicio });

      if (!fimEm) {
        const { result } = await cdp.enviar("Runtime.evaluate", { expression: "!!(window.__demoBus && window.__demoBus.done)", returnByValue: true });
        if (result.value) fimEm = Date.now();
      } else if (Date.now() - fimEm > 2500) {
        break; // segura o quadro final por alguns segundos
      }
      await sleep(Math.max(0, INTERVALO_MS - (Date.now() - t0)));
    }
    cdp.fechar();
    if (!fimEm) throw new Error("A demonstração não terminou dentro do tempo limite.");

    // Lista de quadros com a duração real de cada um (concat demuxer do ffmpeg).
    const concat = lista.map((q, i) => {
      const dur = ((lista[i + 1] ? lista[i + 1].t : q.t + 2500) - q.t) / 1000;
      return `file '${q.nome}'\nduration ${dur.toFixed(3)}`;
    }).join("\n") + `\nfile '${lista[lista.length - 1].nome}'\n`;
    fs.writeFileSync(path.join(quadros, "lista.txt"), concat);

    const filtro = "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "lista.txt", "-vf", filtro, "-loop", "0", SAIDA], { cwd: quadros, stdio: "inherit" });

    const kb = Math.round(fs.statSync(SAIDA).size / 1024);
    console.log(`GIF gerado: ${path.relative(RAIZ, SAIDA)} (${lista.length} quadros, ${kb} KB)`);
  } finally {
    chrome.kill();
    server.close();
    await sleep(300);
    for (const d of [perfil, quadros]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
