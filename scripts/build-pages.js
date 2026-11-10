// Publish only browser assets; local server and model files stay out of Pages.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'chat.js', 'support.js', 'wav.js', 'cues.js', 'relax.html', 'relax.js', 'cat.js', 'cat-assets.js', 'pet-editor.js', 'vendor/omggif.js', 'vendor/omggif-LICENSE.txt']) {
  fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const pet of require('../cat-assets.js')) {
  for (const file of pet.frames) {
    if (!/^gif\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/.test(file) || file.split('/').includes('..')) throw new Error('Invalid pet frame path');
    fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(output, file));
  }
}
fs.writeFileSync(path.join(output, 'config.js'), 'window.TREEHOLE_CONFIG = { transcriptionEndpoint: "/api/transcribe", chatEndpoint: "/api/chat", healthEndpoint: "/api/health", asrMode: "cloud" };\n');
console.log('Pages static demo built in dist/');
