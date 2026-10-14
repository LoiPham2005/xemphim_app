# Deploy lên VPS

Hướng dẫn đưa dự án lên một máy chủ Linux thật. Có **ba cách**, dùng chung phần
chuẩn bị ở mục 1 và 2 — đọc hai mục đó trước, rồi nhảy tới cách bạn chọn.

| Cách                                         | Chọn khi                                                         |
| -------------------------------------------- | ---------------------------------------------------------------- |
| [Docker Compose](#4-cách-a--docker-compose)  | Muốn nhanh và gọn nhất. Dựng luôn cả Postgres + Redis.           |
| [systemd + Caddy](#5-cách-b--systemd--caddy) | VPS nhỏ (1GB RAM), hoặc đã có Postgres sẵn. Siết quyền tốt nhất. |
| [PM2](#6-cách-c--pm2)                        | Quen PM2 rồi, hoặc cần `reload` không rớt kết nối.               |

Cả ba đều chạy **ba tiến trình**:

| Tiến trình | Việc             | Thiếu nó thì sao                                 |
| ---------- | ---------------- | ------------------------------------------------ |
| `web`      | Next.js          | Không có gì chạy                                 |
| `realtime` | WebSocket        | Web vẫn chạy, realtime im lặng không hoạt động   |
| `worker`   | Job nền (BullMQ) | **Mọi email nằm trong hàng đợi mà không ai gửi** |

Cả hai tiến trình phụ đều hỏng trong im lặng — không có lỗi nào báo cho bạn
biết. Riêng `worker` đáng chú ý nhất: từ khi email đi qua hàng đợi, thiếu
worker nghĩa là **không lá thư nào được gửi**, kể cả email đặt lại mật khẩu.

---

## 1. Chuẩn bị máy chủ

Cấu hình tối thiểu: **2GB RAM** nếu dùng Docker (vì có thêm Postgres + Redis
trong container), **1GB RAM** nếu dùng systemd/PM2 với Postgres đặt ở nơi khác.

```bash
# Trên VPS, với quyền root
adduser deploy
usermod -aG sudo deploy

# Khoá đăng nhập bằng mật khẩu — chỉ cho vào bằng SSH key.
# Làm bước này TRƯỚC khi mở cổng ra Internet.
ssh-copy-id deploy@<ip-server>     # chạy từ máy bạn
```

Trong `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl restart ssh

# Tường lửa: chỉ mở SSH và HTTP(S).
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

⚠️ **`ufw` KHÔNG chặn được cổng do Docker công bố.** Đây là cái bẫy khiến rất
nhiều VPS bị lộ database mà chủ máy tin là đã đóng. Docker tự ghi luật vào
chuỗi `DOCKER` của iptables, nằm TRƯỚC luật của ufw — chạy `ufw deny 5432`
xong vẫn kết nối từ ngoài vào được như thường.

Cách chặn duy nhất đáng tin: **bind cổng vào `127.0.0.1` ngay trong compose**.
`docker-compose.yml` của dự án đã làm sẵn cho cả ba cổng:

```yaml
ports:
  - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
```

Kiểm tra lại trên VPS sau khi deploy — chạy TỪ MÁY BẠN, không phải từ VPS:

```bash
nc -zv <ip-server> 5432    # mong đợi: refused / timeout
nc -zv <ip-server> 3000    # mong đợi: refused / timeout
```

Nếu hai lệnh trên kết nối được thì cổng đang mở ra Internet — sửa ngay.

---

## 2. Chuẩn bị file môi trường

Đây là bước dễ sai nhất, và sai thì app không khởi động được — `src/lib/env.ts`
validate toàn bộ biến ngay lúc chạy, thiếu là dừng luôn kèm thông báo chỉ rõ
biến nào.

```bash
sudo mkdir -p /etc/xemphim
sudo cp .env.example /etc/xemphim/env
sudo chmod 600 /etc/xemphim/env      # chứa SESSION_SECRET
sudo nano /etc/xemphim/env
```

### Bắt buộc

| Biến             | Ghi chú                                                      |
| ---------------- | ------------------------------------------------------------ |
| `DATABASE_URL`   | `postgresql://user:pass@host:5432/db?schema=public`          |
| `SESSION_SECRET` | Sinh bằng `openssl rand -base64 48`. **Tối thiểu 32 ký tự.** |

### Gần như luôn cần

| Biến                             | Vì sao                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`            | Link trong email xác thực/đặt lại mật khẩu dựng từ đây. Thiếu là **gửi mail ném lỗi**. |
| `REDIS_URL`                      | Rate limit dùng chung giữa các tiến trình. Xem cảnh báo bên dưới.                      |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD` | `pnpm db:seed:prod` cần để tạo tài khoản quản trị đầu tiên.                            |

⚠️ **`SESSION_SECRET` phải giống hệt nhau giữa `web` và `realtime`.** Token do
web cấp được verify ở realtime; lệch một ký tự là mọi kết nối WebSocket bị từ
chối, và thông báo lỗi chỉ là `unauthorized` chung chung.

⚠️ **Về `REDIS_URL`**: bỏ trống thì rate limit đếm trong RAM của từng tiến
trình. Chạy **một** tiến trình thì không sao. Từ tiến trình thứ hai trở đi,
ngưỡng chống brute-force bị nhân lên theo số tiến trình — im lặng, không log.
Chạy nhiều instance thì bắt buộc phải có Redis.

### Tuỳ chọn — tắt bớt tiến trình không dùng

Dự án dựng sẵn ba tiến trình: `web`, `realtime` (WebSocket), `worker` (job nền).
Không phải dự án nào cũng cần đủ ba. Hai biến dưới đây tắt hẳn tiến trình tương
ứng ở **cả ba cách deploy**:

| Biến               | `1` (mặc định)                | `0`                                                      |
| ------------------ | ----------------------------- | -------------------------------------------------------- |
| `QUEUE_ENABLED`    | Job vào Redis, `worker` xử lý | `enqueue()` chạy job ngay trong request; không cần Redis |
| `REALTIME_ENABLED` | Dựng tiến trình WebSocket     | Không dựng                                               |

⚠️ **Chỉ nhận `1` hoặc `0`, không nhận `true`/`false`.** Chính hai biến này được
`docker-compose.yml` dùng làm `deploy.replicas`, mà Compose chỉ hiểu số — đặt
`false` là nó dừng ngay với `strconv.Atoi: parsing "false"`. Dùng chung một biến
cho cả app lẫn hạ tầng là có chủ đích: tách đôi thì sẽ có ngày app đẩy job vào
Redis trong khi không worker nào chạy, và chuyện đó xảy ra hoàn toàn trong im lặng.

Tắt hàng đợi **không mất tính năng nào**, chỉ đổi chỗ chạy. Cái mất là thử lại
tự động: đang bật, một lần SMTP nghẽn chỉ làm job lùi vài giây; tắt đi thì lỗi
bung thẳng ra request và người dùng đăng ký hỏng. Dự án gửi mail thật nên để bật.

Cách tắt theo từng đường deploy:

```bash
# Docker Compose — sửa .env rồi up lại. Container đang chạy sẽ bị GỠ, không bỏ mặc.
QUEUE_ENABLED=0 REALTIME_ENABLED=0
docker compose up -d

# systemd — biến trong /etc/xemphim/env chỉ làm tiến trình tự thoát, mà
# `Restart=always` thì bật lại ngay. Phải tắt ở tầng unit:
sudo systemctl disable --now xemphim-worker
sudo systemctl disable --now xemphim-realtime

# PM2 — ecosystem.config.cjs đọc biến của SHELL (không đọc .env), nên nạp trước:
set -a && . /etc/xemphim/env && set +a
pnpm pm2:start
```

⚠️ Tắt realtime thì **bỏ luôn khối `/socket.io/*` trong Caddyfile**. Để lại thì
proxy trả 502 (trông như dịch vụ hỏng) thay vì 404 (đúng: không có ở đây).

Kiểm tra deploy đang bật những gì: `curl -s https://ten-mien/api/health` trả
`"features":{"queue":"redis","realtime":"on"}`. Giá trị `queue` có ba trạng thái
— `redis` (chạy nền thật), `inline` (cờ bật nhưng thiếu `REDIS_URL`, gần như
luôn là nhầm), `off` (đã tắt có chủ đích).

---

## 3. Lấy mã nguồn

```bash
sudo mkdir -p /var/www/xemphim
sudo chown deploy:deploy /var/www/xemphim
git clone <repo-url> /var/www/xemphim
cd /var/www/xemphim
```

---

## 4. Cách A — Docker Compose

Gọn nhất: một lệnh dựng cả Postgres, Redis, migrate, web, realtime.

```bash
# Cài Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
# Đăng xuất rồi vào lại để nhóm docker có hiệu lực

cp /etc/xemphim/env .env      # compose đọc .env ở gốc dự án
docker compose up -d --build
```

Kiểm tra:

```bash
docker compose ps                              # migrate phải ở trạng thái "exited (0)"
curl -s http://127.0.0.1:3000/api/health
```

Tạo tài khoản quản trị lần đầu (chạy một lần):

```bash
docker compose run --rm tools pnpm db:seed:prod
```

Lệnh này dùng service `tools` — một container dùng-một-lần nằm sau profile
`tools`, nên `docker compose up` không bao giờ chạm tới nó. Nó cũng là nơi chạy
mọi tác vụ vận hành khác:

```bash
docker compose run --rm tools pnpm db:purge      # dọn token hết hạn
docker compose run --rm tools npx prisma migrate status
```

⚠️ Cần `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env` trước khi seed. Ở
production, thiếu hai biến này thì seed **dừng và báo lỗi** thay vì tạo tài
khoản với mật khẩu mặc định — đó là chủ ý.

### Deploy lần sau

```bash
./scripts/deploy-docker.sh     # pull → build → up → health check → dọn image cũ
```

### Dọn token định kỳ

Docker **không** tự chạy việc này. Thêm vào cron của máy chủ:

```bash
crontab -e
```

```
0 3 * * * cd /var/www/xemphim && docker compose run --rm tools pnpm db:purge >/dev/null 2>&1
```

Bảng `refresh_tokens` và `verification_tokens` chỉ tăng — mỗi lần đăng nhập
thêm một dòng, mỗi lần bấm "quên mật khẩu" thêm một dòng, kể cả khi người dùng
không bao giờ mở email.

---

## 5. Cách B — systemd + Caddy

Nhẹ nhất và siết quyền chặt nhất. Postgres cài riêng.

```bash
# Node 24 + pnpm
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable

# Postgres
sudo apt install -y postgresql
sudo -u postgres createuser --pwprompt appuser
sudo -u postgres createdb -O appuser xemphim

# Redis (bỏ qua nếu chỉ chạy 1 tiến trình)
sudo apt install -y redis-server
```

Build và cài service:

```bash
cd /var/www/xemphim
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm build
pnpm realtime:build
pnpm db:seed:prod          # tạo admin lần đầu

pnpm worker:build

sudo cp deploy/xemphim.service /etc/systemd/system/
sudo cp deploy/xemphim-realtime.service /etc/systemd/system/
sudo cp deploy/xemphim-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xemphim xemphim-realtime xemphim-worker
```

⚠️ **Đừng quên hai unit phụ.** Cài thiếu `xemphim-realtime` thì WebSocket
không tồn tại; cài thiếu `xemphim-worker` thì **không email nào được gửi** —
job nằm nguyên trong Redis. Cả hai đều không báo lỗi gì.

⚠️ **`worker` bắt buộc có `REDIS_URL`** trong `/etc/xemphim/env`. Khác web
và realtime, nó dừng ngay với thông báo rõ ràng nếu thiếu — thay vì ngồi im.

Dọn token định kỳ (systemd timer, không cần crontab):

```bash
sudo cp deploy/xemphim-purge.service deploy/xemphim-purge.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xemphim-purge.timer
systemctl list-timers xemphim-purge.timer    # xác nhận đã lên lịch
```

Reverse proxy:

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # đổi example.com thành domain thật
sudo systemctl reload caddy
```

Caddy tự xin và tự gia hạn chứng chỉ Let's Encrypt — không cần certbot, không
cần cron. Điều kiện: domain đã trỏ A/AAAA về IP máy này, cổng 80 và 443 mở
(cổng 80 dùng cho ACME challenge).

⚠️ **`Caddyfile` phải có khối định tuyến `/socket.io/*` sang cổng 3002.** Thiếu
nó thì tiến trình realtime chạy bình thường, `systemctl status` xanh, log sạch
— nhưng client từ Internet không có đường nào tới nó vì proxy đẩy hết sang cổng 3000. File `deploy/Caddyfile` trong repo đã có sẵn khối này; nếu bạn dùng nginx
thì phải tự viết `location /socket.io/` kèm `proxy_set_header Upgrade` và
`Connection "upgrade"`.

### Deploy lần sau

```bash
./scripts/deploy-vps.sh     # pull → install → migrate → build (cả realtime) → restart → health check
```

### Xem log

```bash
journalctl -u xemphim -f
journalctl -u xemphim-realtime -f
journalctl -u xemphim-worker -f
```

---

## 6. Cách C — PM2

Cùng mô hình với cách B (chạy trực tiếp trên máy, Postgres cài riêng), chỉ khác
cái quản tiến trình. Điểm mạnh: `pm2 reload` nạp lại **không rớt kết nối**.

Làm hết phần cài Node/Postgres/Redis và Caddy ở [cách B](#5-cách-b--systemd--caddy)
— **kể cả khối `/socket.io/*` trong Caddyfile**, PM2 cũng cần nó — rồi **bỏ qua**
bước `systemctl`, thay bằng:

```bash
sudo npm install -g pm2

cd /var/www/xemphim
cp /etc/xemphim/env .env       # PM2 đọc .env ở gốc dự án
./scripts/deploy-pm2.sh

pm2 save                            # ghi lại danh sách tiến trình
pm2 startup                          # in ra lệnh cần chạy để tự khởi động sau reboot
```

### Về số instance

`ecosystem.config.cjs` mặc định chạy **1 instance**, có chủ đích.

Muốn tận dụng đa nhân thì phải đặt `REDIS_URL` trước:

```bash
PM2_INSTANCES=max pm2 start ecosystem.config.cjs --env production
```

Nếu quên Redis, file cấu hình sẽ **dừng lại và báo lỗi** thay vì cho chạy — vì
mỗi tiến trình đếm rate limit riêng, chạy 8 nhân là ngưỡng đăng nhập bị nhân
8 lần mà không có dấu hiệu gì.

`realtime` **luôn 1 instance** kể cả khi web chạy cluster: Socket.IO cần adapter
Redis mới phát tin được giữa các tiến trình, thiếu nó thì client nối vào tiến
trình A không nhận được tin từ B.

### Dọn token định kỳ

```bash
crontab -e
```

```
0 3 * * * cd /var/www/xemphim && /usr/bin/pnpm db:purge >/dev/null 2>&1
```

### Lệnh hay dùng

```bash
pm2 status
pm2 logs
pm2 reload ecosystem.config.cjs --env production    # không rớt kết nối
pm2 monit
```

---

## 7. Sau khi deploy — kiểm tra 6 điểm

Chạy hết 6 lệnh dưới đây. Mỗi lệnh bắt một loại lỗi khác nhau, và mấy lỗi này
đều thuộc loại "im lặng" — không tự lộ ra cho tới khi có người dùng thật gặp.

```bash
# 1. Web sống và nối được database
curl -s https://your-domain.com/api/health
# mong đợi: {"status":"ok","database":"up",...}

# 2. Realtime sống  (chạy TRÊN máy chủ — cổng này không mở ra ngoài)
curl -s http://127.0.0.1:3002/health
# mong đợi: {"status":"ok","connections":0}

# 2b. Worker sống VÀ nối được hàng đợi
curl -s http://127.0.0.1:3003/health
# mong đợi: {"status":"ok","counts":{"waiting":0,"active":0,"delayed":0,"failed":0}}
# 503 = mất kết nối Redis. `failed` tăng dần = job đang hỏng, xem log worker.

# 3. API trả JSON, không phải HTML chuyển hướng
curl -s -i https://your-domain.com/api/v1/users | head -3
# mong đợi: HTTP 401 + content-type: application/json

# 4. HTTPS và header bảo mật
curl -sI https://your-domain.com | grep -i "strict-transport\|content-security"

# 5. Đăng nhập được bằng tài khoản admin vừa seed
#    (mở trình duyệt vào /login)

# 6. Rate limit đang chạy: gọi sai mật khẩu 6 lần liên tiếp phải nhận 429
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://your-domain.com/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"identifier":"khong-ton-tai@example.com","password":"sai"}'
done; echo
# mong đợi: 401 401 401 401 401 429
```

---

## 8. Sao lưu database

**Chưa có gì tự động.** Self-host Postgres nghĩa là mất VPS là mất dữ liệu.
Thiết lập ngay sau khi deploy lần đầu, đừng để sau:

```bash
crontab -e
```

```
# Dump mỗi ngày lúc 2h, giữ 14 ngày gần nhất
0 2 * * * pg_dump "$DATABASE_URL" | gzip > /var/backups/db-$(date +\%F).sql.gz
0 4 * * * find /var/backups -name 'db-*.sql.gz' -mtime +14 -delete
```

⚠️ Dump nằm cùng máy với database thì không phải backup — nó chỉ cứu được khi
xoá nhầm bảng, không cứu được khi mất máy. Đẩy lên object storage
(S3/R2/Vietnix) và **thử khôi phục ít nhất một lần** để biết bản dump dùng
được. Chi tiết: [disaster-recovery.md](disaster-recovery.md).

---

## 9. Sự cố thường gặp

| Triệu chứng                                                     | Nguyên nhân hay gặp                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| App không khởi động, log ghi "Cấu hình môi trường không hợp lệ" | Thiếu biến bắt buộc. Thông báo có chỉ rõ tên biến — đọc nó.                                            |
| `/api/health` trả 503                                           | Web sống nhưng không nối được database. Kiểm tra `DATABASE_URL` và firewall của Postgres.              |
| WebSocket không kết nối                                         | Chưa cài/chạy tiến trình realtime, hoặc `SESSION_SECRET` lệch giữa hai tiến trình.                     |
| Gửi email ném lỗi                                               | Thiếu `NEXT_PUBLIC_APP_URL`, hoặc chưa gọi `setMailer()` với nhà cung cấp thật.                        |
| Rate limit như không có tác dụng                                | Đang chạy nhiều tiến trình mà thiếu `REDIS_URL`.                                                       |
| Container chết ngay khi khởi động, `MODULE_NOT_FOUND`           | Next truy vết thiếu file vào bản standalone — xem `outputFileTracingIncludes` trong `next.config.mjs`. |
| Đăng nhập thành công nhưng bị đá ra ngay                        | `SESSION_SECRET` đổi giữa hai lần deploy → mọi cookie cũ thành không hợp lệ.                           |

Thêm các bẫy đã gặp thật: [GOTCHAS.md](GOTCHAS.md).

---

## 10. Rollback

| Cách    | Lệnh                                                            |
| ------- | --------------------------------------------------------------- |
| Docker  | `docker compose up -d --no-build` với image tag cũ (nhanh nhất) |
| systemd | `git checkout <commit-cũ> && ./scripts/deploy-vps.sh`           |
| PM2     | `git checkout <commit-cũ> && ./scripts/deploy-pm2.sh`           |

⚠️ **Migration database không tự lùi được.** Prisma Migrate chỉ tiến, không
lùi. Trước khi deploy một migration có xoá cột hoặc đổi kiểu dữ liệu, hãy dump
database trước — rollback mã nguồn mà schema đã đổi thì app bản cũ không chạy
được với schema mới.

Chi tiết quy trình khôi phục: [disaster-recovery.md](disaster-recovery.md).
