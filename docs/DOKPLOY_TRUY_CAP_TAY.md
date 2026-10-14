# Truy cập tay vào server Dokploy

> Dùng khi giao diện Dokploy không đủ để biết lỗi: SSH thẳng vào VPS để xem file, container, log.
> Phần giao diện xem [HUONG_DAN_DOKPLOY.md](HUONG_DAN_DOKPLOY.md). Viết theo Dokploy v0.30.x.

---

## 1. Vào server

```bash
ssh root@<IP-VPS>
```

Không SSH được thì vào Dokploy → Settings → **Web Server** → **Terminal**. Đó là shell trên chính
máy chủ.

**Đừng nhầm** với nút **Docker Terminal** trong trang một service. Nút đó mở shell _bên trong
container_, không chạy được lệnh `docker`. Image Alpine (node, redis…) không có `bash`, phải chọn
`/bin/sh`.

---

## 2. Bản đồ thư mục

Dokploy để hết mọi thứ ở `/etc/dokploy`:

```
/etc/dokploy/
├── compose/<appName>/
│   ├── code/            # repo đã clone + file .env Dokploy sinh ra từ tab Environment
│   └── files/           # file mount khai báo ở Advanced → Mounts (đường dẫn ../files/...)
├── applications/<appName>/
│   └── code/            # như trên, cho loại Application
├── traefik/
│   ├── traefik.yml      # cấu hình tĩnh của Traefik (entrypoint, certresolver)
│   └── dynamic/
│       ├── acme.json    # chứng chỉ Let's Encrypt đã cấp
│       ├── middlewares.yml
│       └── <appName>.yml   # route của từng Application (Compose thì nằm ở label container)
├── logs/<appName>/      # log build của từng lần deploy (*.log)
├── ssh/                 # SSH key tạo trong Settings → SSH Keys
└── monitoring/          # dữ liệu tab Monitoring
```

Mỗi bản Dokploy có thể thêm hoặc bớt vài thư mục. Chạy `ls /etc/dokploy` để xem đúng máy mình.

**`<appName>`** là tên hệ thống, không phải tên hiển thị. Nó hiện ngay dưới tên service trong
giao diện, ví dụ `xemphim-app-v4exof`. Muốn tra nhanh:

```bash
ls /etc/dokploy/compose /etc/dokploy/applications
```

Dữ liệu volume của Docker nằm ở `/var/lib/docker/volumes/<tên-volume>/_data`. Liệt kê bằng
`docker volume ls`.

---

## 3. Container tên gì

| Loại                       | Tên container / service                                   | Xem bằng            |
| -------------------------- | --------------------------------------------------------- | ------------------- |
| Compose                    | `<appName>-<service>-1`, ví dụ `xemphim-app-v4exof-web-1` | `docker ps`         |
| Application                | swarm service tên `<appName>`                             | `docker service ls` |
| Database tạo trong Dokploy | swarm service tên `<appName>` của DB                      | `docker service ls` |
| Chính Dokploy              | `dokploy`, `dokploy-postgres`, `dokploy-redis`            | `docker service ls` |
| Traefik                    | container `dokploy-traefik`                               | `docker ps`         |

Compose chỉ đặt được tên như trên khi file compose **không có `container_name`**. Có
`container_name` thì tên cố định, dễ đụng với project khác trên cùng server.

---

## 4. Lệnh hay dùng

Đặt biến trước cho gọn:

```bash
APP=xemphim-app-v4exof
```

**Trạng thái:**

```bash
docker ps -a --format '{{.Names}}  {{.Status}}' | grep $APP
```

`Up (healthy)` là ổn. `unhealthy` hoặc `Restarting` thì xem log ngay.

**Log app:**

```bash
docker logs $APP-web-1 --tail 100 -f     # Compose
docker service logs $APP --tail 100 -f   # Application
```

**Log build của lần deploy gần nhất:**

```bash
ls -t /etc/dokploy/logs/$APP | head -1 | xargs -I{} tail -100 /etc/dokploy/logs/$APP/{}
```

**Vào trong container:**

```bash
docker exec -it $APP-web-1 sh
```

**Xem biến môi trường container đang thực sự nhận:**

```bash
docker exec $APP-web-1 env | sort
cat /etc/dokploy/compose/$APP/code/.env
```

**Chạy lệnh compose như Dokploy:**

```bash
cd /etc/dokploy/compose/$APP/code
docker compose -p $APP -f docker-compose.dokploy.yml ps
docker compose -p $APP -f docker-compose.dokploy.yml restart web
```

**Vào psql của DB tạo trong Dokploy:**

```bash
docker ps --format '{{.Names}}' | grep <appName-của-db>
docker exec -it <tên-container-db> psql -U <user> -d <db>
```

