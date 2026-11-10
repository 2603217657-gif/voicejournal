const isOfflineFile = window.location.protocol === "file:";
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(window.location.hostname || "");
window.TREEHOLE_CONFIG = {
  transcriptionEndpoint: isOfflineFile ? null : "/api/transcribe",
  chatEndpoint: isOfflineFile ? null : "/api/chat",
  healthEndpoint: isOfflineFile ? null : "/api/health",
  asrMode: isOfflineFile ? "none" : isLocalHost ? "local" : "cloud",
};
