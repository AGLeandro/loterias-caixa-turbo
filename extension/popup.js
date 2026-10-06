/* popup.js - interface da extensão.
 * Responsável por:
 *  - escolher o jogo (Mega-Sena ou Lotofácil; regras em jogos.js);
 *  - validar os conjuntos digitados (regras puras em validacao.js);
 *  - garantir que o content script esteja injetado na aba ativa;
 *  - enviar os conjuntos para o content script iniciar a automação;
 *  - exibir o progresso recebido de volta.
 */

const { HOST_PORTAL, parseSets, ehPortalCaixa, jogoDaUrl } = Validacao;

const el = (id) => document.getElementById(id);
const startBtn = el("start");
const stopBtn = el("stop");
const statusBox = el("status");

/** Id do jogo marcado no seletor ("mega-sena" | "lotofacil"). */
const jogoSelecionado = () => document.querySelector('input[name="jogo"]:checked').value;

/** Atualiza textos de ajuda e exemplo conforme o jogo escolhido. */
function aplicarJogo() {
  const jogo = JOGOS[jogoSelecionado()];
  el("faixa").textContent = `${jogo.minDezenas} a ${jogo.maxDezenas} dezenas`;
  el("maior").textContent = String(jogo.maiorDezena);
  el("sets").placeholder = "Ex.:\n" + jogo.exemplo;
  document.querySelectorAll(".nome-jogo").forEach((s) => { s.textContent = jogo.nome; });
}

/** Alterna os botões entre "executando" e "parado". */
function emExecucao(sim) {
  startBtn.disabled = sim;
  stopBtn.disabled = !sim;
}

/** Escreve uma mensagem no painel de status. */
function log(msg, cls) {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;
}
function resetStatus() { statusBox.textContent = ""; }

/** Retorna a aba ativa da janela atual. */
async function getAbaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

/** Faz um "ping" no content script. Retorna a resposta ou null se não houver ninguém ouvindo. */
async function ping(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { tipo: "ping" });
    return r && r.ok ? r : null;
  } catch (_) {
    return null;
  }
}

/**
 * Garante que o content script esteja rodando na aba.
 * Faz um "ping"; se não responder, injeta jogos.js + content.js e tenta de novo.
 */
async function garantirContentScript(tabId) {
  if (await ping(tabId)) return true;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["jogos.js", "content.js"] });
  } catch (e) {
    log("Não foi possível injetar na página: " + e.message, "err");
    return false;
  }
  return !!(await ping(tabId));
}

/** Recebe atualizações de progresso vindas do content script. */
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.tipo !== "progresso") return;
  log(msg.texto, msg.nivel || null);
  if (msg.fim) emExecucao(false);
});

document.querySelectorAll('input[name="jogo"]').forEach((r) => r.addEventListener("change", aplicarJogo));

// Ao abrir o popup: seleciona o jogo da página aberta e restaura o estado se já houver execução em andamento.
aplicarJogo();
getAbaAtiva().then(async (aba) => {
  if (!aba) return;
  const id = jogoDaUrl(aba.url || "", JOGOS);
  if (id) {
    document.querySelector(`input[name="jogo"][value="${id}"]`).checked = true;
    aplicarJogo();
  }
  if (ehPortalCaixa(aba.url || "")) {
    const estado = await ping(aba.id);
    if (estado && estado.rodando) {
      emExecucao(true);
      resetStatus();
      log("Execução em andamento. Acompanhe o aviso na página.");
    }
  }
});

startBtn.addEventListener("click", async () => {
  resetStatus();

  const idJogo = jogoSelecionado();
  const jogo = JOGOS[idJogo];
  const { sets, erros } = parseSets(el("sets").value, jogo);

  if (erros.length) {
    erros.forEach((e) => log(e, "err"));
    return;
  }
  if (!sets.length) {
    log("Digite ao menos um conjunto de números.", "err");
    return;
  }

  const aba = await getAbaAtiva();
  if (!aba || !ehPortalCaixa(aba.url || "")) {
    log(`Abra a página da ${jogo.nome} em ${HOST_PORTAL} e tente de novo.`, "err");
    return;
  }

  log(`${jogo.nome}: ${sets.length} conjunto(s) validado(s). Iniciando...`, "ok");
  emExecucao(true);

  if (!(await garantirContentScript(aba.id))) {
    log(`A página não respondeu. Recarregue a página da ${jogo.nome} e tente novamente.`, "err");
    emExecucao(false);
    return;
  }

  try {
    await chrome.tabs.sendMessage(aba.id, { tipo: "iniciar", jogo: idJogo, sets });
  } catch (e) {
    log("Falha ao iniciar: " + e.message, "err");
    emExecucao(false);
  }
});

stopBtn.addEventListener("click", async () => {
  const aba = await getAbaAtiva();
  if (aba) {
    try { await chrome.tabs.sendMessage(aba.id, { tipo: "parar" }); } catch (_) {}
  }
  log("Solicitado: parar após o conjunto atual.", "err");
});