**Khởi động lại Dokploy khi giao diện treo:**

```bash
docker service update --force dokploy
```

---

## 5. Xử lý lỗi khi deploy

Mọi lỗi đều bắt đầu giống nhau: mở tab **Deployments**, bấm vào lần deploy hỏng, cuộn tới dòng đỏ
**đầu tiên**. Các dòng sau thường chỉ là hệ quả. Log đó cũng nằm trên đĩa:

```bash
APP=xemphim-app-v4exof
L=$(ls -t /etc/dokploy/logs/$APP/*.log | head -1)
grep -nE -i 'error|failed|❌|killed|no space' "$L" | head -20
```

Dòng lỗi đó cho biết deploy chết ở giai đoạn nào: **clone → build → chạy container → vào qua
domain**. Tìm đúng giai đoạn ở các mục dưới.

### 5.1 Chết lúc clone repo

| Dòng lỗi                                                | Cách sửa                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Repository not found`, `Permission denied (publickey)` | Settings → **Git** → kết nối lại GitHub, và cấp quyền cho repo này trong GitHub App |
| `Remote branch ... not found`                           | Tab General: sửa tên branch cho đúng                                                |
| `Compose file not found`                                | Tab General: sửa **Compose Path**, ví dụ `./docker-compose.dokploy.yml`             |

### 5.2 Chết lúc build

**`exit code: 137`, `Killed`, hoặc build treo rất lâu rồi đứt: hết RAM.**

```bash
free -h
dmesg -T | grep -iE 'killed process|out of memory' | tail -5
```

`dmesg` có dòng `Killed process` thì đúng là hết RAM. Thêm swap 4 GB (chỉ làm một lần):

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Nếu vẫn chết thì nâng RAM VPS, hoặc build trên CI (mục 10 của [HUONG_DAN_DOKPLOY.md](HUONG_DAN_DOKPLOY.md)).

**`no space left on device`: đầy đĩa.**

```bash
df -h /
docker system df
docker builder prune -f      # build cache, thường chiếm nhiều nhất
docker image prune -a -f     # image không container nào dùng
```

**Lỗi code (TypeScript, thiếu module, lệnh `pnpm` hỏng).** Không phải lỗi server. Chạy
`pnpm build` ở máy mình cho ra đúng lỗi đó, sửa xong push lại.

### 5.3 Build xong nhưng chết lúc dựng container

**`Bind for 0.0.0.0:3000 failed: port is already allocated`.** File compose còn `ports:` và cổng
đó đã có container khác giữ. Xem ai đang giữ:

```bash
docker ps --format '{{.Names}}  {{.Ports}}' | grep ':3000->'
ss -ltnp | grep ':3000 '
```

Sửa trong file compose: đổi `ports:` thành `expose:`. Traefik vào qua mạng nội bộ, không cần
publish cổng ra host.

**`The container name "/xxx" is already in use`.** File compose có `container_name` và tên đó
đang thuộc về container khác:

```bash
docker ps -a --format '{{.Names}}  {{.Status}}  {{.Label "com.docker.compose.project"}}' | grep xxx
```

Sửa trong file compose: xoá `container_name`. Container cũ còn sót lại thì `docker rm -f xxx`,
nhớ nhìn cột project trước để khỏi xoá nhầm của app khác.

**`service "migrate" didn't complete successfully: exit 1`.** Migration hỏng nên `web` và
`worker` không được dựng:

```bash
docker logs $APP-migrate-1 --tail 50
```

Hay gặp: `DATABASE_URL` sai, DB chưa chạy, hoặc migration đụng dữ liệu đang có.

### 5.4 Container lên rồi nhưng `unhealthy` hoặc `Restarting`

```bash
C=$APP-web-1
docker ps -a --format '{{.Names}}  {{.Status}}' | grep $APP
docker logs $C --tail 50
docker inspect $C --format '{{json .State.Health}}' | tr ',' '\n' | tail -8
```

- Log báo `Cấu hình môi trường không hợp lệ`: dòng ngay dưới ghi rõ biến nào sai. Sửa ở tab
  **Environment** rồi Deploy lại. Ví dụ đã gặp: `ADMIN_PASSWORD` ngắn hơn 8 ký tự.
- Log không có lỗi mà vẫn `unhealthy`: đọc phần `Output` của lệnh `inspect`. Đó là kết quả
  healthcheck gọi `/api/health`.
- `Restarting` liên tục kèm `exit 137`: container vượt giới hạn RAM đặt ở tab Advanced.

Xem container có nhận đúng biến không:

```bash
docker exec $C env | sort | grep -v -iE 'secret|password|key'
```

### 5.5 Container healthy nhưng domain không vào được

