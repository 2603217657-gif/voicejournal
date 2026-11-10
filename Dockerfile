FROM node:22-bookworm-slim AS node
FROM python:3.11-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# sherpa-onnx 的 onnxruntime 需要 libgomp，slim 镜像默认没有
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./
RUN python prepare_model.py
ENV HOST=0.0.0.0 PORT=8080 PYTHON_BIN=python SHERPA_MODEL_DIR=/app/models/sensevoice
EXPOSE 8080
CMD ["node", "server.js"]
