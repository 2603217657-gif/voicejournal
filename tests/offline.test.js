const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("file-mode config disables API calls and browser support module works without Node globals", () => {
  const browser = vm.createContext({ window: { location: { protocol: "file:" } } });
  vm.runInContext(read("config.js"), browser);
  vm.runInContext(read("support.js"), browser);
  assert.equal(browser.window.TREEHOLE_CONFIG.chatEndpoint, null);
  assert.equal(browser.window.TREEHOLE_CONFIG.transcriptionEndpoint, null);
  assert.equal(browser.window.TREEHOLE_CONFIG.healthEndpoint, null);
  assert.deepEqual(Array.from(browser.TreeholeSupport.recommend("我今天状态不好")), ["music", "grounding"]);
});

test("actual offline reply function comforts negative states and prioritizes crisis", () => {
  const source = read("chat.js");
  const start = source.indexOf("function chooseReply(");
  const end = source.indexOf("async function getApiError(", start);
  assert.ok(start >= 0 && end > start);
  const browser = vm.createContext({ TreeholeSupport: require("../support.js") });
  vm.runInContext(source.slice(start, end), browser);
  assert.match(browser.chooseReply("我今天不开心").text, /不好受/);
  assert.match(browser.chooseReply("今天开心，但压力很大").text, /不好受/);
  assert.equal(browser.chooseReply("今天没有压力").crisis, false);
  assert.equal(browser.chooseReply("不想活了", "quiet").crisis, true);
  assert.match(browser.chooseReply("很难过", "no-advice").text, /不急着分析/);
});

test("offline scripts parse and every local recommendation has a matching page section", () => {
  for (const file of ["config.js", "support.js", "chat.js", "relax.js"]) new vm.Script(read(file), { filename: file });
  const html = read("relax.html");
  for (const [id, resource] of Object.entries(require("../support.js").resources)) {
    const url = new URL(resource.href, "file:///treehole/index.html");
    assert.ok(fs.existsSync(path.join(root, path.basename(url.pathname))));
    assert.equal(url.searchParams.get("activity"), id);
    assert.ok(html.includes(`id="${id}"`));
  }
});

test("Pages and the local server use same-origin API routes", () => {
  for (const hostname of ['voicejournal-4k2.pages.dev', 'preview.voicejournal-4k2.pages.dev', '127.0.0.1']) {
    const browser = vm.createContext({window:{location:{protocol:'https:', hostname}}});
    vm.runInContext(read('config.js'), browser);
    assert.equal(browser.window.TREEHOLE_CONFIG.chatEndpoint, '/api/chat');
  }
});
