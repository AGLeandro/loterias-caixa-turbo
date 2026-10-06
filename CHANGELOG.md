# Changelog — Loterias Caixa Turbo

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [SemVer](https://semver.org/lang/pt-BR/).

## [1.2.0] - 2026-10-06

### Adicionado
- Nova identidade: **Loterias Caixa Turbo**, com ícones da extensão (16/32/48/128 px).
- Tema escuro no popup, seguindo `prefers-color-scheme`.
- Módulo `validacao.js` com as regras puras de validação, separado da UI.
- Suíte de testes com `node:test` (22 casos) e pipeline de CI no GitHub Actions.
- Release automatizada: tags `v*` geram um `.zip` pronto para instalar.
- Ao reabrir o popup durante uma execução, o estado (botões Iniciar/Parar) é restaurado.

### Corrigido
- Rejeição de Promise não tratada no content script quando o popup estava fechado (`chrome.runtime.sendMessage` no MV3).
- Verificação da aba agora compara o *hostname* em vez de procurar o domínio como trecho da URL.
- Campos do popup ilegíveis com o sistema em modo escuro.
- Acentuação de todas as mensagens exibidas ao usuário.

## [1.1.0]

- Versão base: apostas em lote da Mega-Sena (6 a 15 dezenas) e da Lotofácil (15 a 20 dezenas), com conferência da seleção antes de cada envio ao carrinho.
