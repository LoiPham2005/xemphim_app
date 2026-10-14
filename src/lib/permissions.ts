/**
 * DANH MỤC quyền hạn và bộ gán MẶC ĐỊNH.
 *
 * ---
 * PHÂN CÔNG GIỮA CODE VÀ DATABASE
 *
 * Code giữ danh mục quyền TỒN TẠI. Database giữ việc GÁN quyền cho vai trò.
 *
 * Vì sao chia như vậy: một quyền chỉ có ý nghĩa khi có dòng mã nào đó kiểm tra
 * nó. Cho phép tạo quyền mới từ giao diện quản trị sẽ sinh ra những bản ghi
 * không ràng buộc điều gì — người quản trị tick vào rồi tưởng đã cấm được, mà
 * thực tế không có gì thay đổi.
 *
 * Ngược lại, "vai trò KẾ TOÁN được xem báo cáo nhưng không xoá đơn" là quyết
 * định nghiệp vụ, đổi theo từng khách hàng, và không nên cần một lần deploy.
 *
 * Kết quả: tên quyền vẫn được TypeScript bắt lỗi lúc biên dịch, còn ai được
 * làm gì thì sửa được lúc chạy.
 *
 * ---
 * FILE NÀY KHÔNG DÙNG ĐỂ KIỂM TRA QUYỀN LÚC CHẠY
 *
 * Dùng `PermissionService.can()` trong `@repo/core` — nó đọc từ database (có
 * cache). Bảng `DEFAULT_ROLE_PERMISSIONS` dưới đây chỉ là dữ liệu nền cho
 * `pnpm db:seed`.
 *
 * ---
 * THÊM QUYỀN MỚI CHO DỰ ÁN CỦA BẠN
 *
 *   1. Thêm khoá vào `PERMISSIONS`.
 *   2. Thêm mô tả vào `PERMISSION_METADATA` (TypeScript sẽ bắt lỗi nếu quên).
 *   3. Thêm vào vai trò tương ứng trong `DEFAULT_ROLE_PERMISSIONS`.
 *   4. `pnpm db:seed` — không cần viết migration.
 */

