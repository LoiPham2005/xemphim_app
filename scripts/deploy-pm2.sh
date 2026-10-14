#!/usr/bin/env bash
#
# Deploy lên VPS sử dụng PM2 (Process Manager).
#
#   ssh deploy@server
#   cd /var/www/xemphim && ./scripts/deploy-pm2.sh
#
# Ghi đè mặc định bằng biến môi trường:
#   APP_DIR=/srv/app ENV_FILE=/etc/xemphim/env ./scripts/deploy-pm2.sh

# -e dừng ngay khi có lệnh lỗi, -u báo lỗi khi dùng biến chưa khai báo,
# pipefail để lỗi giữa pipe không bị nuốt.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/xemphim}"
ENV_FILE="${ENV_FILE:-/etc/xemphim/env}"
ECOSYSTEM_FILE="${ECOSYSTEM_FILE:-ecosystem.config.cjs}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Kiểm tra công cụ pm2
command -v pm2 >/dev/null || fail "Không tìm thấy PM2. Hãy cài đặt: npm install -g pm2 hoặc pnpm add -g pm2"

# Vào thư mục ứng dụng (nếu tồn tại APP_DIR thì cd vào, nếu không thì dùng thư mục hiện tại)
if [ -d "$APP_DIR" ]; then
	cd "$APP_DIR" || fail "Không vào được $APP_DIR"
fi

# Nạp biến môi trường từ ENV_FILE hoặc .env cục bộ
if [ -f "$ENV_FILE" ]; then
	step "Nạp biến môi trường từ $ENV_FILE"
	set -a
	# shellcheck disable=SC1090
	. "$ENV_FILE"
	set +a
elif [ -f .env ]; then
	step "Nạp biến môi trường từ .env"
	set -a
	# shellcheck disable=SC1091
	. .env
	set +a
else
	fail "Không tìm thấy file biến môi trường ($ENV_FILE hoặc .env)"
fi

step "Lấy mã nguồn mới nhất"
# --ff-only: nếu lịch sử đã rẽ nhánh thì dừng lại, đừng tự merge trên production
git pull --ff-only

step "Cài dependencies"
corepack enable
pnpm install --frozen-lockfile

step "Áp migration database"
pnpm db:deploy

step "Build Next.js"
pnpm build

if [ -d "realtime" ]; then
	step "Build Realtime Service"
	pnpm realtime:build
fi

if [ -d "worker" ]; then
	step "Build Worker (job nền)"
	pnpm worker:build
fi

step "Khởi động / Reload PM2"
if [ -f "$ECOSYSTEM_FILE" ]; then
	pm2 startOrReload "$ECOSYSTEM_FILE" --env production --update-env

	# Gỡ tiến trình vừa bị tắt bằng cờ (QUEUE_ENABLED / REALTIME_ENABLED).
	#
	# `pm2 startOrReload` CHỈ đụng tới app có trong file cấu hình. App đã bị lọc
	# ra khỏi `ecosystem.config.cjs` thì nó không biết tới, nên tiến trình cũ
	# vẫn chạy tiếp như chưa có gì xảy ra — đúng thứ ta vừa bảo nó tắt, và
	# `pm2 list` vẫn hiện "online" nên chẳng ai nghi ngờ.
	#
	# Docker không có vấn đề này (`replicas: 0` là compose tự gỡ container),
	# systemd thì phải `systemctl disable --now`. Chỉ PM2 cần dọn tay.
	configured=$(node -e 'console.log(require("./ecosystem.config.cjs").apps.map((a) => a.name).join(" "))')
	for app in xemphim-realtime xemphim-worker; do
		case " $configured " in
		*" $app "*) ;;
		*)
			if pm2 delete "$app" >/dev/null 2>&1; then
				printf '  đã gỡ %s (bị tắt bằng cờ)\n' "$app"
			fi
			;;
		esac
	done

	pm2 save
else
	fail "Không tìm thấy file cấu hình PM2: $ECOSYSTEM_FILE"
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

printf '\n\033[1;31m✗ Service không phản hồi sau 60 giây.\033[0m\n' >&2
pm2 logs --lines 40 --nostream >&2 || true
exit 1
