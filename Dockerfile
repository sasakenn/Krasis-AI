# フロントエンドをビルドしてから、バックエンド(FastAPI)単体で
# API・画面の両方を同一オリジンから配信する(README「本番ビルドを単一プロセスで配信する場合」を参照)。

FROM node:24-slim AS frontend-build
WORKDIR /app/frontend

# VITE_*はビルド時にJSバンドルへ埋め込まれる値(すべて公開情報のOAuthクライアントID/URLで、
# 秘密情報ではない)。RenderはダッシュボードのEnvironment Variablesを同名のDocker build
# argsとして自動的に渡してくれるので、Renderの環境変数に設定するだけで反映される。
ARG VITE_APPLE_CLIENT_ID
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GITHUB_CLIENT_ID
ARG VITE_GITHUB_REDIRECT_URI
ARG VITE_MICROSOFT_CLIENT_ID
ARG VITE_MICROSOFT_REDIRECT_URI
ENV VITE_APPLE_CLIENT_ID=$VITE_APPLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID
ENV VITE_GITHUB_REDIRECT_URI=$VITE_GITHUB_REDIRECT_URI
ENV VITE_MICROSOFT_CLIENT_ID=$VITE_MICROSOFT_CLIENT_ID
ENV VITE_MICROSOFT_REDIRECT_URI=$VITE_MICROSOFT_REDIRECT_URI

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
