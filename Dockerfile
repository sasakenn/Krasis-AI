# フロントエンドをビルドしてから、バックエンド(FastAPI)単体で
# API・画面の両方を同一オリジンから配信する(README「本番ビルドを単一プロセスで配信する場合」を参照)。

FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# SQLite(data/app.db)は永続ディスクをここにマウントする想定(render.yamlのdisk.mountPath)。
RUN mkdir -p /data
ENV DB_PATH=/data/app.db

EXPOSE 8000
CMD ["python", "app.py"]
