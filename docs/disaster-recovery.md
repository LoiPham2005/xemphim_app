# Disaster Recovery Runbook

Quy trình thực tế để khôi phục `xemphim` sau khi mất dữ liệu, deploy lỗi, hoặc VPS gặp
sự cố. Lệnh dưới giả định bạn đang SSH vào VPS, đứng tại `$APP_DIR` (mặc định
`/var/www/xemphim`, xem [`scripts/deploy-vps.sh`](../scripts/deploy-vps.sh)).

⚠️ **Khoảng trống lớn nhất hiện tại: chưa có backup tự động.** `docker-compose.yml` chưa có
service `backup` nào — Postgres tự host chỉ có dữ liệu trong volume `postgres_data`, VPS chết là
mất sạch. Xem [`HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md`](./HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md) mục
Database để biết cách thêm cron `pg_dump` đẩy lên R2/S3 — **nên làm trước khi có dữ liệu thật**,
runbook này giả định bạn đã có ít nhất 1 bản backup thủ công để phục hồi.

## Mục lục

1. [Khôi phục từ backup](#1-khôi-phục-từ-backup)
2. [Rollback deploy lỗi](#2-rollback-deploy-lỗi)
3. [Xoay vòng secret](#3-xoay-vòng-secret)
4. [Mất VPS hoàn toàn](#4-mất-vps-hoàn-toàn)
5. [Tự backup thủ công (tới khi có cron tự động)](#5-tự-backup-thủ-công)

---

## 1. Khôi phục từ backup

Dùng khi database bị hỏng, migration lỗi xoá nhầm dữ liệu, hoặc thao tác tay sai.

### 1.1 Nếu chạy qua Docker Compose

```sh
cd $APP_DIR
docker compose stop web migrate realtime   # giữ postgres sống để psql vào được
```

Khôi phục từ file dump đã có (`.sql.gz`, tự tải về từ nơi bạn lưu — R2/S3 nếu đã cấu hình theo
mục 5, hoặc file thủ công đã copy ra ngoài VPS):

```sh
zcat backup.sql.gz | docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Nếu Postgres báo còn connection đang mở, ngắt trước khi restore:

```sh
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB' AND pid <> pg_backend_pid();"
```

Khởi động lại và xác nhận:

```sh
docker compose up -d
curl -i http://127.0.0.1:3000/api/health
```

### 1.2 Nếu chạy bare-metal (systemd, theo `scripts/deploy-vps.sh`)

Postgres ở đây thường vẫn chạy qua Docker riêng (`docker compose up -d postgres`) dù app chạy
bare-metal — kiểm tra `DATABASE_URL` trong `/etc/xemphim/env` để biết chắc. Dừng app trước khi
restore:

```sh
sudo systemctl stop xemphim
zcat backup.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
sudo systemctl start xemphim
curl -i http://127.0.0.1:3000/api/health
```

### 1.3 Sau khi restore

Nếu bản dump cũ hơn migration đang chạy trên code hiện tại, áp migration còn thiếu:

```sh
pnpm db:deploy   # = prisma migrate deploy, chỉ áp migration đã commit
```

`/api/health` phải trả `200`. Nếu không, xem log (`docker compose logs web` hoặc
`journalctl -u xemphim -f`) và kiểm tra schema có khớp code đang chạy không.

---

## 2. Rollback deploy lỗi

Project **chưa có CD tự động rollback** khi healthcheck fail (khác với pipeline có auto-redeploy
tag trước đó) — mọi rollback ở đây đều làm **thủ công**.

### 2.1 Bare-metal (`scripts/deploy-vps.sh`)

Không dựa vào image tag (không dùng Docker cho app ở path này) — dựa vào **git commit**:

```sh
cd $APP_DIR
git log --oneline -10        # tìm commit tốt gần nhất trước khi lỗi
git checkout <commit-tot>    # hoặc git reset --hard <commit-tot> nếu chắc chắn không mất gì
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart xemphim
curl -i http://127.0.0.1:3000/api/health
```

Sau khi ổn định, nhớ xử lý dứt điểm trên `main` (revert commit lỗi) để lần deploy kế tiếp không
kéo lại đúng bug đó.

### 2.2 Docker Compose

```sh
cd $APP_DIR
git checkout <commit-tot>
docker compose build web migrate
docker compose up -d
curl -i http://127.0.0.1:3000/api/health
```

### 2.3 Rollback migration

**Prisma migration chỉ chạy tiến (forward-only)** — không có lệnh "undo" migration đã áp. Nếu bản
deploy lỗi có migration phá hoại dữ liệu (xoá cột, đổi kiểu...):

1. Khôi phục từ bản backup gần nhất TRƯỚC migration đó (Mục 1).
2. Revert migration lỗi trong code, tạo migration sửa lại, deploy lại bình thường.

---

## 3. Xoay vòng secret

### 3.1 `SESSION_SECRET`

⚠️ **Đổi giá trị này = huỷ hiệu lực TOÀN BỘ session đang đăng nhập ngay lập tức** — JWT ký bằng
khoá cũ không verify được với khoá mới nữa (xem `src/lib/session.ts`). Không có "grace period" nào
cả. Chỉ đổi khi thật sự nghi ngờ khoá bị lộ, và báo trước cho người dùng nếu có thể (mọi người sẽ
bị đăng xuất, phải đăng nhập lại).

```sh
# Sinh khoá mới
openssl rand -base64 48
```

Cập nhật `SESSION_SECRET` trong `/etc/xemphim/env` (bare-metal) hoặc `.env` (Docker), rồi:

```sh
sudo systemctl restart xemphim        # bare-metal
# hoặc
docker compose up -d --force-recreate web realtime   # Docker — realtime cũng verify JWT này
```

### 3.2 Mật khẩu Postgres

```sh
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "ALTER USER $POSTGRES_USER WITH PASSWORD 'gia-tri-moi';"
```

Cập nhật `POSTGRES_PASSWORD`/`DATABASE_URL` trong env file, rồi restart `web`/`migrate`/app.

### 3.3 OAuth client secret (Google/Github/Facebook/Apple)

Đổi trên console của từng provider trước, cập nhật biến tương ứng
(`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `FACEBOOK_CLIENT_SECRET`, hoặc file `.p8` mới cho
`APPLE_PRIVATE_KEY`) trong env file, restart app. Không cần xử lý gì thêm phía database — OAuth
client secret không lưu trong DB, chỉ dùng lúc trao đổi token (xem `src/lib/oauth/client.ts`).

### 3.4 `ADMIN_PASSWORD`

Chỉ ảnh hưởng lần seed tiếp theo (`pnpm db:seed:prod`) — đổi giá trị này KHÔNG tự đổi mật khẩu tài
khoản admin đã tồn tại trong database. Muốn đổi mật khẩu admin hiện có, dùng luồng "quên mật khẩu"
bình thường hoặc cập nhật trực tiếp qua `userService`/API đã đăng nhập.

### 3.5 SSH key cho deploy

```sh
ssh-keygen -t ed25519 -f ~/.ssh/xemphim-deploy
```

Thêm public key mới vào `authorized_keys` trên VPS, cập nhật secret trên CI (nếu deploy tự động
qua GitHub Actions), xác nhận deploy chạy được rồi mới xoá key cũ khỏi `authorized_keys`.

---

## 4. Mất VPS hoàn toàn

VPS mất hẳn (ổ cứng hỏng, tài khoản bị khoá, `rm -rf` nhầm). Dựng lại từ đầu:

1. **Tạo VPS mới** — xem [`HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md`](./HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md)
   để chọn lại nhà cung cấp.
2. **Clone repo**, khôi phục `.env`/`/etc/xemphim/env` từ nơi lưu secret riêng (KHÔNG lưu
   trong git — password manager hoặc vault riêng).
3. **Cập nhật DNS** trỏ domain sang IP VPS mới, đợi propagate.
4. **Dựng hạ tầng**:

   ```sh
   docker compose up -d postgres redis
   ```

5. **Khôi phục backup gần nhất** theo Mục 1.
6. **Áp migration + khởi động app**:

   ```sh
   pnpm db:deploy
   sudo systemctl daemon-reload
   sudo systemctl enable --now xemphim   # bare-metal — xem deploy/xemphim.service
   # hoặc: docker compose up -d              # Docker
   curl -i http://127.0.0.1:3000/api/health
   ```

7. **Cấu hình lại Caddy** (`deploy/Caddyfile`, đổi domain) hoặc reverse proxy đang dùng, cấp lại
   SSL.
8. **Thêm lại SSH key** cho CI/CD nếu deploy tự động.

Mục tiêu phục hồi: phụ thuộc hoàn toàn vào backup gần nhất bạn có (xem cảnh báo đầu file) — chưa
có lịch backup cố định nên **chưa thể cam kết RPO cụ thể**. Đây là lý do việc thêm cron backup ở
Mục 5/`HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md` nên làm sớm, trước khi có dữ liệu người dùng thật.

---

## 5. Tự backup thủ công

Cho tới khi có cron tự động, đây là cách backup tay nhanh nhất — chạy định kỳ tự nhắc bản thân,
hoặc trước mỗi lần migration/thao tác rủi ro:

```sh
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists | gzip > "backup-$(date +%Y%m%dT%H%M%S).sql.gz"
```

**Chuyển file này ra khỏi VPS ngay** (không để nằm lại cùng ổ đĩa với database) — kéo về máy local
qua `scp`, hoặc đẩy tay lên R2/S3 bucket:

```sh
scp deploy@vps-ip:$APP_DIR/backup-*.sql.gz ./backups/
```

Việc này chỉ nên là giải pháp tạm — mục tiêu vẫn là tự động hoá theo hướng dẫn trong
`HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md`.
