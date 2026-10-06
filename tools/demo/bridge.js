/* bridge.js - substitui as APIs chrome.* na página de demonstração.
 * O content script roda nesta página e o popup real roda num iframe; as mensagens
 * entre os dois passam por este barramento em memória, como passariam pelo Chrome.
 */
(function () {
  const bus = {
    url: "https://www.loteriasonline.caixa.gov.br/silce-web/#/mega-sena", // URL simulada da aba
    contentListeners: [],
    popupListeners: [],
    done: false,

    /** popup -> content (chrome.tabs.sendMessage) */
    toContent(msg) {
      return new Promise((resolve) => {
        let respondeu = false;
        for (const l of this.contentListeners) l(msg, {}, (r) => { respondeu = true; resolve(r); });
        if (!respondeu) resolve(undefined);
      });
    },

    /** content -> popup (chrome.runtime.sendMessage) */
    toPopup(msg) {
      this.popupListeners.forEach((l) => l(msg));
      if (msg && msg.fim) this.done = true; // sinaliza fim da execução para o gravador
      return Promise.resolve();
    },
  };
  window.__demoBus = bus;

  // API vista pelo content script (esta página)
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      runtime: {
        sendMessage: (m) => bus.toPopup(m),
        onMessage: { addListener: (fn) => bus.contentListeners.push(fn) },
      },
    },
  });
})();

/** API vista pelo popup (iframe). Chamado pelo stub injetado em popup.html pelo servidor de demonstração. */
window.__demoChromeParaPopup = function () {
  const bus = window.__demoBus;
  return {
    runtime: { onMessage: { addListener: (fn) => bus.popupListeners.push(fn) } },
    tabs: {
      query: async () => [{ id: 1, url: bus.url }],
      sendMessage: (_tabId, msg) => bus.toContent(msg),
    },
    scripting: { executeScript: async () => [] },
  };
};
