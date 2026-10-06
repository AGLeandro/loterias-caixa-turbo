/* jogos.js - regras e seletores de cada loteria suportada.
 * Script clássico (não módulo) porque também é content script: publica as regras em globalThis.JOGOS.
 * O popup e os testes o importam só pelo efeito colateral. Usa `||` para não quebrar se for injetado
 * mais de uma vez na mesma aba.
 * Para suportar um novo jogo, basta adicionar uma entrada aqui.
 */

globalThis.JOGOS = globalThis.JOGOS || {
  "mega-sena": {
    nome: "Mega-Sena",
    rota: "#/mega-sena",          // trecho (hash) da URL da página de aposta
    maiorDezena: 60,              // volante de 01 a 60
    minDezenas: 6,
    maxDezenas: 15,               // o site aceita até 20; aqui o limite é 15 por escolha de projeto
    limpar: "button.data-limpar-volante-mega-sena",
    exemplo: "04 08 15 16 23 42\n01 05 12 23 34 45 52\n07 09 13 21 33 44 51 58 60",
  },
  lotofacil: {
    nome: "Lotofácil",
    rota: "#/lotofacil",
    maiorDezena: 25,              // volante de 01 a 25
    minDezenas: 15,
    maxDezenas: 20,
    limpar: "button.data-limpar-volante-lotofacil",
    exemplo: "01 02 03 05 07 08 10 11 13 14 17 19 20 22 25\n02 03 04 06 07 09 10 12 13 15 16 18 20 21 23 24",
  },
};
