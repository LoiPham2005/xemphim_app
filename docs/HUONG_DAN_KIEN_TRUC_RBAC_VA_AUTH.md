# 🚀 Hướng Dẫn Kiến Trúc & Lộ Trình Phát Triển Hệ Thống RBAC & Auth (Next.js + Prisma)

Tài liệu này cung cấp hướng dẫn toàn diện về kiến trúc phân quyền **RBAC (Role-Based Access Control)**, cơ chế xác thực bảo mật và các bước triển khai/mở rộng trong dự án `xemphim`.

---

## 📌 1. Triết Lý Thiết Kế & Kiến Trúc

### 1.1. Tại sao KHÔNG tách riêng bảng `Admin` và bảng `User`?

- **Tránh trùng lặp mã nguồn (DRY):** Hệ thống xác thực (Bcrypt hash, JWT access token, Refresh Token rotation, OAuth Google/Github/Apple, OTP Email) được dùng chung cho mọi đối tượng.
- **Dễ mở rộng vai trò (Extensibility):** Hỗ trợ thêm nhiều vai trò mới như `SUPER_ADMIN`, `ADMIN`, `MODERATOR`, `ACCOUNTANT`, `USER`, `VIP_USER` mà không cần sửa cấu trúc bảng cơ sở dữ liệu.
- **Tối ưu quan hệ dữ liệu (Data Integrity):** Các bảng nghiệp vụ (`AuditLog`, `Order`, `Post`, `Comment`...) chỉ cần trỏ khóa ngoại `userId` duy nhất về bảng `User`.

### 1.2. Sơ đồ dữ liệu (Entity Relationship Diagram)

```mermaid
erDiagram
    Role ||--o{ RolePermission : "has"
    Permission ||--o{ RolePermission : "belongs to"
    User ||--o{ UserRole : "has"
    Role ||--o{ UserRole : "assigned to"
    User ||--o{ UserPermission : "direct grants/revokes"
    Permission ||--o{ UserPermission : "applied to"
    User ||--o| UserProfile : "has profile"
    User ||--o{ OAuthAccount : "OAuth links"
    User ||--o{ RefreshToken : "sessions"
    User ||--o{ UserDevice : "push tokens"
    Notification ||--o{ NotificationRecipient : "sent to"
    User ||--o{ NotificationRecipient : "receives"
    User ||--o{ VerificationToken : "OTP/Reset tokens"
    User ||--o{ AuditLog : "acts on"

    Role {
        string id PK
        string key UK "SUPER_ADMIN | ADMIN | MANAGER | STAFF | CUSTOMER | USER"
        string name
        boolean isSystem "Không cho phép xóa nếu true"
    }

    Permission {
        string id PK
        string key UK "user:read | user:create | role:update"
        string description
    }

    RolePermission {
        string roleId PK,FK
        string permissionId PK,FK
    }

    UserRole {
        string userId PK,FK
        string roleId PK,FK
    }

    UserPermission {
        string userId PK,FK
        string permissionId PK,FK
        boolean isGranted "true = cấp thêm, false = tước bỏ"
    }

    UserProfile {
        string id PK
        string userId FK
        string fullName
        string avatarUrl
        string phoneNumber
    }

    User {
        string id PK
        string email UK
        string password
        string roleId FK
        enum status "ACTIVE | INACTIVE | BANNED"
        int failedLoginAttempts
        datetime lockedUntil
        datetime deletedAt "Soft delete"
    }
```

---

## 🛠️ 2. Quy Trình Hoạt Động Cốt Lõi (Core Workflows)

### 2.1. Luồng Xác thực (Authentication)

1. **Đăng nhập (Password hoặc OAuth):**
   - Kiểm tra `status === ACTIVE` và `lockedUntil < now()`.
   - Nếu đăng nhập sai quá số lần quy định (`failedLoginAttempts >= 5`) -> Khóa tạm thời tài khoản (`lockedUntil = now() + 15m`).
   - Cấp cặp Token:
     - **Access Token (JWT ngắn hạn - 15 phút):** Chứa `userId`, `roleKey`, và danh sách `permissions` (hoặc truy vấn nhanh qua cache Redis).
     - **Refresh Token (Dài hạn - 7 ngày):** Lưu bản băm `tokenHash` trong bảng `RefreshToken` (áp dụng Refresh Token Rotation chống trộm token).