Triệu chứng: trình duyệt báo `NET::ERR_CERT_AUTHORITY_INVALID`, chứng chỉ ghi
`TRAEFIK DEFAULT CERT`, `http://` trả 404. Nghĩa là Traefik **không thấy** container nào khớp
domain.

Kiểm tra từ máy mình trước, không cần SSH:

```bash
D=movie.deploybox.io.vn
dig +short $D                                   # phải ra đúng IP VPS
echo | openssl s_client -connect $D:443 -servername $D 2>/dev/null | openssl x509 -noout -issuer
curl -sI http://$D | head -1
```

Rồi SSH vào server. Khối dưới tự tìm container theo domain, nên không cần biết `appName`:

```bash
D=movie.deploybox.io.vn
C=$(for c in $(docker ps -aq); do docker inspect $c --format '{{.Name}} {{json .Config.Labels}}' | grep -q "$D" && docker inspect $c --format '{{.Name}}' | tr -d /; done | head -1)
echo "== container: $C"
grep -l "$D" /etc/dokploy/traefik/dynamic/*.yml 2>/dev/null   # app loại Application thì domain nằm ở đây
[ -n "$C" ] && docker ps -a --format '{{.Names}}  {{.Status}}' | grep "$C"
[ -n "$C" ] && docker inspect $C --format '{{json .Config.Labels}}' | tr ',' '\n' | grep -i traefik
[ -n "$C" ] && docker inspect $C --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker logs dokploy-traefik --tail 300 2>&1 | grep -iE "$D|acme" | tail -10
```

| Kết quả                                             | Cách sửa                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Không tìm thấy container, cũng không có file `.yml` | Domain chưa gắn, hoặc gắn rồi chưa **Deploy** lại                                        |
| Container không `healthy`                           | Traefik bỏ qua container unhealthy. Quay lại mục 5.4                                     |
| Không có label `traefik`                            | Tab Domains: chọn đúng service và port, rồi **Deploy** lại                               |
| Thiếu mạng `dokploy-network`                        | Deploy lại. Vẫn thiếu thì xem mục 8.3 trong [HUONG_DAN_DOKPLOY.md](HUONG_DAN_DOKPLOY.md) |
| Log Traefik báo lỗi `acme` với domain này           | DNS chưa trỏ đúng IP, cổng 80 bị chặn, hoặc Cloudflare đang bật proxy                    |

Đã chạy lệnh `curl`/`openssl` ở trên thì log Traefik sẽ có dòng `Cannot retrieve the ACME
challenge ... (token "test")`. Dòng này do chính lệnh kiểm tra tạo ra, bỏ qua được.

### 5.6 Vào được domain nhưng báo `502 Bad Gateway` hoặc `Gateway Timeout`

Traefik đã thấy container nhưng gọi vào không được. Thường do khai sai **Container Port**, hoặc app
chỉ nghe `127.0.0.1`:

```bash
docker exec $C sh -c 'wget -qO- http://127.0.0.1:3000/api/health; echo; env | grep -E "^(PORT|HOSTNAME)="'
docker run --rm --network dokploy-network curlimages/curl -s -m 5 http://$C:3000/api/health
```

Lệnh đầu chạy được mà lệnh sau không: app đang nghe `127.0.0.1`. Đặt `HOSTNAME=0.0.0.0`. Cả hai
đều chạy được: Container Port trong tab Domains đang khác cổng app thật sự nghe.

### 5.7 Deploy báo xong nhưng web vẫn chạy code cũ

```bash
git -C /etc/dokploy/compose/$APP/code log --oneline -1     # commit Dokploy đã kéo về
docker inspect $APP-web-1 --format '{{.Created}}'          # container dựng lúc nào
```

Commit cũ: chưa push, push nhầm branch, hoặc auto deploy chưa bật. Commit mới mà container cũ:
bấm Deploy lại. Nếu vẫn thế thì Deployments → **Clear cache**, rồi Deploy lại.

---

## 6. Những việc không nên làm tay

- **Sửa code hay `.env` trong `/etc/dokploy/compose/<app>/code`.** Mỗi lần deploy, Dokploy clone
  lại repo và ghi đè `.env`. Sửa code thì push lên git, sửa biến thì dùng tab Environment.
- **Sửa `traefik/dynamic/<appName>.yml`.** Dokploy sinh lại file này khi lưu domain.
- **`docker compose down -v`** hoặc **`docker volume rm`**: xoá luôn dữ liệu, không lấy lại được.
- **`docker system prune -a --volumes`**: xoá mọi volume không có container nào đang gắn, kể
  cả DB đang tạm dừng. Muốn dọn đĩa thì chỉ chạy `docker builder prune -f` và
  `docker image prune -a -f`.
- **Xoá `acme.json`**: mọi domain phải xin lại chứng chỉ, dễ dính giới hạn của Let's Encrypt.