export const PERMISSIONS = [
  // Quản lý người dùng
  "user:read",
  "user:create",
  "user:update",
  "user:delete",

  // Hồ sơ cá nhân
  "profile:read:own",
  "profile:update:own",

  // Vai trò & phân quyền
  "role:read",
  "role:create",
  "role:update",
  "role:delete",

  // Nhật ký & hệ thống
  "audit:read",
  "system:manage",

  // Thông báo
  "notification:read",
  "notification:send",

  // Tệp tin
  "file:upload",
  "file:manage",

  // Phim
  "movie:watch",
  "movie:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/** Một chuỗi bất kỳ có phải quyền đang tồn tại trong code không. */
export function isKnownPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Vai trò hệ thống — được `db:seed` tạo sẵn và không cho xoá.
 *
 * Dự án cụ thể tạo thêm vai trò riêng từ giao diện quản trị; danh sách này chỉ
 * là bộ khung tối thiểu để hệ thống chạy được ngay sau khi cài.
 */
export const SYSTEM_ROLES = {
  /** Toàn quyền. Luôn có MỌI quyền, kể cả quyền mới thêm sau này. */
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
  /** Vai trò mặc định của tài khoản tự đăng ký. */
  USER: "USER",
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Khoá vai trò. Chuỗi tự do vì quản trị viên tạo thêm vai trò được lúc chạy. */
export type RoleKey = string;

export type RoleSeed = {
  key: SystemRoleKey;
  name: string;
  description: string;
  /**
   * Bậc quyền lực. Cao hơn = mạnh hơn.
   *
   * Chừa khoảng trống giữa các bậc (0 → 10 → 20 → 50 → 100) để sau này chèn
   * vai trò mới vào giữa mà không phải đánh số lại toàn bộ — đánh số lại là
   * thao tác mà một lần sai sẽ trao quyền cho nhầm người.
   */
  level: number;
  /** `"*"` = mọi quyền, kể cả quyền được thêm vào code sau này. */
  permissions: readonly Permission[] | "*";
};

export const DEFAULT_ROLE_PERMISSIONS: readonly RoleSeed[] = [
  {
    key: SYSTEM_ROLES.SUPER_ADMIN,
    level: 100,
    name: "Quản trị tối cao",
    description: "Toàn quyền mọi chức năng. Luôn được cấp cả quyền thêm mới sau này.",
    // Liệt kê tay thì mỗi lần thêm quyền mới lại phải nhớ bổ sung vào đây — và
    // quên một lần là SUPER_ADMIN mất quyền đó mà không ai để ý.
    permissions: "*",
  },
  {
    key: SYSTEM_ROLES.ADMIN,
    level: 50,
    name: "Quản trị viên",
    description: "Quản lý người dùng, phân quyền, thông báo và xem nhật ký",
    permissions: [
      "user:read",
      "user:create",
      "user:update",
      "profile:read:own",
      "profile:update:own",
      "role:read",
      "role:create",
      "role:update",
      "audit:read",
      "notification:read",
      "notification:send",
      "file:upload",
      "file:manage",
      "movie:watch",
    ],
  },
  {
    key: SYSTEM_ROLES.MANAGER,
    level: 20,
    name: "Quản lý",
    description: "Xem người dùng, gửi thông báo nội bộ, xem nhật ký",
    permissions: [
      "user:read",
      "profile:read:own",
      "profile:update:own",
      "role:read",
      "audit:read",
      "notification:read",
      "notification:send",
      "file:upload",
      "movie:watch",
    ],
  },
  {
    key: SYSTEM_ROLES.STAFF,
    level: 10,
    name: "Nhân viên",
    description: "Xem thông tin người dùng để hỗ trợ, nhận thông báo",
    permissions: [
      "user:read",
      "profile:read:own",
      "profile:update:own",
      "notification:read",
      "file:upload",
      "movie:watch",
    ],
  },
  {
    key: SYSTEM_ROLES.USER,
    level: 0,
    name: "Người dùng",
    description: "Chỉ thao tác trên dữ liệu của chính mình",
    // `file:upload`: tự tải ảnh đại diện. Thiếu nó thì người dùng thường không đặt được avatar.
    permissions: [
      "profile:read:own",
      "profile:update:own",
      "notification:read",
      "file:upload",
      "movie:watch",
    ],
  },
];

export type PermissionMeta = {
  name: string;
  /** Nhóm hiển thị trên màn phân quyền. */
  category: string;
  description: string;
};

export const PERMISSION_METADATA: Record<Permission, PermissionMeta> = {
  "user:read": {
    name: "Xem người dùng",
    category: "Quản lý Người dùng",
    description: "Xem danh sách và chi tiết người dùng",
  },
  "user:create": {
    name: "Tạo người dùng",
    category: "Quản lý Người dùng",
    description: "Tạo tài khoản mới thay cho người dùng",
  },
  "user:update": {
    name: "Sửa người dùng",
    category: "Quản lý Người dùng",
    description: "Sửa thông tin, trạng thái và vai trò của người dùng",
  },
  "user:delete": {
    name: "Xoá người dùng",
    category: "Quản lý Người dùng",
    description: "Xoá mềm tài khoản người dùng",
  },
  "profile:read:own": {
    name: "Xem hồ sơ cá nhân",
    category: "Hồ sơ Cá nhân",
    description: "Xem hồ sơ của chính mình",
  },
  "profile:update:own": {
    name: "Sửa hồ sơ cá nhân",
    category: "Hồ sơ Cá nhân",
    description: "Sửa hồ sơ của chính mình",
  },
  "role:read": {
    name: "Xem vai trò & quyền",
    category: "Phân quyền (RBAC)",
    description: "Xem danh sách vai trò và bảng phân quyền",
  },
  "role:create": {
    name: "Tạo vai trò",
    category: "Phân quyền (RBAC)",
    description: "Tạo vai trò mới",
  },
  "role:update": {
    name: "Sửa vai trò",
    category: "Phân quyền (RBAC)",
    description: "Đổi tên vai trò và gán/gỡ quyền",
  },
  "role:delete": {
    name: "Xoá vai trò",
    category: "Phân quyền (RBAC)",
    description: "Xoá vai trò không phải vai trò hệ thống",
  },
  "audit:read": {
    name: "Xem nhật ký kiểm toán",
    category: "Hệ thống & Bảo mật",
    description: "Xem nhật ký các hành động nhạy cảm",
  },
  "system:manage": {
    name: "Quản trị hệ thống",
    category: "Hệ thống & Bảo mật",
    description: "Xem trạng thái hạ tầng, hàng đợi và cấu hình vận hành",
  },
  "notification:read": {
    name: "Xem thông báo",
    category: "Thông báo",
    description: "Xem hộp thông báo của mình",
  },
  "notification:send": {
    name: "Gửi thông báo",
    category: "Thông báo",
    description: "Tạo và gửi thông báo tới người dùng",
  },
  "file:upload": {
    name: "Tải tệp lên",
    category: "Tệp tin",
    description: "Tải tệp lên và quản lý (xem, đổi tên, xoá) tệp CỦA CHÍNH MÌNH",
  },
  "file:manage": {
    name: "Quản lý mọi tệp",
    category: "Tệp tin",
    description: "Xem, đổi tên, xoá tệp của MỌI người dùng",
  },
  "movie:watch": {
    name: "Xem phim",
    category: "Phim",
    description: "Xem danh sách phim đã xuất bản và phát phim",
  },
  "movie:manage": {
    name: "Quản lý phim",
    category: "Phim",
    description: "Đăng tải, xuất bản/ẩn và xoá phim. Mặc định chỉ SUPER_ADMIN",
  },
};

/** Danh sách quyền, gom theo `category` — dùng dựng màn phân quyền. */
export function permissionsByCategory(): Array<{
  category: string;
  permissions: Array<{ key: Permission } & PermissionMeta>;
}> {
  const groups = new Map<string, Array<{ key: Permission } & PermissionMeta>>();

  for (const key of PERMISSIONS) {
    const meta = PERMISSION_METADATA[key];
    const list = groups.get(meta.category) ?? [];
    list.push({ key, ...meta });
    groups.set(meta.category, list);
  }

  return [...groups.entries()].map(([category, permissions]) => ({ category, permissions }));
}

/** Quyền của một vai trò seed, đã giải `"*"` thành danh sách đầy đủ. */
export function resolveSeedPermissions(seed: RoleSeed): readonly Permission[] {
  return seed.permissions === "*" ? PERMISSIONS : seed.permissions;
}
