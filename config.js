const isOfflineFile = window.location.protocol === "file:";
// Pages Direct Upload serves static assets, without the local Node API.
const isStaticPages = /(^|\.)pages\.dev$/i.test(window.location.hostname || "");
const useLocalApi = !isOfflineFile && !isStaticPages;
window.TREEHOLE_CONFIG = {
  transcriptionEndpoint: useLocalApi ? "/api/transcribe" : null,
  chatEndpoint: useLocalApi ? "/api/chat" : null,
  healthEndpoint: useLocalApi ? "/api/health" : null,
};
