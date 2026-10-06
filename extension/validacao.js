/* validacao.js - regras puras (sem DOM nem APIs do Chrome) usadas pelo popup.
 * Separado do popup.js para poder ser testado com `node --test`.
 */

(function (raiz) {
  const HOST_PORTAL = "loteriasonline.caixa.gov.br";

  /**
   * Converte o texto digitado em uma lista de conjuntos válidos para o jogo.
   * Aceita espaço, vírgula, ponto e ponto-e-vírgula como separadores.
   * Retorna { sets: number[][], erros: string[] }; cada conjunto vem ordenado.
   */
  function parseSets(texto, jogo) {
    const { minDezenas, maxDezenas, maiorDezena } = jogo;
    const faixa = "01-" + String(maiorDezena).padStart(2, "0");
    const sets = [];
    const erros = [];

    String(texto || "").split(/\r?\n/).forEach((linha, idx) => {
      const bruto = linha.trim();
      if (!bruto) return; // ignora linhas em branco

      const n = idx + 1;
      const partes = bruto.split(/[\s,.;]+/).filter(Boolean);
      const dezenas = [];

      for (const p of partes) {
        if (!/^\d{1,2}$/.test(p)) {
          erros.push(`Linha ${n}: "${p}" não é um número válido.`);
          return;
        }
        const v = parseInt(p, 10);
        if (v < 1 || v > maiorDezena) {
          erros.push(`Linha ${n}: ${v} fora do intervalo ${faixa}.`);
          return;
        }
        if (dezenas.includes(v)) {
          erros.push(`Linha ${n}: número ${v} repetido.`);
          return;
        }
        dezenas.push(v);
      }

      if (dezenas.length < minDezenas || dezenas.length > maxDezenas) {
        erros.push(`Linha ${n}: tem ${dezenas.length} dezenas (precisa de ${minDezenas} a ${maxDezenas}).`);
        return;
      }

      dezenas.sort((a, b) => a - b);
      sets.push(dezenas);
    });

    return { sets, erros };
  }

  /** true se a URL pertence ao portal Loterias Online da Caixa (confere o hostname, não um trecho da URL). */
  function ehPortalCaixa(url) {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && (hostname === HOST_PORTAL || hostname.endsWith("." + HOST_PORTAL));
    } catch (_) {
      return false;
    }
  }

  /** Id do jogo cuja rota aparece na URL (ex.: "#/lotofacil"), ou null. */
  function jogoDaUrl(url, jogos) {
    if (!ehPortalCaixa(url)) return null;
    const hash = new URL(url).hash;
    return Object.keys(jogos).find((id) => hash.startsWith(jogos[id].rota)) || null;
  }

  const api = { HOST_PORTAL, parseSets, ehPortalCaixa, jogoDaUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Validacao = api;
})(globalThis);
