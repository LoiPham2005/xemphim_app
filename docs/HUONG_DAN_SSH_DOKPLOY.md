# Vào các dự án Dokploy bằng SSH

Server test: `14.225.204.227` — Dokploy v0.30.6, quản trị tại `https://dokploy.deploybox.io.vn`
(tạm thời vẫn vào được `http://14.225.204.227:3000`).

> **Luật số 1:** code trong `/etc/dokploy/.../code` bị **ghi đè mỗi lần Deploy**.
> Sửa tay ở đó là mất. Sửa code → push GitHub → bấm Deploy.
>
> **Luật số 2:** sửa biến môi trường ở **tab Environment** trên giao diện, rồi **Deploy lại**.
> Sửa file `.env` trên server cũng bị ghi đè.

---

## 1. Vào server

```bash
ssh root@14.225.204.227
```

---

## 2. Bản đồ thư mục

```
/etc/dokploy/
├── compose/<AppName>/code/        ← code dự án kiểu Compose (hotfarm365 ở đây)
│                     └── .env     ← biến môi trường Dokploy ghi ra từ tab Environment
├── applications/<AppName>/code/   ← code dự án kiểu Application (hiện chưa có)
├── logs/<AppName>/                ← log từng lần Deploy (*.log)
├── traefik/
│   ├── traefik.yml                ← cấu hình Traefik chính
│   └── dynamic/                   ← route + chứng chỉ SSL (acme.json)
├── schedules/  volume-backups/  monitoring/  ssh/
```

Dữ liệu (CSDL, file upload) **không** nằm trong `/etc/dokploy` mà ở volume Docker:

```
/var/lib/docker/volumes/<AppName>_<tên volume>/_data
```

---

## 3. `AppName` là gì

Là cái tên có đuôi ngẫu nhiên, hiện dưới tên service trên giao diện Dokploy
(ví dụ `hotfarm365-app-4p5yrq`). Mọi thứ trên server đều đặt theo nó.

Không nhớ thì tra:

```bash
ls /etc/dokploy/compose/ /etc/dokploy/applications/
docker ps --format "{{.Names}}\t{{.Status}}"
```

Tên container theo mẫu:

| Kiểu dự án             | Tên container                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Compose                | `<AppName>-<service>-1` — ví dụ `hotfarm365-app-4p5yrq-app-1`                             |
| Application / Database | `<AppName>.1.<chuỗi ngẫu nhiên>` — đổi mỗi lần deploy, dùng `docker ps \| grep <AppName>` |

---

## 4. Dự án hotfarm365

| Thứ                 | Ở đâu                                                 |
| ------------------- | ----------------------------------------------------- |
| AppName             | `hotfarm365-app-4p5yrq`                               |
| Code                | `/etc/dokploy/compose/hotfarm365-app-4p5yrq/code`     |
| File compose        | `docker-compose.dokploy.yml`                          |
| Container web       | `hotfarm365-app-4p5yrq-app-1` (cổng 8000 bên trong)   |
| Container lịch chạy | `hotfarm365-app-4p5yrq-scheduler-1`                   |
| Container MySQL     | `hotfarm365-app-4p5yrq-db-1`                          |
| Volume CSDL         | `hotfarm365-app-4p5yrq_dbvolume`                      |
| Volume file upload  | `hotfarm365-app-4p5yrq_storage_app` (= `storage/app`) |
| Log deploy          | `/etc/dokploy/logs/hotfarm365-app-4p5yrq/`            |

### Vào thư mục code

```bash
cd /etc/dokploy/compose/hotfarm365-app-4p5yrq/code
git log -1 --oneline        # đang chạy commit nào
```

### Chạy lệnh artisan

```bash
docker exec -it hotfarm365-app-4p5yrq-app-1 php artisan migrate:status
docker exec -it hotfarm365-app-4p5yrq-app-1 php artisan db:seed --force
docker exec -it hotfarm365-app-4p5yrq-app-1 php artisan tinker
```

