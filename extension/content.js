/* content.js - roda dentro da página de aposta (Mega-Sena ou Lotofácil) em loteriasonline.caixa.gov.br.
 * Depende de jogos.js (injetado antes) para as regras e seletores de cada jogo.
 * Recebe o jogo e os conjuntos do popup e executa, para cada conjunto:
 *   1) limpa o volante;
 *   2) ajusta a "Quantidade de números da aposta" para o tamanho do conjunto;
 *   3) marca as dezenas;
 *   4) confere a seleção;
 *   5) clica em "Colocar no Carrinho".
 * Reporta o progresso de volta ao popup e num aviso flutuante na própria página.
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

  let parar = false; // sinal de interrupção vindo do popup
  let rodando = false; // trava contra execuções simultâneas
  let jogo = null; // regras do jogo em execução (entrada de JOGOS)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Envia progresso para o popup (se estiver aberto) e para o aviso na página. */
  function progresso(texto, opcoes = {}) {
    // No MV3 sendMessage retorna uma Promise que rejeita quando o popup está fechado.
    chrome.runtime.sendMessage({ tipo: "progresso", texto, ...opcoes }).catch(() => {});
    mostrarAviso(texto, opcoes.nivel, opcoes.fim);
  }

  /** Clica de forma robusta disparando a sequência de eventos do mouse. */
  function clicar(elemento) {
    for (const tipo of ["mousedown", "mouseup", "click"]) {
      elemento.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
    }
  }

  /** Lê a quantidade de números atualmente configurada. */
  function lerQtd() {
    const span = document.querySelector(SEL.qtdDisplay);
    const v = span ? parseInt((span.textContent || "").trim(), 10) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  /** Ajusta a quantidade de números para o alvo, clicando em + / -. */
  async function ajustarQtd(alvo) {
    const mais = document.querySelector(SEL.qtdMais);
    const menos = document.querySelector(SEL.qtdMenos);
    if (!mais || !menos) throw new Error("Controle de quantidade não encontrado.");

    // no máximo ~40 cliques para chegar em qualquer valor do intervalo
    for (let i = 0; i < 40; i++) {
      const atual = lerQtd();
      if (atual === alvo) return true;
      if (atual === null) { await sleep(120); continue; }
      clicar(atual < alvo ? mais : menos);
      await sleep(160); // espera o Angular atualizar o número exibido
    }
    return lerQtd() === alvo;
  }

  /** Limpa todas as marcações do volante. */
  async function limparVolante() {
    const btn = document.querySelector(jogo.limpar);
    if (btn) { clicar(btn); await sleep(250); }
  }

  /** Ids das dezenas marcadas no momento (apenas células n01..n60). */
  function marcadas() {
    return Array.from(document.querySelectorAll("a.selected"))
      .map((a) => a.id)
      .filter((id) => /^n\d{2}$/.test(id));
  }

  /** Marca as dezenas do conjunto, uma a uma. */
  async function marcarDezenas(dezenas) {
    for (const d of dezenas) {
      const cel = document.querySelector(SEL.dezena(d));
      if (!cel) throw new Error("Dezena " + d + " não encontrada na página.");
      if (!cel.classList.contains("selected")) {
        clicar(cel);
        await sleep(45);
      }
    }
  }

  /** Confere se exatamente o conjunto pedido está marcado. */
  function conferirSelecao(dezenas) {
    const esperado = dezenas.map(idDezena).sort();
    const atual = marcadas().sort();
    if (atual.length !== esperado.length) return false;
    return esperado.every((id, i) => id === atual[i]);
  }

  /** Processa um único conjunto. Retorna true se foi para o carrinho. */
  async function processarConjunto(dezenas, indice, total) {
    progresso(`Conjunto ${indice}/${total}: ${dezenas.length} dezenas...`);

    await limparVolante();

    const okQtd = await ajustarQtd(dezenas.length);
    if (!okQtd) throw new Error(`Não foi possível ajustar a quantidade para ${dezenas.length}.`);

    await marcarDezenas(dezenas);
    await sleep(300);

    if (!conferirSelecao(dezenas)) {
      throw new Error(
        `Seleção não confere no conjunto ${indice}. Marcado: [${marcadas().join(", ")}]. Nada foi enviado ao carrinho.`
      );
    }

    const btn = document.querySelector(SEL.carrinho);
    if (!btn) throw new Error('Botão "Colocar no Carrinho" não encontrado.');
    clicar(btn);
    await sleep(1600); // espera o item entrar no carrinho / animação

    progresso(`Conjunto ${indice}/${total} adicionado ao carrinho.`, { nivel: "ok" });
    return true;
  }

  /** Loop principal por todos os conjuntos. */
  async function executar(idJogo, sets) {
    if (rodando) return; // ignora um segundo "iniciar" enquanto já processa
    rodando = true;
    parar = false;
    let adicionados = 0;
    try {
      jogo = globalThis.JOGOS && globalThis.JOGOS[idJogo];
      if (!jogo) throw new Error(`Jogo desconhecido: ${idJogo}.`);
      // O botão "Limpar Volante" é exclusivo de cada jogo: garante que a aba é a do jogo escolhido.
      if (!document.querySelector(jogo.limpar)) {
        throw new Error(`Esta página não é o volante da ${jogo.nome}. Abra a página da ${jogo.nome} e tente de novo.`);
      }

      for (let i = 0; i < sets.length; i++) {
        if (parar) {
          progresso(`Interrompido pelo usuário. ${adicionados} conjunto(s) no carrinho.`, { nivel: "err", fim: true });
          return;
        }
        await processarConjunto(sets[i], i + 1, sets.length);
        adicionados++;
      }
      progresso(`Concluído! ${adicionados} conjunto(s) no carrinho. Revise e finalize o pagamento manualmente.`, { nivel: "ok", fim: true });
    } catch (e) {
      progresso("Erro: " + e.message, { nivel: "err", fim: true });
    } finally {
      rodando = false;
    }
  }

  // ---- Aviso flutuante na própria página ----
  let avisoTimer = null;
  function mostrarAviso(texto, nivel, fim) {
    let box = document.getElementById("__megaLoteAviso");
    if (!box) {
      box = document.createElement("div");
      box.id = "__megaLoteAviso";
      box.setAttribute("role", "status");
      box.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:300px;" +
        "background:#0a5c36;color:#fff;font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;" +
        "padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.3);";
      document.body.appendChild(box);
    }
    box.style.background = nivel === "err" ? "#b23b3b" : (nivel === "ok" ? "#0a8f4d" : "#0a5c36");
    box.textContent = "Loterias Caixa Turbo" + (jogo ? " · " + jogo.nome : "") + ": " + texto;

    // Ao terminar (concluído/erro/parado), remove o aviso após alguns segundos.
    if (avisoTimer) { clearTimeout(avisoTimer); avisoTimer = null; }
    if (fim) {
      avisoTimer = setTimeout(() => { box.remove(); avisoTimer = null; }, 6000);
    }
  }

  // ---- Recebe mensagens do popup ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    // O ping também informa se há execução em andamento (o popup pode ter sido fechado e reaberto).
    if (msg.tipo === "ping") { sendResponse({ ok: true, rodando }); return; }
    if (msg.tipo === "iniciar") { executar(msg.jogo, msg.sets || []); sendResponse({ ok: true }); return; }
    if (msg.tipo === "parar") { parar = true; sendResponse({ ok: true }); return; }
  });
}
