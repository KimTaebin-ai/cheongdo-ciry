#!/usr/bin/env bash
# 재배포: 로컬 buildx(linux/amd64) 빌드 → ACR push → Container Apps 이미지 교체 → /health 확인.
#
# 로컬 빌드를 쓰는 이유: 무료 구독에서는 ACR Tasks가 막혀 있어
# `az acr build`와 `az containerapp up --source`(ACR Tasks로 원격 빌드)를 쓸 수 없다.
# 그래서 로컬 Docker buildx로 amd64 이미지를 만들어 ACR에 직접 push한다.
#
# 사전 조건: az login, 구독 선택, docker buildx 사용 가능.
#
# Copilot 토큰 secret은 최초 1회만 등록한다(이미 등록돼 있으면 생략).
# 토큰 값은 이 파일·커밋·셸 히스토리에 남기지 말 것.
#   az containerapp secret set -n "$APP_NAME" -g "$RESOURCE_GROUP" --secrets copilot-token=<토큰>
#   az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" \
#     --set-env-vars COPILOT_GITHUB_TOKEN=secretref:copilot-token
#
# 사용법: infra/deploy.sh
#   덮어쓰기: RESOURCE_GROUP=... APP_NAME=... ACR_NAME=... IMAGE_REPO=... TAG=... infra/deploy.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

RESOURCE_GROUP="${RESOURCE_GROUP:-cheongdo-rg}"
APP_NAME="${APP_NAME:-cheongdo-ciry}"
ACR_NAME="${ACR_NAME:-ca827d321e2cacr}"
IMAGE_REPO="${IMAGE_REPO:-cheongdo-ciry}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_REPO}:${TAG}"

if [ -n "$(git status --porcelain)" ]; then
  echo "경고: 커밋되지 않은 변경이 있어 태그 ${TAG}가 이미지 내용과 다를 수 있습니다." >&2
fi

echo "==> ACR 로그인: ${ACR_NAME}"
az acr login --name "$ACR_NAME"

echo "==> 빌드·push: ${IMAGE}"
docker buildx build --platform linux/amd64 -t "$IMAGE" --push .

echo "==> Container App 이미지 교체: ${APP_NAME}"
az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --image "$IMAGE" -o none

DEPLOYED="$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].image" -o tsv)"
if [ "$DEPLOYED" != "$IMAGE" ]; then
  echo "실패: 배포된 이미지가 ${DEPLOYED} 입니다(기대값 ${IMAGE})." >&2
  exit 1
fi

FQDN="$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)"
echo "==> 헬스 체크: https://${FQDN}/health"
curl -fsS --retry 10 --retry-delay 6 --retry-all-errors "https://${FQDN}/health"
echo
echo "완료: ${IMAGE}"