Đặt lại mật khẩu admin khi quên:

```bash
docker exec -it hotfarm365-app-4p5yrq-app-1 php artisan tinker \
  --execute="App\Models\User::where('email','admin')->update(['password'=>Hash::make('matkhaumoi')]);"
```

Mở shell bên trong container (như đang đứng trong thư mục dự án):

```bash
docker exec -it hotfarm365-app-4p5yrq-app-1 bash
# ... gõ lệnh ... xong gõ: exit
```

### Vào MySQL

```bash
docker exec -it hotfarm365-app-4p5yrq-db-1 mysql -uroot -p
# mật khẩu = DB_ROOT_PASSWORD trong tab Environment
```

Dump CSDL ra file trên server:

```bash
docker exec hotfarm365-app-4p5yrq-db-1 sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  > /root/hotfarm365_$(date +%Y%m%d_%H%M%S).sql
ls -lh /root/hotfarm365_*.sql      # file phải có dung lượng, 0 byte là hỏng
```

### Xem log

```bash
docker logs -f --tail 100 hotfarm365-app-4p5yrq-app-1          # web (Ctrl+C để thoát)
docker logs -f --tail 100 hotfarm365-app-4p5yrq-scheduler-1    # lịch chạy, queue email
docker exec hotfarm365-app-4p5yrq-app-1 tail -100 storage/logs/laravel.log
ls -t /etc/dokploy/logs/hotfarm365-app-4p5yrq/ | head -3       # log các lần deploy
```

### Khởi động lại

```bash
docker restart hotfarm365-app-4p5yrq-app-1
```

---

## 5. Tra nhanh cho mọi dự án

Thay `APP` bằng AppName của dự án:

```bash
APP=hotfarm365-app-4p5yrq

docker ps --filter "name=$APP" --format "{{.Names}}\t{{.Status}}"   # container của dự án
docker stats --no-stream $(docker ps -q --filter "name=$APP")         # RAM/CPU từng container
ls -t /etc/dokploy/logs/$APP/ | head -3                               # log deploy gần nhất
docker volume ls | grep $APP                                          # volume của dự án
```

Dokploy và Traefik (khi trang quản trị hoặc domain/SSL có vấn đề):

```bash
docker service logs --tail 100 dokploy      # Dokploy
docker logs --tail 100 dokploy-traefik      # Traefik — lỗi domain, lỗi cấp SSL
free -m && df -h /                          # RAM + ổ đĩa toàn máy
```

---

## 6. Đừng làm

| Lệnh / việc                                  | Vì sao                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docker compose down -v`                     | `-v` **xoá volume** → mất sạch CSDL và file upload                                                     |
| `docker compose up` bằng tay                 | Dokploy chèn cấu hình domain lúc Deploy; tự `up` có thể làm mất domain. Muốn chạy lại → bấm **Deploy** |
| Sửa code trong `/etc/dokploy/.../code`       | Bị ghi đè lần Deploy sau                                                                               |
| Sửa `.env` trên server                       | Bị ghi đè — sửa ở tab Environment                                                                      |
| `php artisan migrate:fresh`                  | **Xoá hết bảng** rồi tạo lại                                                                           |
| `docker system prune -a --volumes`           | Xoá cả volume đang không có container gắn vào                                                          |
| Xoá `/etc/dokploy/traefik/dynamic/acme.json` | Mất chứng chỉ SSL, phải xin lại (Let's Encrypt giới hạn số lần)                                        |

---

## 7. Dọn dẹp còn treo

- App mẫu **Hello World** (`hello-world-hubt6h-0ltfzg`) vẫn đang chạy, tốn RAM → xoá trên giao diện:
  Projects → My First Project → Hello World → nút xoá.
- `/opt/deploybox` (~5GB) còn nguyên. Khi chắc không quay lại deploybox:
  `rm -rf /opt/deploybox /opt/deploybox-backups`
