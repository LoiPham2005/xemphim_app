#!/usr/bin/env bash
#
# Deploy lên VPS chạy bằng Docker.
#
#   ssh deploy@server
#   cd /srv/xemphim && ./scripts/deploy-docker.sh
#
# Ghi đè mặc định bằng biến môi trường:
#   HEALTH_URL=http://127.0.0.1:8080/api/health ./scripts/deploy-docker.sh
#   KEEP_OLD_IMAGES=1 ./scripts/deploy-docker.sh   # bỏ qua bước dọn rác

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
COMPOSE="${COMPOSE:-docker compose}"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v docker >/dev/null || fail "Không tìm thấy docker"
[ -f .env ] || fail "Thiếu .env — container cần SESSION_SECRET và DATABASE_URL"

step "Lấy mã nguồn mới nhất"
# --ff-only: lịch sử đã rẽ nhánh thì dừng, đừng tự merge trên production.
git pull --ff-only

step "Build image"
$COMPOSE build

step "Khởi động (migrate chạy trước, web đợi migrate xong)"
$COMPOSE up -d

step "Kiểm tra sức khoẻ"
healthy=0
for attempt in $(seq 1 30); do
	if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
		healthy=1
		break
	fi
	sleep 2
	printf '  chờ... (%s/30)\n' "$attempt"
done

if [ "$healthy" -eq 0 ]; then
	printf '\n\033[1;31m✗ Service không phản hồi sau 60 giây.\033[0m\n' >&2
	$COMPOSE logs --tail 40 web >&2 || true
	# KHÔNG dọn image ở đây: bản cũ là thứ duy nhất để rollback về.
	fail "Deploy thất bại. Rollback: $COMPOSE down && docker run <image cũ>"
fi

printf '\n\033[1;32m✓ Service khoẻ.\033[0m '
curl -s "$HEALTH_URL"
echo

# ---------------------------------------------------------------------------
# Dọn rác — bước này BẮT BUỘC với VPS, không phải tuỳ chọn.
#
# Mỗi lần build, image cũ mất tag và trở thành <none> nhưng vẫn chiếm đĩa. Trên
# VPS 20–40GB, deploy vài chục lần là đầy đĩa, và Docker hỏng khi hết chỗ chứ
# không báo trước.
#
# Chỉ chạy SAU KHI đã xác nhận service khoẻ: nếu deploy hỏng thì image cũ chính
# là đường lùi.
# ---------------------------------------------------------------------------
if [ "${KEEP_OLD_IMAGES:-0}" = "1" ]; then
	step "Bỏ qua dọn rác (KEEP_OLD_IMAGES=1)"
else
	step "Dọn image cũ và build cache"
	before=$(docker system df --format '{{.Reclaimable}}' 2>/dev/null | head -1 || echo "?")
	# `image prune -f` chỉ xoá image KHÔNG có tag và KHÔNG container nào dùng.
	# Image đang chạy và image có tên đều an toàn.
	docker image prune -f
	docker builder prune -f
	printf '   có thể thu hồi trước khi dọn: %s\n' "$before"
	docker system df
fi

printf '\n\033[1;32m✓ Deploy hoàn tất.\033[0m\n'
