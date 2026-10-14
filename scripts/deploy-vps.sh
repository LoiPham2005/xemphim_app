#!/usr/bin/env bash
#
# Deploy lên VPS chạy trực tiếp (không Docker).
#
#   ssh deploy@server
#   cd /var/www/xemphim && ./scripts/deploy-vps.sh
#
# Ghi đè mặc định bằng biến môi trường:
#   APP_DIR=/srv/app SERVICE=my-app ./scripts/deploy-vps.sh

# -e dừng ngay khi có lệnh lỗi, -u báo lỗi khi dùng biến chưa khai báo,
# pipefail để lỗi giữa pipe không bị nuốt. Thiếu ba cờ này thì script deploy
# vẫn báo "thành công" dù bước migrate đã chết.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/xemphim}"
SERVICE="${SERVICE:-xemphim}"
# Tiến trình WebSocket chạy riêng. Đặt REALTIME_SERVICE= (rỗng) nếu dự án của
# bạn không dùng realtime.
REALTIME_SERVICE="${REALTIME_SERVICE:-xemphim-realtime}"
# Tiến trình chạy job nền. Đặt WORKER_SERVICE= (rỗng) nếu chưa dùng hàng đợi.
WORKER_SERVICE="${WORKER_SERVICE:-xemphim-worker}"
ENV_FILE="${ENV_FILE:-/etc/xemphim/env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR" || fail "Không vào được $APP_DIR"

# Nạp biến môi trường. Bước này bắt buộc: `prisma migrate deploy` và
# `next build` đều cần DATABASE_URL, mà file env nằm ngoài thư mục mã nguồn
# (xem deploy/xemphim.service).
if [ -f "$ENV_FILE" ]; then
	step "Nạp biến môi trường từ $ENV_FILE"
	set -a
	# shellcheck disable=SC1090
	. "$ENV_FILE"
	set +a
else
	fail "Không tìm thấy $ENV_FILE"
fi

step "Lấy mã nguồn mới nhất"
# --ff-only: nếu lịch sử đã rẽ nhánh thì dừng lại, đừng tự merge trên
# production rồi để lại một commit không ai review.
git pull --ff-only

step "Cài dependencies"
corepack enable
# KHÔNG dùng --prod: bước build cần devDependencies (next, typescript, prisma).
pnpm install --frozen-lockfile

step "Áp migration database"
# `migrate deploy` chỉ áp migration đã commit, không bao giờ tự sinh mới và
# không bao giờ hỏi gì — đúng thứ cần cho production. Khác hẳn `migrate dev`.
pnpm db:deploy

step "Build"
pnpm build

# Realtime được esbuild gói thành MỘT file `realtime/dist/server.cjs`. Bước này
# từng bị bỏ sót hoàn toàn: script chỉ build web, nên máy chủ WebSocket trên VPS
# mãi là bản cũ — hoặc chưa từng tồn tại.
if [ -d "realtime" ]; then
	step "Build realtime (WebSocket)"
	pnpm realtime:build
fi

if [ -d "worker" ]; then
	step "Build worker (job nền)"
	pnpm worker:build
fi

step "Khởi động lại service"
sudo systemctl restart "$SERVICE"

# Restart realtime SAU web, và chỉ khi unit đã được cài. Người cố ý không dùng
# realtime thì bỏ qua, không làm deploy đỏ vì một service họ không cần.
if [ -n "$REALTIME_SERVICE" ] && systemctl list-unit-files "$REALTIME_SERVICE.service" --no-legend 2>/dev/null | grep -q .; then
	step "Khởi động lại realtime"
	sudo systemctl restart "$REALTIME_SERVICE"
elif [ -n "$REALTIME_SERVICE" ]; then
	printf '  \033[1;33m⚠️  Chưa cài %s.service — WebSocket sẽ KHÔNG chạy.\033[0m\n' "$REALTIME_SERVICE"
	printf '     Cài: sudo cp deploy/xemphim-realtime.service /etc/systemd/system/\n'
fi

if [ -n "$WORKER_SERVICE" ] && systemctl list-unit-files "$WORKER_SERVICE.service" --no-legend 2>/dev/null | grep -q .; then
	step "Khởi động lại worker"
	sudo systemctl restart "$WORKER_SERVICE"
elif [ -n "$WORKER_SERVICE" ]; then
	printf '  \033[1;33m⚠️  Chưa cài %s.service — job nền sẽ nằm trong hàng đợi mà KHÔNG ai chạy.\033[0m\n' "$WORKER_SERVICE"
	printf '     Cài: sudo cp deploy/xemphim-worker.service /etc/systemd/system/\n'
fi

step "Kiểm tra sức khoẻ"
for attempt in $(seq 1 30); do
	if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
		printf '\n\033[1;32m✓ Deploy xong. Service đang khoẻ.\033[0m\n'
		curl -s "$HEALTH_URL"
		echo
		exit 0
	fi
	sleep 2
	printf '  chờ... (%s/30)\n' "$attempt"
done

# Không im lặng bỏ qua: service không lên được là deploy thất bại.
printf '\n\033[1;31m✗ Service không phản hồi sau 60 giây.\033[0m\n' >&2
journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
exit 1
