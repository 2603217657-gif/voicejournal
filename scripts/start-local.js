// 启动本地服务并打开网页。用 Node 做是因为 cmd 批处理在中文 Windows 上
// 极容易出现编码和换行问题（LF 换行会被 cmd 拆成碎片执行）。
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const pageUrl = `http://127.0.0.1:${port}/`;

function probe() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

function openPage() {
  if (process.env.NO_BROWSER) {
    console.log(`已跳过打开浏览器，请手动访问 ${pageUrl}`);
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", pageUrl], { stdio: "ignore", detached: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [pageUrl], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [pageUrl], { stdio: "ignore", detached: true }).unref();
  }
}

async function main() {
  if (await probe()) {
    console.log(`服务已经在运行，直接打开 ${pageUrl}`);
    openPage();
    return;
  }

  console.log("正在启动本地服务，首次加载语音模型需要几秒……");
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
  });

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await probe()) {
      ready = true;
      break;
    }
    if (server.exitCode !== null) break;
  }

  if (!ready) {
    console.error(`\n× 本地服务没有启动成功（端口 ${port} 可能被占用）。`);
    console.error("  可以先关掉占用该端口的程序，或用 set PORT=4174 换一个端口再运行。");
    server.kill();
    process.exitCode = 1;
    return;
  }

  console.log(`\n服务已就绪：${pageUrl}\n按 Ctrl+C 可以停止。`);
  openPage();
  server.on("exit", (code) => {
    process.exitCode = code === null ? 0 : code;
  });
}

main();
