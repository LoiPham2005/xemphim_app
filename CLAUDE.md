# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

**Đọc [README.md](README.md) trước khi làm bất cứ gì** — nó đã giải thích rất kỹ kiến trúc bảo
mật (Server Action là endpoint công khai, kiểm quyền nhiều lớp độc lập), RBAC lai code/database,
mô hình mật khẩu/token, deploy (Docker vs VPS bare-metal), realtime WebSocket, và REST API cho
mobile — file CLAUDE.md này **không lặp lại** nội dung đó, chỉ bổ sung phần README chưa có và lệnh
thao tác nhanh.

## Lệnh hay dùng

```bash
pnpm dev                        # dev server, Turbopack mặc định — http://localhost:3000
pnpm build && pnpm start        # build + chạy bản production

pnpm typecheck                  # tsc --noEmit
pnpm lint                       # eslint . (thêm :fix để tự sửa)
pnpm format                     # prettier --write . (thêm :check để chỉ kiểm tra)
pnpm test                       # toàn bộ test (thêm :watch hoặc :coverage)
pnpm test:e2e                   # Playwright — tự build production rồi chạy trình duyệt thật
pnpm check                      # cả 4 lệnh trên theo thứ tự — chạy trước khi coi là xong việc

# 1 file test
pnpm test src/services/auth.service.test.ts
# 1 test theo tên (khớp chuỗi)
pnpm test -- -t "khoá tài khoản khi sai mật khẩu chạm ngưỡng"

pnpm db:generate                # sinh lại Prisma Client sau khi sửa schema.prisma
pnpm db:migrate                 # tạo + áp migration mới (dev)
pnpm db:studio                  # GUI xem/sửa data — http://localhost:5555
pnpm db:seed                # dữ liệu mẫu (roles, user demo)
pnpm db:purge                   # dọn token hết hạn + nhật ký cũ (qua tsconfig.scripts.json)

pnpm realtime:dev               # WebSocket, tiến trình riêng (cổng 3002)
pnpm worker:dev                 # job nền, tiến trình riêng — cần REDIS_URL
```

⚠️ `pnpm test:e2e` cần database đã seed (`pnpm db:seed`) — bộ test đăng nhập bằng tài
khoản mẫu. Nó tự `pnpm build && pnpm start` trên cổng 3100, cố ý chạy bản production chứ không
phải `next dev`: CSP và React Refresh khác nhau giữa hai môi trường, mà đó đúng là chỗ dễ hỏng.

