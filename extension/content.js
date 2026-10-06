/* content.js - roda dentro da página de aposta (Mega-Sena ou Lotofácil) em loteriasonline.caixa.gov.br.
 * Depende de jogos.js (injetado antes) para as regras e seletores de cada jogo.
 * Recebe o jogo e os conjuntos do popup e executa, para cada conjunto:
 *   1) limpa o volante;
 *   2) ajusta a "Quantidade de números da aposta" para o tamanho do conjunto;
 *   3) marca as dezenas;
 *   4) confere a seleção;
 *   5) clica em "Colocar no Carrinho".
 * Reporta o progresso de volta ao popup e num aviso flutuante na própria página.
 *
 * Protocolo de mensagens (popup -> página): ping, iniciar { jogo, sets }, parar.
 * Página -> popup: progresso { texto, nivel?: "ok" | "err", fim?: true }.
 */

// Evita registrar tudo duas vezes caso o script seja injetado mais de uma vez.
if (!window.__megaLoteCarregado) {
  window.__megaLoteCarregado = true;

  // Id da célula de uma dezena no volante: "n01" .. "n60". Fonte única da regra.
  const idDezena = (n) => "n" + String(n).padStart(2, "0");

  // ---- Seletores da página (mapeados na própria página real) ----
  // Mega-Sena e Lotofácil usam os mesmos ids; só o botão "Limpar Volante" muda (vem de JOGOS).
  const SEL = {
    qtdDisplay: ".input-mais-menos > span.ng-binding", // mostra a quantidade atual (ex.: "6")
    qtdMais: "#aumentarnumero",
    qtdMenos: "#diminuirnumero",
    carrinho: "#colocarnocarrinho",
    dezena: (n) => "#" + idDezena(n), // #n01 .. #n60
  };

  // ---- Esperas (ms), calibradas no portal real para o AngularJS atualizar a tela ----
  const ESPERA = {
    aposLimpar: 250,
    aposCliqueQtd: 160,
    qtdIlegivel: 120,
    entreDezenas: 45,
    antesDeConferir: 300,
    aposCarrinho: 1600, // item entrar no carrinho / animação
  };
  const MAX_CLIQUES_QTD = 40; // suficiente para ir de qualquer valor a qualquer outro

  // Execução em andamento: null quando ociosa. Concentra todo o estado mutável do script.
  let execucao = null; // { jogo, parar: boolean }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Envia progresso para o popup (se estiver aberto) e para o aviso na página. */
  function progresso(texto, opcoes = {}) {
    // No MV3 sendMessage retorna uma Promise que rejeita quando o popup está fechado.
    chrome.runtime.sendMessage({ tipo: "progresso", texto, ...opcoes }).catch(() => {});
    mostrarAviso(texto, opcoes);
  }

  /** Clica de forma robusta disparando a sequência de eventos do mouse. */
  function clicar(elemento) {
    for (const tipo of ["mousedown", "mouseup", "click"]) {
      elemento.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
    }
  }

  /** Lê a quantidade de números atualmente configurada (null se ainda não renderizou). */
  function lerQtd() {
    const v = parseInt(document.querySelector(SEL.qtdDisplay)?.textContent ?? "", 10);
    return Number.isFinite(v) ? v : null;
  }

  /** Ajusta a quantidade de números para o alvo, clicando em + / - e relendo a tela a cada passo. */
  async function ajustarQtd(alvo) {
    const mais = document.querySelector(SEL.qtdMais);
    const menos = document.querySelector(SEL.qtdMenos);
    if (!mais || !menos) throw new Error("Controle de quantidade não encontrado.");

    for (let i = 0; i < MAX_CLIQUES_QTD; i++) {
      const atual = lerQtd();
      if (atual === alvo) return;
      if (atual === null) { await sleep(ESPERA.qtdIlegivel); continue; }
      clicar(atual < alvo ? mais : menos);
      await sleep(ESPERA.aposCliqueQtd);
    }
    if (lerQtd() !== alvo) throw new Error(`Não foi possível ajustar a quantidade para ${alvo}.`);
  }

  /** Limpa todas as marcações do volante. */
  async function limparVolante(jogo) {
    const btn = document.querySelector(jogo.limpar);
    if (btn) { clicar(btn); await sleep(ESPERA.aposLimpar); }
  }

  /** Ids das dezenas marcadas no momento (apenas células n01..n60), ordenados. */
  function marcadas() {
    return Array.from(document.querySelectorAll("a.selected"), (a) => a.id)
      .filter((id) => /^n\d{2}$/.test(id))
      .sort();
  }

  /** Marca as dezenas do conjunto, uma a uma. */
  async function marcarDezenas(dezenas) {
    for (const d of dezenas) {
      const cel = document.querySelector(SEL.dezena(d));
      if (!cel) throw new Error("Dezena " + d + " não encontrada na página.");
      if (!cel.classList.contains("selected")) {
        clicar(cel);
        await sleep(ESPERA.entreDezenas);
      }
    }
  }

  /** Processa um único conjunto; lança erro (sem enviar ao carrinho) se a seleção não conferir. */
  async function processarConjunto(jogo, dezenas, indice, total) {
    progresso(`Conjunto ${indice}/${total}: ${dezenas.length} dezenas...`);

    await limparVolante(jogo);
    await ajustarQtd(dezenas.length);
    await marcarDezenas(dezenas);
    await sleep(ESPERA.antesDeConferir);

    const atual = marcadas();
    if (atual.join() !== dezenas.map(idDezena).sort().join()) {
      throw new Error(`Seleção não confere no conjunto ${indice}. Marcado: [${atual.join(", ")}]. Nada foi enviado ao carrinho.`);
    }

    const btn = document.querySelector(SEL.carrinho);
    if (!btn) throw new Error('Botão "Colocar no Carrinho" não encontrado.');
    clicar(btn);
    await sleep(ESPERA.aposCarrinho);

    progresso(`Conjunto ${indice}/${total} adicionado ao carrinho.`, { nivel: "ok" });
  }

  /** Loop principal por todos os conjuntos. */
  async function executar(idJogo, sets) {
    if (execucao) return; // ignora um segundo "iniciar" enquanto já processa
    const jogo = globalThis.JOGOS[idJogo];
    execucao = { jogo, parar: false };
    let adicionados = 0;
    try {
      if (!jogo) throw new Error(`Jogo desconhecido: ${idJogo}.`);
      // O botão "Limpar Volante" é exclusivo de cada jogo: garante que a aba é a do jogo escolhido.
      if (!document.querySelector(jogo.limpar)) {
        throw new Error(`Esta página não é o volante da ${jogo.nome}. Abra a página da ${jogo.nome} e tente de novo.`);
      }

      for (const [i, dezenas] of sets.entries()) {
        if (execucao.parar) {
          progresso(`Interrompido pelo usuário. ${adicionados} conjunto(s) no carrinho.`, { nivel: "err", fim: true });
          return;
        }
        await processarConjunto(jogo, dezenas, i + 1, sets.length);
        adicionados++;
      }
      progresso(`Concluído! ${adicionados} conjunto(s) no carrinho. Revise e finalize o pagamento manualmente.`, { nivel: "ok", fim: true });
    } catch (e) {
      progresso("Erro: " + e.message, { nivel: "err", fim: true });
    } finally {
      execucao = null;
    }
  }

  // ---- Aviso flutuante na própria página ----
  const COR_AVISO = { ok: "#0a8f4d", err: "#b23b3b", padrao: "#0a5c36" };
  let avisoTimer = null;
  function mostrarAviso(texto, { nivel, fim }) {
    let box = document.getElementById("__megaLoteAviso");
    if (!box) {
      box = document.createElement("div");
      box.id = "__megaLoteAviso";
      box.setAttribute("role", "status");
      box.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:300px;" +
        "color:#fff;font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;" +
        "padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.3);";
      document.body.appendChild(box);
    }
    box.style.background = COR_AVISO[nivel] || COR_AVISO.padrao;
    const jogo = execucao?.jogo;
    box.textContent = "Loterias Caixa Turbo" + (jogo ? " · " + jogo.nome : "") + ": " + texto;

    // Ao terminar (concluído/erro/parado), remove o aviso após alguns segundos.
    clearTimeout(avisoTimer);
    avisoTimer = fim ? setTimeout(() => box.remove(), 6000) : null;
  }

  // ---- Mensagens do popup ----
  const ACOES = {
    // O ping também informa se há execução em andamento (o popup pode ter sido fechado e reaberto).
    ping: () => ({ ok: true, rodando: execucao !== null }),
    iniciar: (msg) => { executar(msg.jogo, msg.sets || []); return { ok: true }; },
    parar: () => { if (execucao) execucao.parar = true; return { ok: true }; },
  };
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const acao = ACOES[msg?.tipo];
    if (acao) sendResponse(acao(msg));
  });
}
