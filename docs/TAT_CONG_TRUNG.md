# Tắt cổng bị chiếm (port đang bận)

Gặp khi chạy `pnpm run dev` mà báo:

```
⚠ Port 3000 is in use by process 25135, using available port 3001 instead.
⨯ Another next dev server is already running.
- PID: 25135
```

Nghĩa là **đã có một server dev chạy sẵn** từ lần trước chưa tắt.

---

## Cách nhanh nhất

Next.js đã in sẵn PID cho bạn. Chỉ cần:

```bash
kill 25135      # thay 25135 bằng PID mà Next in ra
pnpm run dev
```

**Nhưng khoan** — trước khi tắt, xem thử có phải nó vẫn đang chạy ngon không:

```
You can access the existing server at http://localhost:3000
```

Nhiều khi bạn chỉ cần mở `http://localhost:3000` là xong, **không phải tắt gì cả**. Chỉ tắt khi server cũ bị treo hoặc bạn đã đổi `.env` / `next.config.mjs` (những thứ chỉ nạp lúc khởi động).

---

## Khi không biết PID

### 1. Xem ai đang giữ cổng

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Ra kiểu:

```
COMMAND   PID  USER   FD   TYPE   NAME
node    25135 loipd   13u  IPv6   TCP *:3000 (LISTEN)
```

Cột **PID** là số cần dùng.

> `-nP` để không tra ngược tên miền và tên cổng — chạy ra kết quả ngay thay vì đợi vài giây.

### 2. Tắt

```bash
kill 25135
```

### 3. Kiểm lại đã tắt chưa

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Không in gì = cổng đã trống.

---

## Gộp thành một dòng

```bash
lsof -ti:3000 | xargs kill
```

`-t` chỉ in PID trần, đưa thẳng cho `kill`.

Cổng đang trống thì `xargs` vẫn gọi `kill` với tay trắng và báo lỗi vặt. Muốn sạch:

```bash
lsof -ti:3000 | xargs -r kill 2>/dev/null || true
```

---

## ⚠️ Cạm bẫy: có **hai** tiến trình, không phải một

Chạy `next dev` sinh ra một cặp cha–con:

```
PID    PPID   COMMAND
25129  25096  node .../next/dist/bin/next dev --turbopack   <- tiến trình CHA
25135  25129  next-server (v16.3.1)                          <- CON, chính nó giữ cổng 3000
```

Nên hai lệnh dưới đây cho ra **hai số khác nhau**:

| Lệnh                  | Ra PID  | Là ai               |
| --------------------- | ------- | ------------------- |
| `lsof -ti:3000`       | `25135` | con — đang giữ cổng |
| `pgrep -f "next dev"` | `25129` | cha                 |

Next in ra PID nào thì tắt PID đó là được — cha chết thì con chết theo, và ngược lại
cha cũng tự thoát khi con mất.

Nhưng nếu tắt xong mà chạy lại **vẫn báo bận**, gần như chắc chắn còn sót một trong hai.
Lúc đó dùng lệnh gom cả cụm:

```bash
pkill -f "next dev"; lsof -ti:3000 | xargs -r kill
```

---

## Khi `kill` không ăn

`kill` chỉ **xin** tiến trình tự thoát. Tiến trình treo hẳn thì không nghe. Lúc đó mới dùng `-9`:

```bash
kill -9 25135
```

> **Để `-9` là phương án cuối.** Nó chặt ngang, không cho dọn dẹp — file tạm trong `.next/` có thể còn dở dang. Nếu sau đó dev server chạy lỗi lạ, xoá cache là hết:
>
> ```bash
> rm -rf .next
> pnpm run dev
> ```

---

## Tắt mọi tiến trình Next đang chạy

Khi mở nhiều terminal và không nhớ đã bật bao nhiêu cái:

```bash
pkill -f "next dev"
```

Kiểm trước cho chắc, tránh tắt nhầm:

```bash
pgrep -fl "next dev"
```

---

## Chạy cổng khác thay vì tắt

Nhiều khi cần chạy **hai dự án cùng lúc**:

```bash
pnpm run dev -- -p 3005
```

Hoặc cố định trong `.env`:

```
PORT=3005
```

Thực ra Next đã tự làm giúp — nó nhảy sang 3001. Chỉ có điều nó **chặn hai server dev trong cùng một thư mục**, nên vẫn báo lỗi.

---

## Bảng tra nhanh

| Việc                      | Lệnh                                                  |
| ------------------------- | ----------------------------------------------------- |
| Xem ai giữ cổng 3000      | `lsof -nP -iTCP:3000 -sTCP:LISTEN`                    |
| Tắt theo PID              | `kill 25135`                                          |
| Tắt gọn một dòng          | `lsof -ti:3000 \| xargs kill`                         |
| Tắt cứng (khi treo)       | `kill -9 25135`                                       |
| Tắt mọi server Next       | `pkill -f "next dev"`                                 |
| Chạy cổng khác            | `pnpm run dev -- -p 3005`                             |
| Dọn cache sau khi kill -9 | `rm -rf .next`                                        |
| Tắt sạch cả cha lẫn con   | `pkill -f "next dev"; lsof -ti:3000 \| xargs -r kill` |

---

## Các cổng khác của dự án này

Ngoài web còn có `realtime` và `worker` (xem `package.json`). Cách xem cũng vậy, chỉ đổi số cổng:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

Xem một lượt mọi cổng Node đang mở:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep node
```

---

## Vì sao hay bị

Đóng tab terminal **không** giết tiến trình con — `next dev` chạy tiếp dưới nền.

Tránh bằng cách luôn dừng bằng `Ctrl + C` trong terminal đang chạy, thay vì đóng cửa sổ.