2. **Đăng xuất:**
   - Cập nhật `revokedAt = now()` trong bảng `RefreshToken` tương ứng với session hiện tại.

---

### 2.2. Luồng Phân Quyền (Authorization Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Middleware as Next.js Middleware / Route Handler
    participant Guard as Permission Guard / RBAC Service
    participant Cache as Redis / In-Memory Cache
    participant DB as PostgreSQL (Prisma)

    Client->>Middleware: Gửi Request kèm Access Token (Bearer)
    Middleware->>Guard: Kiểm tra tính hợp lệ của Token & Route
    Guard->>Cache: Lấy Permissions của User theo RoleId
    alt Cache Miss
        Guard->>DB: Query Role & Permissions từ DB
        DB-->>Guard: Danh sách Permissions
        Guard->>Cache: Lưu Cache (TTL 5-10m)
    end
    Guard-->>Middleware: Kiểm tra User có Permission yêu cầu không? (vd: 'user:delete')
    alt Đủ quyền
        Middleware->>Client: Trả về kết quả (200 OK)
    else Thiếu quyền
        Middleware->>Client: 403 Forbidden
    end
```

---

## 📋 3. Lộ Trình Triển Khai & Phát Triển (Development Roadmap)

### Giai Đoạn 1: Seeding Dữ Liệu & Khởi Tạo Phân Quyền Cơ Bản

- [x] **Tạo Permissions chuẩn theo định dạng `resource:action` (kèm `category` và `name`)**:
  - Quản lý người dùng: `user:read`, `user:create`, `user:update`, `user:delete`
  - Hồ sơ cá nhân: `profile:read:own`, `profile:update:own`
  - Quản lý vai trò & quyền: `role:read`, `role:create`, `role:update`, `role:delete`
  - Nhật ký hệ thống: `audit:read`
  - Thông báo & Chiến dịch: `notification:read`, `notification:send`
- [x] **Tạo 5 Roles mặc định chuẩn mực (`isSystem: true`)**:
  - `SUPER_ADMIN` (Quản trị cấp cao): Toàn quyền tối cao mọi chức năng hệ thống.
  - `ADMIN` (Quản trị viên): Quản lý người dùng, phân quyền, gửi thông báo và xem audit log.
  - `MANAGER` (Quản lý chi nhánh / Trưởng phòng): Quản lý nhân sự, gửi thông báo nội bộ.
  - `STAFF` (Nhân viên CSKH / Vận hành): Xem thông tin người dùng, hỗ trợ khách hàng, xem thông báo.
  - `USER` (Khách hàng / Người dùng thông thường): Thao tác trên hồ sơ của chính mình (`:own`) và xem thông báo.
- [x] Đã cấu hình hoàn chỉnh bộ file `prisma/seeds/` (`seed-rbac.ts`, `seed-prod.ts`, `seed-dev.ts`).

---

### Giai Đoạn 2: Xây Dựng Service & Middleware Bảo Vệ

- [ ] **Tạo Utility / Decorator kiểm tra quyền (`requirePermission`)**:
  ```typescript
  // Ví dụ hàm guard kiểm tra quyền trong Route Handler
  export async function checkPermission(
    userId: string,
    requiredPermission: string,
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    if (!user || user.status !== "ACTIVE") return false;
    if (user.role.key === "SUPER_ADMIN") return true; // Super admin bypass

    return user.role.permissions.some((rp) => rp.permission.key === requiredPermission);
  }
  ```
- [ ] Tích hợp ghi `AuditLog` tự động mỗi khi có thay đổi quan trọng (gán quyền, khóa tài khoản, đổi mật khẩu).

---

### Giai Đoạn 3: Nâng Cấp Nâng Cao (Khi Hệ Thống Phát Triển Lớn)

#### 1. Tách Hồ Sơ Người Dùng (`UserProfile`)

Tránh để bảng `User` bị phình to khi thêm các trường như địa chỉ, ảnh đại diện, ngày sinh, CCCD/CMND:

```prisma
model UserProfile {
  id          String    @id @default(cuid())
  userId      String    @unique
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  fullName    String?
  avatarUrl   String?
  phoneNumber String?
  address     String?
  birthday    DateTime?

  @@map("user_profiles")
}
```

#### 2. Chuyển Sang Mô Hình Multi-Role (Nếu 1 User có nhiều vai trò)

Nếu nghiệp vụ yêu cầu một người vừa làm `STAFF` vừa làm `ACCOUNTANT`:

```prisma
model UserRole {
  userId String
  roleId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role   @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@map("user_roles")
}
```

#### 3. Cấp / Chặn Quyền Trực Tiếp Cho Từng User (`UserPermission`)

Giải quyết bài toán: **2 người có cùng vai trò `STAFF`, nhưng Nhân viên A được sếp cấp thêm quyền `order:delete` (hoặc bị tước quyền `order:create`), còn Nhân viên B thì không.**

```prisma
model UserPermission {
  userId       String
  permissionId String
  isGranted    Boolean  @default(true) // true = CẤP THÊM quyền, false = CHẶN quyền (Revoke)
  grantedBy    String?  // ID của Admin đã cấp quyền này (phục vụ audit)
  createdAt    DateTime @default(now())

  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([userId, permissionId])
  @@index([permissionId])
  @@map("user_permissions")
}
```

> **⚡ Thuật toán tính quyền thực tế (Effective Permissions):**  
> $$\text{Quyền thực tế} = (\text{Tổng Permissions từ các Roles}) + (\text{Quyền cấp thêm}) - (\text{Quyền bị chặn})$$

```typescript
export async function getUserEffectivePermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
      userPermissions: {
        include: { permission: true },
      },
    },
  });

  if (!user) return [];

  // 1. Gộp toàn bộ quyền từ các Roles
  const permissions = new Set<string>();
  user.userRoles.forEach((ur) => {
    ur.role.permissions.forEach((rp) => {
      permissions.add(rp.permission.key);
    });
  });

  // 2. Áp dụng quyền cấp thêm (isGranted: true) hoặc tước bỏ (isGranted: false)
  user.userPermissions.forEach((up) => {
    if (up.isGranted) {
      permissions.add(up.permission.key);
    } else {
      permissions.delete(up.permission.key);
    }
  });

  return Array.from(permissions);
}
```

#### 4. Tối Ưu Hiệu Năng Với Redis Cache

- Cache danh sách `permissions` của từng `roleKey` hoặc `userId` vào Redis với TTL ngắn (5 - 15 phút).
- Khi Admin cập nhật quyền của Role hoặc User -> Xóa cache (Cache Invalidation) để quyền mới có hiệu lực ngay lập tức mà không cần chờ token hết hạn.

---

### Giai Đoạn 4: Push Notification Chuẩn Enterprise (Direct, Topic & Broadcast)

#### 1. Tại sao `RefreshToken` KHÔNG THỂ thay thế bảng `UserDevice`?

- **`RefreshToken` (Session Auth):** Vòng đời ngắn, thay đổi liên tục khi xoay vòng token (Refresh Token Rotation) hoặc bị xóa khi hết hạn (7-30 ngày). 1 máy mở nhiều tab có thể sinh nhiều dòng `RefreshToken`.
- **`UserDevice` (FCM Token / Push Token):** Vòng đời dài (gắn liền với thiết bị cho đến khi gỡ app). 1 máy vật lý chỉ có **đúng 1 FCM Token duy nhất**. Nếu nhét vào `RefreshToken`, khi gửi push khách hàng sẽ bị nổ chuông trùng lặp 5-10 lần cho 1 thông báo!

#### 2. Vấn đề "Gửi 1 tin cho 1.000.000 người" và Mô hình 2 bảng chuẩn

> ❌ **Nếu dùng 1 bảng `Notification (userId, title, body)`:** Khi gửi 1 tin khuyến mãi cho 1.000.000 người, DB phải insert 1.000.000 dòng lặp lại cùng một đoạn text -> Phình to hàng trăm MB, nghẽn DB.  
> ✅ **Chuẩn Enterprise (Tách 2 bảng):** Bảng `Notification` chỉ lưu **1 dòng nội dung gốc**, còn bảng `NotificationRecipient` lưu trạng thái đọc/nhận của từng người -> Tiết kiệm 94% dung lượng DB.

#### 3. Cấu Trúc Schema Chuẩn Cho UserDevice & Notification Hệ Thống

```prisma
enum DevicePlatform {
  IOS
  ANDROID
  WEB
}

