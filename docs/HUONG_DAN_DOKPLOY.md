# Hướng dẫn dùng Dokploy

> Viết theo **Dokploy v0.30.x** (tháng 9/2026). Dokploy chưa lên 1.0 nên tên nút/menu có thể lệch
> đôi chút giữa các bản — lệch thì tra [docs.dokploy.com](https://docs.dokploy.com).
>
> Hợp nhất khi **cài lên VPS của khách lúc bàn giao**: khách có một công cụ chuẩn, có tài liệu,
> không phụ thuộc vào mình.

---

## 1. Dokploy là gì

Cài lên VPS một lần, sau đó mọi việc làm trên giao diện web:

```
GitHub ──push──▶ Dokploy build (Dockerfile / Nixpacks / Compose) ──▶ container
                                                                        ▲
Internet ──▶ Traefik (cổng 80/443, tự xin SSL Let's Encrypt) ──domain───┘
```

Bên dưới là Docker Swarm + Traefik + Postgres/Redis riêng của Dokploy — script cài tự dựng hết.

Cách tổ chức: **Project** → **Environment** (production, staging…) → **Service**. Có 3 loại service:

| Loại            | Dùng khi                                                        | Ví dụ                                                                                  |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Application** | App 1 container                                                 | API NestJS, web Next.js một tiến trình                                                 |
| **Compose**     | App nhiều container, đã có `docker-compose.yml`                 | hotfarm365 (app + scheduler + MySQL), xemphim đầy đủ (web + worker + realtime + Redis) |
| **Database**    | Postgres, MySQL, MariaDB, MongoDB, Redis — có sẵn backup lên S3 | DB dùng chung cho nhiều app                                                            |

Ngoài ra có **Templates**: app dựng sẵn 1 click (n8n, Uptime Kuma, Plausible…).

---

## 2. Chuẩn bị VPS

| Hạng mục     | Tối thiểu                        | Nên có                                                           |
| ------------ | -------------------------------- | ---------------------------------------------------------------- |
| RAM          | 2 GB                             | 4 GB nếu build Next.js ngay trên VPS (một lần build ngốn 1–2 GB) |
| Ổ đĩa        | 30 GB                            | 50 GB+ — image Docker phình rất nhanh                            |
| Hệ điều hành | Ubuntu 18.04–24.04, Debian 10–12 | Ubuntu 24.04 LTS, **VPS trắng**                                  |

⚠️ **VPS phải trống cổng 80/443** — Traefik của Dokploy giữ hai cổng này. VPS đang chạy
Nginx/Caddy (như bản deploy tay của hotfarm365) thì tắt trước:

```bash
sudo systemctl disable --now nginx caddy apache2 2>/dev/null
```

**DNS** — trỏ bản ghi A về IP VPS _trước_ khi gắn domain (Let's Encrypt cần):

- `panel.tenmien.vn` → bảng điều khiển Dokploy
- `app.tenmien.vn`, `api.tenmien.vn`… → các app
- Hoặc một bản ghi `*.tenmien.vn` cho gọn

**VPS 2 GB → thêm swap**, không thì build hay bị giết giữa chừng (exit code 137):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. Cài đặt

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Script tự cài Docker, bật Swarm, dựng Traefik + Postgres + Redis cho Dokploy. VPS có nhiều IP mà
script nhận sai thì chỉ định tay:

```bash
curl -sSL https://dokploy.com/install.sh | sudo ADVERTISE_ADDR=<IP-VPS> sh
```

Cài xong, mở **`http://<IP-VPS>:3000`** → tạo tài khoản admin.

⚠️ **Tạo admin ngay sau khi cài.** Khi chưa có admin, trang đăng ký mở cho bất kỳ ai vào được
`IP:3000`.

---

## 4. Khoá bảo mật — làm TRƯỚC khi deploy app nào

Năm 2026 Dokploy dính cả loạt lỗ nghiêm trọng: chiếm quyền admin không cần mật khẩu (do secret bị
hardcode), chạy lệnh tuỳ ý trên máy chủ, vào terminal root của server khác… Tất cả đã vá ở các bản
mới, nên:

1. **Luôn chạy bản mới nhất.** Settings → Web Server có mục kiểm tra và cập nhật phiên bản. Theo dõi
   [trang releases](https://github.com/Dokploy/dokploy/releases).
2. **Gắn domain + HTTPS cho panel:** Settings → Web Server → Server Domain → nhập `panel.tenmien.vn`,
   bật HTTPS, chọn Let's Encrypt, điền email. Vào được bằng `https://panel.tenmien.vn` rồi thì
   **tắt truy cập qua `IP:3000`** (Dokploy có tuỳ chọn này sau khi đã gắn domain).
3. **Bật 2FA** cho tài khoản admin (trong phần Profile).
4. **Tường lửa — chỉ mở 22, 80, 443:**

   ```bash
   sudo ufw allow 22,80,443/tcp && sudo ufw enable
   ```

   ⚠️ **ufw KHÔNG chặn được cổng do Docker mở** — Docker chèn luật iptables đứng trước ufw. Vì vậy:
   trong compose dùng `expose:` chứ đừng dùng `ports:`, và đừng điền **External Port** cho database
   trừ khi thật cần.

5. **SSH chỉ bằng key:** đặt `PasswordAuthentication no` trong `/etc/ssh/sshd_config` rồi
   `sudo systemctl restart ssh`.

---

## 5. Nối GitHub

Settings → **Git** → **GitHub** → tạo GitHub App → cài app vào tài khoản/tổ chức → chọn các repo
cho phép (repo private được).

Nối kiểu này thì khi tạo service chỉ việc chọn repo từ danh sách, và **push là tự deploy** — không
phải tự dán webhook. GitLab, Bitbucket, Gitea làm tương tự. Repo ở chỗ khác: dùng provider **Git**
(URL + SSH key).

---

## 6. Tạo database

Project → **Create Service** → **Database** → chọn loại → đặt tên, user, mật khẩu → **Deploy**.

- Tab **General** có thông tin kết nối **nội bộ** (internal host + chuỗi kết nối) → dán vào
  `DATABASE_URL` của app. App chạy trong Dokploy nối vào bằng chuỗi này.
- **External Port: để trống.** Điền vào là mở DB ra internet. Cần chạy lệnh SQL thì dùng terminal
  của container ngay trong Dokploy (`psql` / `mysql`). Bắt buộc phải nối từ TablePlus/DBeaver thì
  mở External Port tạm, mật khẩu mạnh, xong đóng lại.
- Tab **Backups** → xem [mục 9](#9-backup).

---

## 7. Deploy Application (1 container)

Ví dụ: API NestJS, hoặc web Next.js chỉ có một tiến trình.

1. Project → **Create Service** → **Application** → đặt tên.
2. Tab **General** → Provider **GitHub** → chọn repo, branch.
3. **Build Type:**
   - Repo có `Dockerfile` → **Dockerfile**: Dockerfile Path `./Dockerfile`, Docker Context Path `.`,
     và **Docker Build Stage** nếu Dockerfile nhiều stage (xemphim: `runner`).
   - Không có Dockerfile → **Railpack** hoặc **Nixpacks** tự nhận diện.
   - Web tĩnh đã build sẵn → **Static** (domain phải trỏ cổng `80`).
4. Tab **Environment** → dán biến theo định dạng file `.env`. Giá trị nhiều dòng thì bọc trong ngoặc
   kép. Biến cần lúc _build_ (vd `NEXT_PUBLIC_*`) đặt ở **Build Time Arguments**, và Dockerfile phải
   khai báo `ARG` tương ứng.
5. Tab **Domains** → Add Domain:
   - **Host:** `app.tenmien.vn`
   - **Container Port:** cổng app nghe _bên trong_ container (Next.js `3000`…)
   - **HTTPS:** bật · **Certificate:** Let's Encrypt

   Application nhận domain ngay, không cần deploy lại. Container Port chỉ để Traefik định tuyến,
   không mở cổng nào ra ngoài.

6. Bấm **Deploy** → log build ở tab **Deployments**, log lúc chạy ở tab **Logs**.

⚠️ App phải nghe `0.0.0.0`, không phải `localhost` — sai là Traefik trả 502. Next.js standalone cần
`HOSTNAME=0.0.0.0` (Dockerfile của xemphim đã đặt sẵn).

**Deploy không gián đoạn:** app cần một route health trả 200. Image đã có `HEALTHCHECK` trong
Dockerfile (như xemphim) thì Swarm dùng luôn cái đó. Chưa có thì vào tab **Advanced** → Cluster
Settings → **Swarm Settings** → Health Check, dán:

```json
{
  "Test": ["CMD", "curl", "-f", "http://localhost:3000/health"],
  "Interval": 30000000000,
  "Timeout": 10000000000,
  "StartPeriod": 30000000000,
  "Retries": 3
}
```

Đơn vị là nano giây. Image Alpine **không có `curl`** → đổi lệnh sang
`node -e "fetch(...)"` như Dockerfile của xemphim.

---

## 8. Deploy Compose (nhiều container)

Hợp với dự án đã có sẵn compose: hotfarm365, xemphim.

### 8.1 Sửa file compose trước

Tạo một file riêng cho Dokploy (vd `docker-compose.dokploy.yml`), sửa từ bản production:

| Sửa                                                                    | Vì sao                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Bỏ service reverse proxy** (caddy/nginx) và volume của nó            | Traefik của Dokploy đã lo 80/443 + SSL; để lại là tranh cổng                                 |
| **`ports:` → `expose:`**                                               | Không cần mở cổng ra host, mà `ports` còn dễ đụng cổng — Dokploy chiếm sẵn `3000`            |
| **Bỏ `container_name:`**                                               | Chạy hai bản (staging + production) trên cùng máy sẽ trùng tên                               |
| Env đọc qua **`env_file: .env`** hoặc `${BIEN}`                        | Dokploy ghi tab Environment ra file `.env` cạnh compose nhưng **không tự bơm vào container** |
| Dữ liệu cần giữ → **named volume** (hoặc `../files/...`)               | Mỗi lần deploy Dokploy `git clone` lại, xoá sạch thư mục code — bind mount `./data` sẽ mất   |
| File cấu hình cần mount vào container → **File Mounts** (tab Advanced) | Cùng lý do trên                                                                              |

**hotfarm365** — `docker-compose.prod.yml` đã có gần đủ, chỉ cần:

- Xoá service `caddy` và hai volume `caddy_data`, `caddy_config`.
- Xoá các dòng `container_name:`.
- Giữ nguyên `db` (`dbvolume` là named volume, không mất khi deploy lại), `app` (đã dùng
  `expose: 8000`), `scheduler` (đã đọc `env_file: .env`). Backup CSDL vẫn do `scheduler` tự đẩy lên
  S3 Vietnix như cũ.
- `trustProxies(at: '*')` đã có sẵn trong `bootstrap/app.php`, nên đứng sau Traefik vẫn sinh link
  `https://` đúng.

**xemphim** — `docker-compose.yml`:

- Xoá `ports:` ở `postgres`, `web`, `realtime` (đang bind `127.0.0.1:3000` — đụng cổng của Dokploy).
- Xoá `container_name:`.
- Còn lại giữ nguyên: đã đọc env qua cả `env_file` lẫn `${...}`, và `SESSION_SECRET` dùng `:?` nên
  thiếu là dừng ngay.
- ⚠️ Rate limit đăng nhập dựa vào việc proxy **ghi đè** `X-Forwarded-For` (xem comment trong
  compose). Caddyfile cũ làm việc này tường minh; lên Dokploy thì kiểm tra lại cách Traefik xử lý
  header này — nhất là khi có Cloudflare đứng trước.

### 8.2 Tạo service Compose

1. Project → **Create Service** → **Compose** → Provider GitHub → repo, branch.
2. **Compose Path:** `./docker-compose.dokploy.yml`.
3. Tab **Environment:** dán nội dung `.env` production (APP_KEY, `APP_URL=https://…`, mật khẩu DB…).
4. Tab **Domains** → Add Domain → chọn **Service Name** + **Container Port**:
   - hotfarm365: service `app`, port `8000`.
   - xemphim: service `web`, port `3000`; thêm một domain nữa **cùng host**, Path `/socket.io`,
     service `realtime`, port `3002` (không bật Strip Path).
5. **Deploy.** Với Compose, thêm/sửa domain xong **phải Deploy lại** mới có hiệu lực (khác
   Application). Muốn xem Dokploy chèn gì vào file thì bấm **Preview Compose**.

### 8.3 Service không có domain cần nối DB tạo bằng Dokploy

Dokploy chỉ tự gắn mạng `dokploy-network` cho service **có domain**. Service không có domain
(worker, scheduler, migrate) muốn nối vào Database tạo ở [mục 6](#6-tạo-database) thì khai báo tay:

```yaml
services:
  worker:
    # ...
    networks:
      - default # vẫn cần để thấy redis/postgres trong cùng compose
      - dokploy-network

networks:
  dokploy-network:
    external: true
```

DB nằm luôn trong compose (như hai ví dụ trên) thì không cần bước này.

---

## 9. Backup

### 9.1 Khai báo nơi chứa: S3 Vietnix

Settings → **S3 Destinations** → Add:

| Trường            | Giá trị                                      |
| ----------------- | -------------------------------------------- |
| Name              | `vietnix`                                    |
| Provider          | **Other** (Any other S3 compatible provider) |
| Access Key Id     | access key Vietnix                           |
| Secret Access Key | secret key — **đủ 40 ký tự**                 |
| Bucket            | tên bucket                                   |
| Region            | `vn-hcm-1`                                   |
| Endpoint          | `https://s3.vn-hcm-1.vietnix.cloud`          |

Bấm **Test connection**. Lỗi thì:

- Lỗi SSL → sai endpoint (không phải `s3.vietnix.cloud`).
- `SignatureDoesNotMatch` → secret key sai hoặc thiếu ký tự.
- Dokploy đẩy file bằng rclone và luôn ép kiểu _path-style_. Chứng chỉ của Vietnix có cả
  `s3.vn-hcm-1.vietnix.cloud` lẫn `*.s3.vn-hcm-1.vietnix.cloud` (đã kiểm tra 11/9/2026) nên path-style
  vẫn chạy. Nếu vẫn lỗi, điền ô **Additional Flags**: `--s3-force-path-style=false`.

### 9.2 Backup database (loại tạo ở mục 6)

Database → tab **Backups** → tạo backup: chọn destination `vietnix`, tên database, lịch cron, prefix
(vd `hotfarm/`), số bản giữ lại (vd `14`). Tạo xong **chạy thử một lần** rồi lên bucket xem có file
chưa.

- Lịch cron nhiều khả năng tính theo UTC (container của Dokploy thường chạy UTC): 2h sáng giờ VN là
  `0 19 * * *`. Xem giờ của file backup đầu tiên để chắc.
- Khôi phục: tab **Backups** → Restore.

### 9.3 Backup volume (khi DB nằm trong compose)

Compose/Application → **Volume Backups**: chọn service + named volume (vd `dbvolume`), destination,
lịch. Nên chọn **tắt container trong lúc backup** để dữ liệu không hỏng — đổi lại app ngừng một lúc.
Chỉ chạy với named volume, không chạy với `../files`.

Với database, dump SQL (như hotfarm365 đang làm bằng `backup:s3`) vẫn là cách chính; volume backup
chỉ là lớp phụ.

### 9.4 Backup chính Dokploy

Settings → **Web Server** → **Backups**: gói database nội bộ của Dokploy + thư mục `/etc/dokploy`
thành một file zip rồi đẩy lên S3.

Mất VPS thì: cài Dokploy mới → Restore Backup → sửa lại IP trong Web Server settings → nối lại Git
provider → trỏ lại DNS.

⚠️ Backup chưa từng restore thử thì coi như chưa có backup. Thử restore ít nhất một lần.

---

## 10. Auto deploy và CI

- **GitHub App** ([mục 5](#5-nối-github)): bật **Autodeploy** ở tab General → push lên đúng branch đã
  chọn là tự build.
- **Webhook** (Git thường, Docker Hub): lấy Webhook URL ở tab **Deployments**, dán vào phần webhook
  của repo. Docker Hub chỉ kích hoạt khi tag khớp với tag đã cấu hình.
- **API** (gọi từ script/CI): tạo API token trong phần Profile, rồi:

  ```bash
  # Tìm applicationId
  curl -s 'https://panel.tenmien.vn/api/project.all' -H 'x-api-key: <TOKEN>'

  # Deploy
  curl -X POST 'https://panel.tenmien.vn/api/application.deploy' \
    -H 'x-api-key: <TOKEN>' -H 'Content-Type: application/json' \
    -d '{"applicationId": "<ID>"}'
  ```

**VPS yếu → build ở chỗ khác:** để GitHub Actions build image và đẩy lên GHCR, rồi tạo Application
với provider **Docker** (image `ghcr.io/…:latest`) và gọi webhook/API sau khi đẩy image. VPS chỉ việc
kéo image về chạy — không còn cảnh build Next.js làm đứng app đang chạy.

---

## 11. Thông báo Telegram

Settings → **Notifications** → Add → **Telegram**: Bot Token (lấy từ @BotFather), Chat ID → tick các
sự kiện muốn nhận (deploy thành công/lỗi, backup database…) → Test.

Có cả Discord, Slack, Email, Mattermost, Lark, Microsoft Teams.

---

## 12. Vận hành hằng ngày

| Việc                         | Ở đâu                                        |
| ---------------------------- | -------------------------------------------- |
| Xem log build                | tab **Deployments**                          |
| Xem log app đang chạy        | tab **Logs**                                 |
| CPU/RAM/đĩa từng service     | tab **Monitoring**                           |
| Huỷ build đang chờ, rollback | tab **Deployments**                          |
| Giới hạn RAM/CPU cho app     | tab **Advanced**                             |
| Deploy thử theo từng PR      | **Preview Deployments** (Application)        |
| Dọn image/cache Docker cũ    | phần cài đặt của server — bật tự dọn định kỳ |
| Cập nhật Dokploy             | Settings → Web Server                        |

Nên đặt giới hạn RAM cho từng app: một app rò rỉ bộ nhớ sẽ không kéo sập cả VPS.

---

## 13. Thêm server (khi một VPS không đủ)

Panel Dokploy quản lý được nhiều VPS qua SSH:

1. Settings → **SSH Keys** → tạo key → chép public key vào `~/.ssh/authorized_keys` của VPS mới.
2. Settings → **Remote Servers** → Add (IP, user, SSH key) → **Setup Server** (Dokploy tự cài
   Docker, Traefik lên máy đó).
3. Khi tạo service, chọn server đích.

Có thể dùng một máy làm **Build Server** riêng: chỉ build rồi đẩy image lên registry, không chạy app.
Hiện chỉ áp dụng cho Application, chưa cho Compose.

---

## 14. Lỗi thường gặp

| Triệu chứng                                        | Nguyên nhân / cách sửa                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Không xin được SSL                                 | DNS chưa trỏ về VPS, hoặc Cloudflare đang bật đám mây cam → tạm tắt proxy lúc xin cert, sau đó đặt SSL/TLS = **Full (strict)** |
| 502 / 404 khi mở domain                            | Sai Container Port; app nghe `localhost` thay vì `0.0.0.0`; Compose quên Deploy lại sau khi thêm domain                        |
| Compose: app không thấy biến env                   | Thiếu `env_file: .env` hoặc `${BIEN}`                                                                                          |
| Mất dữ liệu sau khi deploy lại                     | Đang dùng bind mount `./...` → chuyển sang named volume hoặc `../files/...`                                                    |
| Service không domain không nối được DB của Dokploy | Thiếu `dokploy-network` ([mục 8.3](#83-service-không-có-domain-cần-nối-db-tạo-bằng-dokploy))                                   |
| Build chết, exit code 137                          | Hết RAM → thêm swap, nâng VPS, hoặc build trên CI ([mục 10](#10-auto-deploy-và-ci))                                            |
| `port is already allocated`                        | Compose còn `ports:`, hoặc Nginx/Caddy cũ đang giữ 80/443                                                                      |
| Laravel sinh link `http://`, lỗi mixed content     | Chưa tin proxy — thêm `$middleware->trustProxies(at: '*');` trong `bootstrap/app.php`                                          |
| Test S3 lỗi                                        | Xem [mục 9.1](#91-khai-báo-nơi-chứa-s3-vietnix)                                                                                |
| Ổ đĩa đầy                                          | Dọn Docker ([mục 12](#12-vận-hành-hằng-ngày)) — build cache phình rất nhanh                                                    |

---

## Tham khảo

- [Cài đặt](https://docs.dokploy.com/docs/core/installation)
- [Application](https://docs.dokploy.com/docs/core/applications) ·
  [Build Type](https://docs.dokploy.com/docs/core/applications/build-type) ·
  [Zero Downtime](https://docs.dokploy.com/docs/core/applications/zero-downtime)
- [Docker Compose](https://docs.dokploy.com/docs/core/docker-compose) ·
  [Domain cho Compose](https://docs.dokploy.com/docs/core/docker-compose/domains)
- [Domains](https://docs.dokploy.com/docs/core/domains)
- [Databases](https://docs.dokploy.com/docs/core/databases) ·
  [Backups](https://docs.dokploy.com/docs/core/backups) ·
  [Volume Backups](https://docs.dokploy.com/docs/core/volume-backups)
- [Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy)
- [Remote Servers](https://docs.dokploy.com/docs/core/remote-servers)
- [Compose không có domain không nối được DB (Discussion #3192)](https://github.com/Dokploy/dokploy/discussions/3192)
