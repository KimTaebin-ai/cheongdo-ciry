FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# 배포 이미지는 실제 백엔드(에이전트·SQLite·알림)에 연결한다. 데모 모드는 로컬 프런트 단독 실행용.
ENV VITE_APP_MODE=api
RUN npm run build

FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend-build /app/frontend/dist /app/static

ENV PORT=8000
ENV STATIC_DIR=/app/static
# 메인 프로세스와 MCP stdio 서버 프로세스가 같은 SQLite 파일을 연다.
ENV DB_PATH=/app/data.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
