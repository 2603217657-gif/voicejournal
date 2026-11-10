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

本地运行仍使用 server.js 和 .env。Cloudflare 不运行本机 Python/SenseVoice；云端语音暂依赖浏览器支持。云端对话会发送给模型服务商，网页已有对应说明。

API 密钥不能放在网页代码或 GitHub 中。公开站点上线后应根据使用范围添加访问控制与服务商用量限制；当前接口没有用户鉴权或分布式限流。

不要提交 .env、.venv、models、node_modules、__pycache__、dist 或生成的 ZIP。可以提交 .env.example。

旧 Direct Upload 项目不能原地转换为 Git 集成，需另建 Pages 项目。
