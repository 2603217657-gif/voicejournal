const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

async function startServer(t, extraEnv = {}) {
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, "../server.js")], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", AI_API_KEY: "", AI_CHAT_MODEL: "", PYTHON_BIN: "treehole-test-no-python", ...extraEnv },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 10000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on("data", () => { clearTimeout(timeout); resolve(); });
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    async chat(content, mode = "warm") {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: [{ role: "user", content }] }),
      });
      assert.equal(response.status, 200);
      return response.json();
    },
  };
}

test("local demo serves resources and returns consistent recommendations", async (t) => {
  const server = await startServer(t);
  for (const url of ["/", "/support.js", "/relax.html?activity=music", "/relax.js", "/styles.css"]) {
    assert.equal((await fetch(server.base + url)).status, 200, url);
  }
  const low = await server.chat("我今天不开心");
  assert.match(low.text, /不好受/);
  assert.deepEqual(low.resourceIds, ["music", "grounding"]);
  assert.equal(low.demo, true);
  assert.deepEqual((await server.chat("焦虑得睡不着")).resourceIds, ["sleep", "music"]);
  assert.deepEqual((await server.chat("我没有压力")).resourceIds, []);
  assert.deepEqual((await server.chat("难过", "no-advice")).resourceIds, []);
  const crisis = await server.chat("我不想活了");
  assert.equal(crisis.crisis, true);
  assert.deepEqual(crisis.resourceIds, []);
});

test("configured AI retains curated recommendations and bypasses provider on crisis", async (t) => {
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "听起来你承受了不少，我在这里陪你。" } }] }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const server = await startServer(t, { AI_API_KEY: "test-only", AI_CHAT_MODEL: "mock", AI_CHAT_URL: `http://127.0.0.1:${provider.address().port}/chat` });
  const answer = await server.chat("最近焦虑，压力大");
  assert.deepEqual(answer.resourceIds, ["breathing", "grounding"]);
  assert.equal(answer.demo, false);
  assert.match(requests[0].messages[0].content, /请勿自行生成网址/);
  await server.chat("状态不好，不想活了");
  assert.equal(requests.length, 1);
});