// 1. Quản lý thiết bị nhận Push FCM (1 User có nhiều thiết bị)
model UserDevice {
  id         String         @id @default(cuid())
  userId     String
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform   DevicePlatform // IOS | ANDROID | WEB
  fcmToken   String         // Token nhận push từ Firebase FCM / APNs
  deviceId   String?        // UUID phần cứng máy
  deviceName String?        // "iPhone 15 Pro", "Chrome Windows"
  isActive   Boolean        @default(true)
  lastSeenAt DateTime       @default(now())
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  @@unique([userId, fcmToken])
  @@index([userId])
  @@index([fcmToken])
  @@map("user_devices")
}

enum NotificationType {
  DIRECT     // Gửi 1-1 (Đơn hàng, Nạp tiền, Cảnh báo bảo mật)
  TOPIC      // Gửi theo nhóm (Theo cơ sở chi nhánh, Toàn bộ Nhân viên)
  BROADCAST  // Gửi toàn sàn (Bảo trì hệ thống, Khuyến mãi Tết)
}

// 2. Nội dung thông báo gốc (Chỉ lưu 1 bản ghi duy nhất dù gửi cho hàng triệu người)
model Notification {
  id          String           @id @default(cuid())
  title       String           // Tiêu đề
  body        String           // Nội dung chi tiết
  imageUrl    String?          // Ảnh banner / Thumbnail thông báo
  type        NotificationType @default(DIRECT)
  actionUrl   String?          // Điều hướng khi bấm: "/orders/123", "https://..."
  data        Json?            // Metadata tùy biến { "orderId": "123", "code": "SALE50" }
  senderId    String?          // ID người gửi (Admin/System)
  createdAt   DateTime         @default(now())

  recipients  NotificationRecipient[]

  @@index([type, createdAt])
  @@map("notifications")
}

