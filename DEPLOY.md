# GitHub → Cloudflare Pages + DeepSeek

仓库：https://github.com/2603217657-gif/voicejournal

1. 上传源码，保持 functions/api/chat.js、scripts、support.js、package.json 等位于仓库原有相对位置。不要上传 ZIP 本身；先解压，再上传其中的文件。
2. Cloudflare 新建 Pages → Connect to Git，选择这个仓库。
3. Framework: None；Build command: npm run build；Build output: dist；Root directory 留空；生产分支选择实际默认分支。
4. 在 Settings → Variables and Secrets 的生产环境添加：
   - AI_API_KEY：你的 DeepSeek API 密钥，类型选 Secret/加密。
   - AI_BASE_URL：https://api.deepseek.com
   - AI_CHAT_MODEL：deepseek-flash（或服务商当前支持的模型 ID）。
5. 保存配置后重新部署。Git 集成会部署根目录 functions，不要把它移动进 dist。

目前没有真实密钥调用验证。后端正常时返回 demo:false；配置缺失、密钥错误、余额不足会返回明确错误，不会悄悄伪装成真实模型回复。

本地运行仍使用 server.js 和 .env。Cloudflare 不运行本机 Python/SenseVoice；云端语音通过 Pages Functions 调用 Workers AI，浏览器负责将录音转为 WAV。云端音频与对话文字会分别交给配置的服务商处理。

## 本次语音功能合并的上传位置

从 `C:/Users/Qi/Desktop/ai-treehole/` 上传到上述 GitHub 仓库，保持相对路径：

- 根目录：`index.html`、`chat.js`、`styles.css`、`config.js`、`cues.js`、`server.js`、`DEPLOY.md`。
- `scripts/`：`build-pages.js`。
- `functions/api/`：新增 `transcribe.js`、`health.js`。保留原有 `chat.js`。
- `tests/`：`pages-function.test.js`、`cues.test.js`、`voice-ui.test.js`、`offline.test.js`、`server.test.js`（测试文件不参与页面发布，建议同步保存到仓库）。

不要覆盖或删除现有猫猫、封存相关文件；保留 `scripts/pages-chat.mjs` 和原有 AI 对话配置。无需上传 `dist`，Cloudflare 会自行构建。

在 Cloudflare 的 Workers & Pages 中打开对应 Pages 项目，进入 Settings → Bindings → Add，选择 Workers AI，变量名填写 `AI`，保存并重新部署。若需要预览部署也能转写，预览环境同样需要绑定。

构建设置保持：Framework None；Build command `npm run build`；Build output directory `dist`；Root directory 留空（项目在仓库根目录时）。

部署后访问 `/api/health`，应返回 `transcriptionConfigured: true`、`transcriptionEngine: "workers-ai"`。这仅代表配置存在，随后用手机 HTTPS 访问网页、允许麦克风权限，录一段中文确认真实转写；也可用“用录音文件”选择两分钟以内的音频。Whisper 只转写文字，浏览器补充的声音特征提示不等同于 SenseVoice 的情绪标签。

API 密钥不能放在网页代码或 GitHub 中。公开站点上线后应根据使用范围添加访问控制与服务商用量限制；当前接口没有用户鉴权或分布式限流。

不要提交 .env、.venv、models、node_modules、__pycache__、dist 或生成的 ZIP。可以提交 .env.example。

旧 Direct Upload 项目不能原地转换为 Git 集成，需另建 Pages 项目。
