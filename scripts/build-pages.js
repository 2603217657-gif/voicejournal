// Publish only browser assets; local server and model files stay out of Pages.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'chat.js', 'support.js', 'wav.js', 'relax.html', 'relax.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.writeFileSync(path.join(output, 'config.js'), 'window.TREEHOLE_CONFIG = { transcriptionEndpoint: null, chatEndpoint: null, healthEndpoint: null };\n');
console.log('Pages static demo built in dist/');
