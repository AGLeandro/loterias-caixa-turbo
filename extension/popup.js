/* popup.js - interface da extensão.
 * Responsável por:
 *  - montar o seletor de jogos a partir de jogos.js (fonte única das loterias suportadas);
 *  - validar os conjuntos digitados (regras puras em validacao.js);
 *  - garantir que o content script esteja injetado na aba ativa;
 *  - enviar os conjuntos para o content script iniciar a automação;
 *  - exibir o progresso recebido de volta.
 */

import "./jogos.js";
import { HOST_PORTAL, parseSets, ehPortalCaixa, jogoDaUrl } from "./validacao.js";

const { JOGOS } = globalThis;
const el = (id) => document.getElementById(id);
const startBtn = el("start");
const stopBtn = el("stop");
const statusBox = el("status");

/** Cria um botão de rádio por jogo; o primeiro vem marcado. */
function montarSeletor() {
  Object.entries(JOGOS).forEach(([id, jogo], i) => {
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "jogo", value: id, checked: i === 0 });
    input.addEventListener("change", aplicarJogo);
    const label = document.createElement("label");
    label.append(input, " " + jogo.nome);
    el("jogos").appendChild(label);
  });
}

/** Id do jogo marcado no seletor. */
const jogoSelecionado = () => document.querySelector('input[name="jogo"]:checked').value;

/** Atualiza textos de ajuda e exemplo conforme o jogo escolhido. */
function aplicarJogo() {
  const jogo = JOGOS[jogoSelecionado()];
  el("faixa").textContent = `${jogo.minDezenas} a ${jogo.maxDezenas} dezenas`;
  el("maior").textContent = String(jogo.maiorDezena);
  el("sets").placeholder = "Ex.:\n" + jogo.exemplo;
  el("nome-jogo").textContent = jogo.nome;
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

/** Retorna a aba ativa da janela atual. */
async function getAbaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

/** Faz um "ping" no content script. Retorna a resposta ({ ok, rodando }) ou null se ninguém responder. */
async function ping(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { tipo: "ping" });
    return r && r.ok ? r : null;
  } catch (_) {
    return null;
  }
}

/**
 * Garante que o content script esteja rodando na aba; lança erro se não for possível.
 * Normalmente ele já foi carregado pelo manifest; a injeção cobre a extensão recarregada com a aba aberta.
 */
async function garantirContentScript(tabId, jogo) {
  if (await ping(tabId)) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["jogos.js", "content.js"] }).catch(() => {});
  if (!(await ping(tabId))) throw new Error(`A página não respondeu. Recarregue a página da ${jogo.nome} e tente novamente.`);
}

/** Valida a entrada e dispara a execução na aba ativa. */
async function iniciar() {
  statusBox.textContent = "";
  const idJogo = jogoSelecionado();
  const jogo = JOGOS[idJogo];
  const { sets, erros } = parseSets(el("sets").value, jogo);

  if (erros.length) return erros.forEach((e) => log(e, "err"));
  if (!sets.length) return log("Digite ao menos um conjunto de números.", "err");

  const aba = await getAbaAtiva();
  if (!aba || !ehPortalCaixa(aba.url)) return log(`Abra a página da ${jogo.nome} em ${HOST_PORTAL} e tente de novo.`, "err");

  log(`${jogo.nome}: ${sets.length} conjunto(s) validado(s). Iniciando...`, "ok");
  emExecucao(true);
  try {
    await garantirContentScript(aba.id, jogo);
    await chrome.tabs.sendMessage(aba.id, { tipo: "iniciar", jogo: idJogo, sets });
  } catch (e) {
    log(e.message, "err");
    emExecucao(false);
  }
}

async function parar() {
  const aba = await getAbaAtiva();
  if (aba) await chrome.tabs.sendMessage(aba.id, { tipo: "parar" }).catch(() => {});
  log("Solicitado: parar após o conjunto atual.", "err");
}

/** Ao abrir: seleciona o jogo da página aberta e restaura o estado se já houver execução em andamento. */
async function sincronizarComAba() {
  const aba = await getAbaAtiva();
  if (!aba) return;
  const id = jogoDaUrl(aba.url, JOGOS);
  if (id) {
    document.querySelector(`input[name="jogo"][value="${id}"]`).checked = true;
    aplicarJogo();
  }
  if ((await ping(aba.id))?.rodando) {
    emExecucao(true);
    statusBox.textContent = "";
    log("Execução em andamento. Acompanhe o aviso na página.");
  }
}

/** Progresso vindo do content script. */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tipo !== "progresso") return;
  log(msg.texto, msg.nivel);
  if (msg.fim) emExecucao(false);
});

startBtn.addEventListener("click", iniciar);
stopBtn.addEventListener("click", parar);
montarSeletor();
aplicarJogo();
sincronizarComAba();
