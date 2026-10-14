.PHONY: help setup install dev build start check lint lint-fix typecheck test test-watch \
        test-coverage format format-check \
        db-generate db-migrate db-migrate-create db-migrate-diff db-push db-deploy db-studio db-seed db-seed-prod db-init db-reset db-purge \
        docker-build docker-up docker-down docker-logs docker-ps \
        realtime docker-deploy docker-size docker-clean \
        vps-deploy vps-logs vps-status vps-files \
        pm2-deploy pm2-start pm2-stop pm2-restart pm2-reload pm2-logs pm2-status pm2-monit

help:
	@echo "========================================================================"
	@echo "                      BẢNG HƯỚNG DẪN CÁC LỆNH MAKE                      "
	@echo "========================================================================"
	@echo "--- BẮT ĐẦU ---"
	@echo "  make setup           - Cài deps + tạo .env + dựng Postgres Docker + db-init (chạy 1 lần)"
	@echo "  make db-init         - DB mới tinh đã có sẵn: generate + áp migration + seed"
	@echo ""
	@echo "--- PHÁT TRIỂN ---"
	@echo "  make install         - Cài đặt dependencies"
	@echo "  make dev             - Chạy dev server (http://localhost:3000)"
	@echo "  make start           - Chạy bản build production"
	@echo "  make realtime        - Chạy máy chủ WebSocket (tiến trình riêng, cổng 3002)"
	@echo "  make build           - Build production"
	@echo ""
	@echo "--- CHẤT LƯỢNG ---"
	@echo "  make check           - Chạy tất cả: typecheck + lint + format + test"
	@echo "  make typecheck       - Kiểm tra kiểu TypeScript"
	@echo "  make lint            - ESLint (make lint-fix để tự sửa)"
	@echo "  make test            - Unit test (test-watch / test-coverage)"
	@echo "  make format          - Prettier (format-check để chỉ kiểm tra)"
	@echo ""
	@echo "--- DATABASE ---"
	@echo "  make db-migrate      - Tạo migration mới và áp dụng (dev)"
	@echo "  make db-migrate-create - Tự sinh file SQL migration (không chạm vào DB)"
	@echo "  make db-migrate-diff - Xem trước mã SQL khác biệt giữa Database và schema.prisma"
	@echo "  make db-push         - Đẩy trực tiếp schema lên database (không tạo migration)"
	@echo "  make db-deploy       - Áp migration đã có (production)"
	@echo "  make db-generate     - Sinh Prisma Client"
	@echo "  make db-studio       - Mở Prisma Studio"
	@echo "  make db-seed         - Nạp dữ liệu mẫu"
	@echo "  make db-seed-prod    - Chỉ tạo tài khoản admin nền"
	@echo "  make db-reset        - XOÁ SẠCH database rồi tạo lại"
	@echo "  make db-purge        - Dọn refresh/verification token đã hết hạn"
	@echo ""
	@echo "--- HƯỚNG DẪN DEPLOY ĐẦY ĐỦ: docs/DEPLOY_VPS.md ---"
	@echo ""
	@echo "--- DEPLOY: DOCKER ---"
	@echo "  make docker-build    - Build image"
	@echo "  make docker-up       - Chạy postgres + migrate + web"
	@echo "  make docker-down     - Dừng và xoá container"
	@echo "  make docker-logs     - Xem log realtime"
	@echo "  make docker-ps       - Trạng thái container"
	@echo "  make docker-deploy   - Deploy trên VPS: build, up, health check, dọn rác"
	@echo "  make docker-size     - Xem dung lượng image và rác build còn sót"
	@echo "  make docker-clean    - Xoá image mồ côi do build lỗi (an toàn)"
	@echo ""
	@echo "--- DEPLOY: PM2 (Process Manager) ---"
	@echo "  make pm2-deploy      - Deploy trên VPS bằng PM2 (pull, deps, migrate, build, reload)"
	@echo "  make pm2-start       - Khởi động service bằng PM2"
	@echo "  make pm2-stop        - Dừng service PM2"
	@echo "  make pm2-restart     - Khởi động lại service PM2"
	@echo "  make pm2-reload      - Zero-downtime reload service PM2"
	@echo "  make pm2-logs        - Xem log PM2 realtime"
	@echo "  make pm2-status      - Xem trạng thái tiến trình PM2"
	@echo "  make pm2-monit       - Mở dashboard giám sát PM2"
	@echo ""
	@echo "--- DEPLOY: VPS TRỰC TIẾP (systemd + Caddy) ---"
	@echo "  make vps-deploy      - Deploy trên máy chủ (pull, migrate, build, restart)"
	@echo "  make vps-logs        - Xem log service qua journalctl"
	@echo "  make vps-status      - Trạng thái systemd service"
	@echo "  make vps-files       - In hướng dẫn cài systemd + Caddy lần đầu"
	@echo "========================================================================"