⚠️ Sau khi sửa `prisma/schema.prisma`, **luôn chạy `pnpm db:generate` trước rồi tin
`pnpm typecheck` qua terminal** — IDE hay báo lỗi type cũ (client thật nằm trong
`node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client/`, TS server đôi khi cache trễ
1 nhịp). Xem [docs/GOTCHAS.md](docs/GOTCHAS.md#2-prisma-7-ide-báo-lỗi-type-sau-khi-sửa-schemaprisma-dù-code-đúng).

## Kiến trúc — điểm cần nắm trước khi đụng vào code

**Luồng dữ liệu**: route (`app/**/route.ts`, Server Action) → **service** (`src/services/*.ts`,
nơi DUY NHẤT gọi Prisma) → Prisma. Route không bao giờ query database trực tiếp; thêm tính năng
là thêm method vào service, không phải viết logic trong route.

**Hai bề mặt, một tầng nghiệp vụ**: web (Server Action, cookie session) và REST API cho mobile
(`src/app/api/**`, Bearer token) đều gọi CHUNG service layer — không có nghiệp vụ nào chỉ tồn tại
ở một phía. `getApiSession()` đọc header `Authorization` trước, fallback cookie, nên cùng logic
phục vụ được cả hai.

**Kiểm quyền độc lập ở từng lớp**, không tin lớp nào là đủ (bảng chi tiết trong README):
Proxy (`src/proxy.ts`, chỉ chặn trang, KHÔNG chạy trên `/api`) → trang (`requireAdmin`/
`requirePermission`) → **Server Action/route handler tự kiểm quyền lại** — đây là lớp bắt buộc,
2 lớp trước chỉ là UX.

**RBAC lai**: danh mục quyền tồn tại nằm trong code (`src/lib/permissions.ts`, TypeScript bắt lỗi
gõ sai tên); việc GÁN quyền cho vai trò nằm trong database (`roles`/`permissions`/
`role_permissions`), sửa được lúc chạy không cần deploy.

## Đã có kể từ README (README hơi lùi so với code hiện tại)

README mô tả kiến trúc nền tảng chính xác, nhưng các phần sau được thêm sau và **chưa được cập
nhật vào README**:

- **`User` có thêm**: `status` (`ACTIVE`/`INACTIVE`/`BANNED`, khoá thủ công bởi admin — khác
  `lockedUntil`), `failedLoginAttempts` + `lockedUntil` (khoá tạm tự động sau N lần sai mật khẩu
  liên tiếp, xem `AuthService.validateCredentials`/`registerFailedAttempt` trong
  `src/services/auth.service.ts`), `deletedAt` (xoá mềm — **`userService.softDelete()`**, không
  phải `delete()`), `passwordChangedAt` (thu hồi TỨC THÌ mọi access token đã phát trước đó, so với
  `iat` của JWT), `pendingEmail` (đổi email hai bước), `twoFactorSecret`/`twoFactorEnabledAt`.
- **Mật khẩu băm bằng Argon2id** (`@node-rs/argon2`), KHÔNG phải bcrypt. bcryptjs đã bị gỡ hẳn.
  Mã ngắn (OTP, mã khôi phục) băm bằng `hashScopedToken(scope, token)` — SHA-256 có tiền tố phạm
  vi, ngăn mã của luồng này dùng được ở luồng kia.
- **Một người mang NHIỀU vai trò** (`userRoles`), không phải một. Quyền = hợp(mọi vai trò) + cấp
  thêm riêng − tước riêng; **cấm luôn thắng**. `roleKey` (số ít) đã thành `roleKeys` (mảng) ở mọi
  schema và endpoint.
- **`Role.level`** — bậc quyền lực, chặn leo thang đặc quyền: `assertCanActOn` từ chối khi mục
  tiêu có `level` ≥ `level` của người thao tác. Không có nó thì một ADMIN sửa/xoá được SUPER_ADMIN.
- **Ngoại lệ quyền theo TỪNG người** (`UserPermission`, có `expiresAt`): "hai tài khoản cùng vai
  trò nhưng admin cho một người thêm quyền" giải bằng một dòng ngoại lệ, không phải bằng một vai
  trò mới cho một người. API: `GET/PUT /api/v1/users/[id]/permissions`,
  `DELETE .../permissions/[permissionKey]`.
- **Đăng nhập OAuth** (Google/Github/Facebook/Apple) — tự viết bằng `fetch`/`jose`
  (`src/lib/oauth/*`, `src/services/oauth.service.ts`), **không dùng thư viện `arctic`** (đã bị
  tác giả deprecate, xem GOTCHAS #5). Route: `/api/auth/oauth/[provider]/{start,callback}`.
- **API mới**: `PATCH /api/v1/users/[id]/status` (khoá/mở khoá), `POST /api/v1/users/[id]/unlock`
  (mở khoá sớm) — cả hai cần quyền `user:update`. Thêm `PATCH /api/v1/users/[id]` (sửa hồ sơ):
  chính mình cần `profile:update:own`, người khác cần `user:update`, **riêng `roleKeys` luôn đòi
  `user:update`** kể cả khi sửa chính mình — nếu không thì mọi user tự phong ADMIN được bằng một
  field trong body.
- **Quản trị vai trò** (`roleService`, `/roles`, `/api/v1/roles*`): ba bảng RBAC giờ có đường ghi
  từ ứng dụng, trước đây chỉ sửa được bằng SQL tay. Bốn quyền mới: `role:read/create/update/delete`
  — nhớ `pnpm db:seed` sau khi pull để đồng bộ danh mục quyền xuống database. Mọi đường ghi phân
  quyền BẮT BUỘC gọi `permissionService.invalidate()`.
- **Trang cho luồng email**: `/forgot-password`, `/reset-password`, `/verify-email`,
  `/confirm-email-change` (trong `(auth)/`). Link trong email trỏ tới đây; trước đó chỉ có REST API nên bấm link là 404.
  `/verify-email` cố ý xác thực khi BẤM NÚT chứ không khi mở trang — bộ quét link của Gmail sẽ
  đốt mất token dùng-một-lần trước khi người dùng kịp bấm.
- **Rate limit có store cắm được** (`src/lib/rate-limit.ts`): `REDIS_URL` → Redis, không có →
  RAM. Hàm đã thành **async**, nên `rateLimit()`/`resetRateLimit()`/`enforceRateLimit()` đều phải
  `await`. Redis chết thì fail-open (tạm cho qua), có chủ đích.
- **Route group `(admin)`**: `/users` và `/roles` nằm ở `src/app/(admin)/` (URL không đổi). Quy tắc
  đặt route group cho trang mới: chỉ tạo group khi có ranh giới quyền hạn thật + khả năng cần
  layout riêng — trang ai đăng nhập cũng xem được thì để thẳng ngoài `app/`, không group.
- **E2E Playwright** (`e2e/`): lớp duy nhất bắt được loại lỗi "form gửi tên trường khác với
  schema" — typecheck không thấy (`safeParse` nhận `unknown`), unit test không thấy (gọi thẳng
  service). Giữ bộ này HẸP, chỉ những luồng mà hỏng là dịch vụ chết.
- **Ngưỡng coverage theo vùng** (`vitest.config.ts`): `src/services/**` và `src/lib/api/**`. Ý
  nghĩa là "không được tụt" — đừng hạ ngưỡng để CI xanh.
- **`tsconfig.scripts.json`**: script Node ngoài Next (như `pnpm db:purge`) cần nó để stub
  `server-only`. Đừng đưa alias đó vào `tsconfig.json` gốc — làm vậy là gỡ chốt chặn cho cả app.
- **Giao diện đã chốt MỘT hệ: Shadcn-style trong `src/components/ui/`.** Trước đó dự án có hai hệ
  song song — class thủ công (`.btn`, `.input-field`) ở `globals.css` và component Tailwind ở
  `ui/`. Chính chỗ hai hệ chạm nhau đã đẻ ra hai bug thật: header trắng đè nền tối, và nút chữ
  chàm trên nền chàm. Nay `.btn*`/`.input-field` đã bị xoá khỏi `globals.css`; **nút và ô nhập
  luôn dùng `<Button>`/`<Input>`**. Class CSS chỉ còn giữ những thứ thuần trình bày, không có
  trạng thái: `.card`, `.badge`, `.alert`, `.container`, `.form-grid`.
- **`ui/` chỉ giữ component có nơi dùng thật.** Hiện có đúng `button.tsx` và `input.tsx`; 6 file
  chưa ai dùng (avatar, badge, card, dialog, dropdown-menu, skeleton) đã bị xoá cùng 4 dependency
  chết. Cần lại thì `npx shadcn add <tên>` — nhanh hơn và chuẩn hơn bản tự viết để đó.
- **`(admin)/layout.tsx`** lo sidebar + `requireUser()` chung cho khu quản trị. ⚠️ Layout **không
  phải ranh giới bảo mật** — Server Action không đi qua nó. Mỗi trang vẫn tự `requirePermission`
  (mỗi trang cần quyền khác nhau), mỗi action vẫn tự kiểm quyền.
- **`src/lib/cn.ts`** (đổi tên từ `utils.ts`) — chỉ chứa hàm `cn()`. Tên `utils` là bãi rác, đổi
  tên để không ai nhét hàm không liên quan vào. `format.ts` (tiền VNĐ, ngày `vi-VN`, số điện thoại VN, slug bỏ dấu) hiện chưa nơi nào gọi tới, nhưng **được giữ lại** vì không lệnh nào tạo lại được — khác hẳn component shadcn. Bù lại nó có `format.test.ts` phủ kín: tiện ích chưa dùng mà không test thì tới ngày cần dùng mới phát hiện đã hỏng.
- **Chưa có backup database tự động** — self-host Postgres qua Docker Compose, VPS mất là mất data.
  Xem [docs/disaster-recovery.md](docs/disaster-recovery.md) và
  [docs/HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md](docs/HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md).

## Hạ tầng đã có (thêm sau khi README được viết)

Sáu lớp dưới đây đều theo **cùng một khuôn**: một interface hẹp + bản mặc định cho dev, cắm nhà
cung cấp thật bằng một hàm `setX()` lúc khởi động. Giống hệt `src/lib/mailer.ts` — bộ khung cố ý
không chọn sẵn nhà cung cấp cho bạn.

| Lớp                      | File                                   | Mặc định khi chưa cấu hình                                 |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------- |
| Kiểm quyền Server Action | `src/lib/define-action.ts`             | — (luôn bật)                                               |
| Cache                    | `src/lib/cache.ts`                     | RAM tiến trình                                             |
| Job queue                | `src/lib/queue.ts` + `worker/`         | Dev: chạy ngay tại chỗ · Prod: **ném lỗi**                 |
| Cờ bật/tắt tiến trình    | `src/lib/feature-flag.ts`              | Bật (`1`) — xem bảng ngay dưới bảng này                    |
| Nhật ký thao tác         | `src/services/audit.service.ts`        | — (luôn ghi)                                               |
| Giám sát lỗi             | `src/lib/observability.ts`             | Không làm gì (log vẫn có)                                  |
| Lưu trữ file             | `src/lib/storage.ts` + `storage-s3.ts` | Có `S3_BUCKET` → S3 · không: dev ghi đĩa, prod **ném lỗi** |

**Hai lớp trong số đó tắt được bằng biến môi trường** — dự án nào không cần thì
bỏ hẳn tiến trình, không phải xoá code:

| Biến               | `1` (mặc định)                  | `0`                                                      |
| ------------------ | ------------------------------- | -------------------------------------------------------- |
| `QUEUE_ENABLED`    | `enqueue()` → Redis → `worker/` | `enqueue()` chạy job NGAY trong request; không cần Redis |
| `REALTIME_ENABLED` | Dựng tiến trình `realtime/`     | Không dựng                                               |

- **Chỉ nhận `1`/`0`, KHÔNG nhận `true`/`false`** — `docker-compose.yml` dùng
  chính hai biến này làm `deploy.replicas`, mà Compose chỉ hiểu số. Dùng chung
  một biến cho app lẫn hạ tầng là có chủ đích: tách đôi thì sẽ có ngày app đẩy
  job vào Redis trong khi không worker nào chạy — im lặng hoàn toàn. Định nghĩa
  ở `src/lib/feature-flag.ts`, dùng lại trong cả ba schema env (app, worker,
  realtime).
- **Tắt hàng đợi không mất tính năng nào**, chỉ đổi chỗ chạy. Cái mất là **thử
  lại tự động**: lỗi trong handler bung thẳng ra request thay vì lùi vài giây
  rồi chạy lại.
- **Cách tắt theo từng đường deploy**: Docker `docker compose up -d` (tự gỡ
  container) · PM2 `ecosystem.config.cjs` lọc app ra khỏi danh sách, và
  `deploy-pm2.sh` gọi `pm2 delete` cho app đã bị lọc · systemd phải
  `systemctl disable --now` — biến môi trường chỉ làm tiến trình tự thoát, mà
  `Restart=always` bật lại ngay.
- **`/api/health` trả `features`** — `queue` có ba trạng thái: `redis` (chạy nền
  thật), `inline` (cờ bật nhưng thiếu `REDIS_URL` — gần như luôn là nhầm), `off`
  (đã tắt có chủ đích). Không có nó thì worker chết im lặng trông hệt như dự án
  cố ý không dùng hàng đợi.

Vài điểm dễ sai:

- **`defineAction` biến kiểm quyền thành ràng buộc KIỂU.** Mọi Server Action mới phải bọc bằng nó
  — không khai báo quyền là không biên dịch được. Đừng quay lại lối viết `if (!session) return`
  thủ công: quên một chỗ thì không có gì báo.
- **Job queue: `enqueue()` ném lỗi trên production khi thiếu `REDIS_URL`.** Cố ý — job bị nuốt
  trong im lặng nghĩa là email không bao giờ gửi mà không ai biết. Mọi email đã đi qua hàng đợi.
  Phân biệt rõ hai chuyện: thiếu `REDIS_URL` là **quên** (ném lỗi), `QUEUE_ENABLED=0` là **chọn**
  (chạy thẳng, kể cả trên production, không cảnh báo).
- **`worker/` là tiến trình thứ ba**, sau `web` và `realtime`. Cả ba đường deploy đã nối sẵn.
  Thiếu nó thì job nằm trong Redis mà không ai chạy.
- **`logger.error()` tự đẩy sang `captureException`** — không cần rải `Sentry.captureException`
  khắp nơi, và cũng đừng làm vậy.
- **`assertUploadAllowed` đọc magic bytes, không tin `file.type`.** Với ảnh thì "không chứng minh
  được là ảnh" = từ chối (danh sách trắng). Với PDF/zip thì chưa kiểm được nội dung — phục vụ
  chúng từ tên miền khác kèm `Content-Disposition: attachment`.
- **Tệp tải lên** (`src/services/file.service.ts`, bảng `files`, trang `/files`): HAI đường — qua
  máy chủ (`POST /files` multipart: ảnh 5MB, tài liệu 20MB, âm thanh 50MB) và TRỰC TIẾP lên S3
  (`POST /files/uploads` -> client PUT -> `POST /files/{id}/complete`: video 4GB). Mọi định dạng
  kiểm magic bytes (danh sách trắng — TXT/CSV cố ý không cho vì không kiểm được). Bảng nghiệp vụ
  trỏ tới bằng khoá ngoại (`UserProfile.avatarFileId`), KHÔNG lưu URL. Tệp mồ côi (không gắn,
  không `retained`) quá 24h bị `db:purge` xoá cả trên kho. Quyền: `file:upload` = tệp của mình,
  `file:manage` = mọi tệp. CSP tự mở origin bucket/CDN (`src/lib/storage-origin.ts`).
- **Audit log KHÔNG có khoá ngoại tới `users`** — nhật ký phải sống lâu hơn đối tượng nó ghi lại.
  `record()` nuốt mọi lỗi để không làm hỏng thao tác chính; cần chắc chắn thì dùng
  `recordOrThrow()` trong cùng transaction.

- **`GET`/`DELETE /api/v1/auth/sessions[/id]`** — màn "thiết bị đang đăng nhập". Ràng buộc quyền
  sở hữu nằm TRONG câu truy vấn (`where: { id, userId }`), không phải một phép kiểm tra riêng —
  `id` đến từ URL nên người gọi tự đặt được. Trả 404 cho cả "không tồn tại" lẫn "của người khác".
  `TokenPair` có `sessionId` để client tự nhận ra phiên của mình. Đó là **`familyId`**, không phải
  id bản ghi token, nên nó **ổn định qua mọi lần refresh** — lưu một lần là đủ, và nó khớp với `id`
  mà `GET /auth/sessions` trả về.
- **`/users` phân trang theo SỐ TRANG** (`page`/`limit`), không phải cursor: màn quản trị cần nhảy
  tới "trang 7" và cần biết TỔNG số bản ghi — cursor không cho cả hai. `userService.list()` trả
  `{ items, meta }` trong MỘT lần gọi, nên không có chuyện đếm và lấy trang nhìn thấy hai trạng
  thái khác nhau của bảng.

## Xác thực hai lớp, passkey, và các endpoint mới

- **2FA (TOTP)**: `src/services/two-factor.service.ts`. Bật là BA bước —
  `POST /auth/2fa/setup` (sinh QR, CHƯA bật) → người dùng quét → `POST /auth/2fa/enable` (mã đúng
  mới bật, trả mã khôi phục). Bước cuối chứng minh app xác thực đã lưu đúng bí mật; bật ngay từ
  bước 1 thì người quét hỏng bị khoá vĩnh viễn khỏi tài khoản của chính mình.
  Bí mật TOTP **mã hoá AES-256-GCM** bằng `ENCRYPTION_KEY` — thiếu khoá thì giao diện tự ẩn nút.
- **Passkey/WebAuthn**: `src/services/webauthn.service.ts` + `@simplewebauthn/*` v14. Đăng nhập
  bằng passkey **KHÔNG hỏi thêm 2FA** dù tài khoản có bật: `userVerification: "required"` đã là
  hai yếu tố, hỏi thêm chỉ đẩy người dùng quay về mật khẩu.
- **Vé (`src/lib/tickets.ts`)** — JWT ngắn hạn KHÔNG phải phiên: `2fa`, `webauthn_reg`,
  `webauthn_auth`. Cả bốn loại token ký bằng cùng `SESSION_SECRET`, nên chữ ký đúng không chứng
  minh được token dùng vào việc gì. `verifySession()` chỉ nhận `typ: "access"`, `verifyTicket()`
  chỉ nhận đúng loại vé được hỏi. Thiếu phép kiểm đó là 2FA bị bỏ qua sạch.
- **Trang `/security`** — người dùng tự bật/tắt 2FA, quản lý passkey. QR **vẽ trong trình duyệt**
  bằng `qrcode`, không gọi dịch vụ sinh QR nào: chuỗi `otpauth://` chứa chính bí mật TOTP.
- **`POST /auth/login` có HAI hình dạng response**: token, hoặc `{ twoFactorRequired, challengeToken }`.
  Khác hẳn nhau có chủ đích để client buộc phải rẽ nhánh tường minh.
- **Nhóm endpoint mới**: `/auth/2fa/*`, `/auth/passkeys/*`, `/auth/change-email[/confirm]`,
  `/auth/phone/{request-otp,verify}`, `DELETE /auth/sessions` (đăng xuất mọi thiết bị khác),
  `/auth/oauth/{providers,linked}` + `DELETE /auth/oauth/[provider]`, `/notifications/*`,
  `/devices`, `/audit-logs`, `/permissions`, `/files`, `/users/[id]/{roles,permissions}`.
- **`PHONE_OTP` dựng sẵn nhưng MẶC ĐỊNH TẮT** (`PHONE_VERIFICATION_ENABLED=0`). Khác email, mỗi
  SMS tốn tiền thật — bật là một quyết định có chi phí. Ba mức chặn độc lập: hạn mã, chờ giữa hai
  lần gửi, trần mỗi số mỗi ngày.

## OpenAPI: dùng `z.toJSONSchema()` của Zod 4, KHÔNG dùng zod-to-openapi

`src/lib/openapi/registry.ts` tự dựng tài liệu bằng API có sẵn của Zod 4. Đừng thêm lại
`@asteasolutions/zod-to-openapi`: thư viện đó vá `.openapi()` vào `ZodType.prototype` bằng một
module chỉ có side effect và đòi module ấy chạy TRƯỚC mọi schema — điều kiện Turbopack không giữ
khi gom bundle production. Hậu quả: `next dev` và `vitest` chạy đúng, `next build` đổ với
`t.openapi is not a function`, tức là chỉ hỏng ở bước cuối trước khi deploy.

`registry.test.ts` so khớp HAI CHIỀU giữa `src/app/api/v1/**/route.ts` và `document.paths` — thêm
endpoint mà quên khai báo là đỏ ngay, thay vì lộ ra ở SDK sinh tự động nhiều ngày sau.

## Tài liệu khác trong `docs/`

- [DEPLOY_COOLIFY.md](docs/DEPLOY_COOLIFY.md) — deploy bằng Coolify (self-hosted PaaS). Bắt buộc
  chọn build pack **Docker Compose**, vì dự án cần 5 service chạy cùng nhau. Coolify tự cài
  Docker và có proxy riêng — **đừng cài Caddy tay**, sẽ tranh cổng 80/443.
- ⚠️ **Cổng trong `docker-compose.yml` phải bind `127.0.0.1:`.** `ufw` KHÔNG chặn được cổng do
  Docker công bố (Docker ghi luật vào chuỗi DOCKER của iptables, đứng trước ufw), nên bỏ tiền
  tố loopback là Postgres nghe thẳng trên IP công khai — và `ufw deny 5432` không cứu được.
- [DEPLOY_VPS.md](docs/DEPLOY_VPS.md) — deploy lên VPS bằng Docker / systemd / PM2. Cả ba đường
  đều chạy **hai** tiến trình (web + realtime); thiếu cái thứ hai thì WebSocket im lặng không hoạt
  động. Caddyfile phải có khối `/socket.io/*` sang cổng 3002, nếu không realtime chạy mà không ai
  tới được. PM2 mặc định 1 instance và **chặn** cluster khi thiếu `REDIS_URL` — nhiều tiến trình
  không Redis là ngưỡng rate limit bị nhân lên, im lặng.

- [GOTCHAS.md](docs/GOTCHAS.md) — bug/bẫy đã gặp thật + cách xử lý, đọc trước khi debug lỗi quen mặt.
- [disaster-recovery.md](docs/disaster-recovery.md) — khôi phục backup, rollback deploy, xoay vòng secret, mất VPS.
- [HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md](docs/HUONG_DAN_CHON_CONG_NGHE_HA_TANG.md) — so sánh database/object-storage/VPS managed (Neon, Supabase, R2, VPS Việt Nam...) kèm giá thật đã kiểm chứng.
- [HUONG_DAN_DUNG_DBEAVER_VA_PRISMA_STUDIO.md](docs/HUONG_DAN_DUNG_DBEAVER_VA_PRISMA_STUDIO.md) — cách xem/sửa database, kể cả kết nối production qua SSH tunnel.
- [HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md](docs/HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md) — deploy nhiều dự án trên 1 VPS bằng Coolify.

## Nguyên tắc khi thêm cấu trúc mới

Dự án này **cố tình tối giản** — không dựng sẵn thư mục/pattern cho nhu cầu chưa tồn tại
(`src/hooks/`, `src/types/`, `src/features/` đều đã bị từ chối vì lý do này). Trước khi tạo
component/hook/type/route-group mới, tự hỏi: đã có ≥2 nơi cần dùng thật chưa, hay đang tạo "để sau
dùng"? Nếu là vế sau, đợi tới khi có nhu cầu thật.
