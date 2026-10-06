/* validacao.js - regras puras (sem DOM nem APIs do Chrome) usadas pelo popup.
 * Módulo ES: importado pelo popup e pelos testes (`node --test`).
 */

export const HOST_PORTAL = "loteriasonline.caixa.gov.br";

/**
 * Lê uma linha não vazia como conjunto de dezenas do jogo.
 * Aceita espaço, vírgula, ponto e ponto-e-vírgula como separadores.
 * Retorna { dezenas } (ordenadas) ou { erro }.
 */
function lerConjunto(linha, { minDezenas, maxDezenas, maiorDezena }) {
  const dezenas = new Set();
  for (const p of linha.split(/[\s,.;]+/).filter(Boolean)) {
    if (!/^\d{1,2}$/.test(p)) return { erro: `"${p}" não é um número válido.` };
    const v = Number(p);
    if (v < 1 || v > maiorDezena) return { erro: `${v} fora do intervalo 01-${String(maiorDezena).padStart(2, "0")}.` };
    if (dezenas.has(v)) return { erro: `número ${v} repetido.` };
    dezenas.add(v);
  }
  if (dezenas.size < minDezenas || dezenas.size > maxDezenas) {
    return { erro: `tem ${dezenas.size} dezenas (precisa de ${minDezenas} a ${maxDezenas}).` };
  }
  return { dezenas: [...dezenas].sort((a, b) => a - b) };
}

/**
 * Converte o texto digitado (um conjunto por linha) em conjuntos válidos para o jogo.
 * Linhas em branco são ignoradas; cada erro aponta a linha original.
 * Retorna { sets: number[][], erros: string[] }.
 */
export function parseSets(texto, jogo) {
  const sets = [];
  const erros = [];
  String(texto ?? "").split(/\r?\n/).forEach((linha, i) => {
    if (!linha.trim()) return;
    const { dezenas, erro } = lerConjunto(linha.trim(), jogo);
    if (erro) erros.push(`Linha ${i + 1}: ${erro}`);
    else sets.push(dezenas);
  });
  return { sets, erros };
}

/** URL já interpretada se pertencer ao portal da Caixa via HTTPS (confere o hostname, não um trecho da URL); senão null. */
function urlDoPortal(url) {
  try {
    const u = new URL(url);
    const doPortal = u.hostname === HOST_PORTAL || u.hostname.endsWith("." + HOST_PORTAL);
    return u.protocol === "https:" && doPortal ? u : null;
  } catch (_) {
    return null; // URL ausente ou inválida (ex.: aba sem permissão de host)
  }
}

export const ehPortalCaixa = (url) => urlDoPortal(url) !== null;

/** Id do jogo cuja rota abre o hash da URL (ex.: "#/lotofacil"), ou null. */
export function jogoDaUrl(url, jogos) {
  const u = urlDoPortal(url);
  return (u && Object.keys(jogos).find((id) => u.hash.startsWith(jogos[id].rota))) || null;
}