// 3. Trạng thái nhận & đọc của từng người nhận (Siêu nhẹ, query chuông 🔔 cực nhanh)
model NotificationRecipient {
  id             String       @id @default(cuid())
  notificationId String
  userId         String

  isRead         Boolean      @default(false) // Đã bấm xem ở chuông 🔔 chưa
  readAt         DateTime?
  isPushed       Boolean      @default(false) // Push FCM tới thiết bị thành công chưa
  pushedAt       DateTime?

  createdAt      DateTime     @default(now())

  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([notificationId, userId]) // 1 người không nhận trùng 1 tin
  @@index([userId, isRead])          // Đếm nhanh: Số thông báo chưa đọc
  @@index([userId, createdAt])       // Phân trang danh sách thông báo của user
  @@map("notification_recipients")
}
```

#### 4. Quy Trình Gửi Thông Báo (Direct & Broadcast Flow)

1. **Đăng ký thiết bị:** Mobile/Web login -> Firebase SDK lấy `fcmToken` -> Gọi API `POST /api/devices/register` lưu vào bảng `UserDevice`.
2. **Kích hoạt gửi (Trigger Event):**
   - **Gửi 1-1 (Direct):** Tạo `Notification` + 1 dòng `NotificationRecipient` -> Lấy `fcmTokens` của user từ bảng `UserDevice` -> Đẩy Job vào Queue.
   - **Gửi Hàng Loạt (Broadcast / Topic):** Tạo 1 `Notification` -> Bulk insert `NotificationRecipient` cho tệp user -> Đẩy Job chia nhỏ (chunk 500-1000 tokens) vào **BullMQ Worker**.
3. **Queue Worker thực thi:**
   - Worker gọi Firebase Admin SDK (`sendEachForMulticast`) bắn push tới hàng loạt thiết bị.
   - Cập nhật `isPushed: true`.
   - Nếu Firebase báo `registration-token-not-registered` (user đã gỡ app) -> Worker tự động dọn dẹp bản ghi chết trong bảng `UserDevice`.

---

## 🔒 5. Best Practices Về Bảo Mật & Vận Hành

1. **Không bao giờ lưu Refresh Token dạng Plaintext:** Luôn băm trước khi lưu (`tokenHash = sha256(rawToken)`).
2. **Refresh Token Rotation:** Mỗi lần cấp Access Token mới qua Refresh Token, hãy hủy Refresh Token cũ và sinh Refresh Token mới.
3. **Bảo vệ System Roles:** Không cho phép API sửa/xóa các Role có `isSystem: true` (ví dụ `SUPER_ADMIN`).
4. **Soft Delete (`deletedAt`):** Không xóa cứng `User` trong DB để đảm bảo tính toàn vẹn dữ liệu lịch sử và Audit Log.
5. **Dọn dẹp Token chết định kỳ:** Thiết lập Cronjob xóa các `RefreshToken` đã hết hạn quá 30 ngày để tối ưu dung lượng DB.