# Một lệnh duy nhất để có môi trường chạy được từ repo vừa clone.
setup:
	pnpm install
	@test -f .env || ( \
		cp .env.example .env && \
		secret=$$(openssl rand -base64 48 | tr -d '\n/+=') && \
		sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=\"$$secret\"|" .env && rm -f .env.bak && \
		echo "→ Đã tạo .env từ .env.example, SESSION_SECRET sinh ngẫu nhiên" )
	docker compose up -d postgres
	@echo "→ Đợi Postgres sẵn sàng..."
	@until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	@$(MAKE) --no-print-directory db-init
	@echo "→ Xong. Chạy 'make dev'."

# Database mới tinh (Docker hay tự dựng đều được) — DATABASE_URL trong .env phải trỏ đúng.
# Dùng migrate deploy, KHÔNG phải migrate dev: chỉ áp migration có sẵn trong repo,
# không sinh migration mới hay đòi reset nếu schema lệch.
db-init:
	pnpm db:init

install:
	pnpm install

dev:
	pnpm dev

start:
	pnpm start

realtime:
	pnpm realtime:dev

build:
	pnpm build

check:
	pnpm check

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

typecheck:
	pnpm typecheck

test:
	pnpm test

test-watch:
	pnpm test:watch

test-coverage:
	pnpm test:coverage

format:
	pnpm format

format-check:
	pnpm format:check

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-migrate-create:
	pnpm db:migrate:create

db-migrate-diff:
	pnpm db:migrate:diff

db-push:
	pnpm db:push

db-deploy:
	pnpm db:deploy

db-studio:
	pnpm db:studio

db-seed:
	pnpm db:seed

db-seed-prod:
	pnpm db:seed:prod

db-reset:
	pnpm db:reset

db-purge:
	pnpm db:purge

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-ps:
	docker compose ps

docker-deploy:
	./scripts/deploy-docker.sh

docker-size:
	@echo "── Image của dự án:"
	@docker images --format '   {{.Repository}}:{{.Tag}}\t{{.Size}}' | grep xemphim || echo "   (chưa build)"
	@echo "── Image mồ côi (mỗi lần build lỗi để lại một bản):"
	@echo "   số lượng: $$(docker images -f 'dangling=true' -q | wc -l | tr -d ' ')"
	@docker system df

# Mỗi lần `docker build` thất bại giữa chừng, các layer đã tạo trở thành image
# không tên (<none>) và nằm lại vĩnh viễn. Vài lần build lỗi là mất chục GB.
# Lệnh này CHỈ xoá image không được tag và không container nào dùng — image
# đang chạy và image có tên đều an toàn.
docker-clean:
	docker image prune -f
	docker builder prune -f

# --- PM2 -------------------------------------------------------------------
# Quản lý tiến trình bằng PM2 trên VPS

pm2-deploy:
	./scripts/deploy-pm2.sh

pm2-start:
	pm2 start ecosystem.config.cjs --env production

pm2-stop:
	pm2 stop ecosystem.config.cjs

pm2-restart:
	pm2 restart ecosystem.config.cjs --env production

pm2-reload:
	pm2 reload ecosystem.config.cjs --env production

pm2-logs:
	pm2 logs

pm2-status:
	pm2 status

pm2-monit:
	pm2 monit

# --- VPS trực tiếp (systemd + Caddy) ---------------------------------------
# Các target dưới đây chạy TRÊN MÁY CHỦ, không phải máy dev.

SERVICE ?= xemphim

vps-deploy:
	./scripts/deploy-vps.sh

vps-logs:
	journalctl -u $(SERVICE) -f

vps-status:
	systemctl status $(SERVICE) --no-pager

vps-files:
	@echo "Cài đặt lần đầu trên VPS:"
	@echo ""
	@echo "  sudo mkdir -p /etc/xemphim"
	@echo "  sudo cp .env.example /etc/xemphim/env   # rồi điền giá trị thật"
	@echo "  sudo chmod 600 /etc/xemphim/env"
	@echo ""
	@echo "  sudo cp deploy/xemphim.service deploy/xemphim-realtime.service /etc/systemd/system/"
	@echo "  sudo systemctl daemon-reload"
	@echo "  sudo systemctl enable --now $(SERVICE) $(SERVICE)-realtime"
	@echo "  # THIẾU unit realtime = web chạy nhưng WebSocket im lặng không tồn tại"
	@echo ""
	@echo "  sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # đổi example.com"
	@echo "  sudo systemctl reload caddy"
	@echo ""
	@echo "  # Dọn token hết hạn hằng ngày — hai bảng token chỉ tăng nếu thiếu bước này:"
	@echo "  sudo cp deploy/xemphim-purge.service deploy/xemphim-purge.timer /etc/systemd/system/"
	@echo "  sudo systemctl daemon-reload"
	@echo "  sudo systemctl enable --now xemphim-purge.timer"
	@echo ""
	@echo "VPS đã chạy nginx? Viết server block trỏ 127.0.0.1:3000, nhớ ghi đè X-Forwarded-For."
