import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "../extension/jogos.js";
import { parseSets, ehPortalCaixa, jogoDaUrl } from "../extension/validacao.js";

const { JOGOS } = globalThis;

const MEGA = JOGOS["mega-sena"];
const LOTO = JOGOS.lotofacil;

describe("parseSets - Mega-Sena", () => {
  test("aceita um conjunto válido e o devolve ordenado", () => {
    const { sets, erros } = parseSets("42 04 23 16 15 08", MEGA);
    assert.deepEqual(erros, []);
    assert.deepEqual(sets, [[4, 8, 15, 16, 23, 42]]);
  });

  test("aceita espaço, vírgula, ponto e ponto-e-vírgula como separadores", () => {
    const { sets, erros } = parseSets("01,02.03;04  05\t06", MEGA);
    assert.deepEqual(erros, []);
    assert.deepEqual(sets, [[1, 2, 3, 4, 5, 6]]);
  });

  test("ignora linhas em branco e aceita CRLF", () => {
    const { sets, erros } = parseSets("\r\n01 02 03 04 05 06\r\n\r\n   \r\n10 20 30 40 50 60\r\n", MEGA);
    assert.deepEqual(erros, []);
    assert.equal(sets.length, 2);
  });

  test("respeita os limites de quantidade de dezenas (6 a 15)", () => {
    assert.match(parseSets("01 02 03 04 05", MEGA).erros[0], /tem 5 dezenas \(precisa de 6 a 15\)/);
    const dezesseis = Array.from({ length: 16 }, (_, i) => i + 1).join(" ");
    assert.match(parseSets(dezesseis, MEGA).erros[0], /tem 16 dezenas/);
    const quinze = Array.from({ length: 15 }, (_, i) => i + 1).join(" ");
    assert.deepEqual(parseSets(quinze, MEGA).erros, []);
  });

  test("rejeita dezenas fora do volante", () => {
    assert.match(parseSets("00 02 03 04 05 06", MEGA).erros[0], /0 fora do intervalo 01-60/);
    assert.match(parseSets("01 02 03 04 05 61", MEGA).erros[0], /61 fora do intervalo 01-60/);
  });

  test("rejeita dezenas repetidas", () => {
    assert.match(parseSets("01 02 03 04 05 05", MEGA).erros[0], /número 5 repetido/);
  });

  test("rejeita tokens não numéricos e números com 3+ dígitos", () => {
    assert.match(parseSets("01 02 03 04 05 abc", MEGA).erros[0], /"abc" não é um número válido/);
    assert.match(parseSets("01 02 03 04 05 006", MEGA).erros[0], /"006" não é um número válido/);
    assert.match(parseSets("01 02 03 04 05 -6", MEGA).erros[0], /"-6" não é um número válido/);
  });

  test("informa o número da linha original mesmo com linhas em branco antes", () => {
    const { sets, erros } = parseSets("01 02 03 04 05 06\n\n01 02 03", MEGA);
    assert.equal(sets.length, 1);
    assert.deepEqual(erros.length, 1);
    assert.match(erros[0], /^Linha 3:/);
  });

  test("texto vazio não gera conjuntos nem erros", () => {
    assert.deepEqual(parseSets("", MEGA), { sets: [], erros: [] });
    assert.deepEqual(parseSets(undefined, MEGA), { sets: [], erros: [] });
  });
});

describe("parseSets - Lotofácil", () => {
  test("aceita de 15 a 20 dezenas entre 01 e 25", () => {
    const quinze = "01 02 03 05 07 08 10 11 13 14 17 19 20 22 25";
    const vinte = Array.from({ length: 20 }, (_, i) => i + 1).join(" ");
    const { sets, erros } = parseSets(`${quinze}\n${vinte}`, LOTO);
    assert.deepEqual(erros, []);
    assert.deepEqual(sets.map((s) => s.length), [15, 20]);
  });

  test("rejeita dezena 26 e conjuntos com menos de 15", () => {
    const comVinteSeis = "01 02 03 04 05 06 07 08 09 10 11 12 13 14 26";
    assert.match(parseSets(comVinteSeis, LOTO).erros[0], /26 fora do intervalo 01-25/);
    assert.match(parseSets("01 02 03 04 05 06", LOTO).erros[0], /precisa de 15 a 20/);
  });

  test("os exemplos exibidos no popup são válidos", () => {
    for (const jogo of Object.values(JOGOS)) {
      assert.deepEqual(parseSets(jogo.exemplo, jogo).erros, [], jogo.nome);
    }
  });
});

describe("ehPortalCaixa", () => {
  test("aceita o portal e subdomínios via HTTPS", () => {
    assert.equal(ehPortalCaixa("https://www.loteriasonline.caixa.gov.br/silce-web/#/mega-sena"), true);
    assert.equal(ehPortalCaixa("https://loteriasonline.caixa.gov.br/"), true);
  });

  test("rejeita URLs que só contêm o domínio em outro lugar", () => {
    assert.equal(ehPortalCaixa("https://exemplo.com/?r=loteriasonline.caixa.gov.br"), false);
    assert.equal(ehPortalCaixa("https://loteriasonline.caixa.gov.br.exemplo.com/"), false);
    assert.equal(ehPortalCaixa("https://fakeloteriasonline.caixa.gov.br/"), false);
  });

  test("rejeita HTTP, URLs inválidas e vazias", () => {
    assert.equal(ehPortalCaixa("http://www.loteriasonline.caixa.gov.br/"), false);
    assert.equal(ehPortalCaixa("chrome://extensions"), false);
    assert.equal(ehPortalCaixa(""), false);
    assert.equal(ehPortalCaixa(undefined), false); // aba sem permissão de host não expõe a URL
  });
});

describe("jogoDaUrl", () => {
  const base = "https://www.loteriasonline.caixa.gov.br/silce-web/";

  test("identifica o jogo pela rota", () => {
    assert.equal(jogoDaUrl(base + "#/mega-sena", JOGOS), "mega-sena");
    assert.equal(jogoDaUrl(base + "#/lotofacil", JOGOS), "lotofacil");
  });

  test("retorna null fora das páginas de aposta ou fora do portal", () => {
    assert.equal(jogoDaUrl(base + "#/home", JOGOS), null);
    assert.equal(jogoDaUrl("https://exemplo.com/#/mega-sena", JOGOS), null);
  });
});
