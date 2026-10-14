import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isKnownPermission, type Permission } from "@/lib/permissions";
import { cacheDelByPrefix, cacheGet, cacheSet } from "@/lib/cache";

/**
 * Trả lời câu hỏi "người này được làm gì", đọc từ database, có cache.
 *
 * ---
 * QUYỀN HIỆU LỰC ĐƯỢC TÍNH THẾ NÀO
 *
 *   1. HỢP của quyền đến từ MỌI vai trò người đó đang mang.
 *   2. Cộng thêm các `UserPermission` có `isGranted = true`.
 *   3. TRỪ đi các `UserPermission` có `isGranted = false`.
 *
 * Thứ tự quan trọng: bước 3 chạy SAU CÙNG, nên "tước quyền" luôn thắng. Cần
 * chặn gấp một người khỏi một hành động thì phải chặn được ngay, không phải đi
 * gỡ họ khỏi vai trò rồi dựng lại một vai trò gần giống.
 *
 * ---
 * VÌ SAO CACHE THEO NGƯỜI DÙNG, KHÔNG PHẢI THEO VAI TRÒ
 *
 * Vì có `UserPermission`: hai người cùng vai trò vẫn có thể khác quyền. Cache
 * theo vai trò sẽ bỏ sót đúng phần ngoại lệ — mà ngoại lệ mới là thứ người ta
 * đặt ra khi có việc gấp.
 *
 * ---
 * HAI GIỚI HẠN PHẢI BIẾT
 *
 * 1. Không có Redis thì cache nằm trong RAM của MỘT tiến trình, và
 *    `invalidateUser()` chỉ xoá bản sao của tiến trình đang xử lý request đó.
 *    Đây là lý do vẫn có TTL: tiến trình khác tự làm mới sau `CACHE_TTL`.
 *    Có `REDIS_URL` thì cache dùng chung và xoá là xoá thật cho mọi instance.
 *
 * 2. Quyền LUÔN được tra lại từ đây, KHÔNG BAO GIỜ đọc từ JWT. Ký quyền vào
 *    token nghĩa là sửa phân quyền không có tác dụng cho tới khi token hết hạn
 *    — người vừa bị tước quyền vẫn thao tác được thêm 15 phút nữa.
 */

/**
 * Một phút: đủ ngắn để thay đổi phân quyền lan ra nhanh, đủ dài để chặn gần
 * như toàn bộ truy vấn lặp lại trên đường đi nóng.
 *
 * Cũng là ĐỘ TRỄ TỐI ĐA của việc hết hạn quyền tạm (`UserPermission.expiresAt`):
 * một quyền hết hạn lúc 10:00 có thể còn dùng được tới 10:01. Chấp nhận được
 * với "cấp quyền trong 24 giờ"; nếu dự án của bạn cần chính xác tới giây thì
 * hạ TTL xuống — cái giá là nhiều truy vấn hơn.
 */
const CACHE_TTL_SECONDS = 60;

/** Đổi tiền tố này khi đổi hình dạng dữ liệu cache, nếu không bản deploy mới đọc phải giá trị cũ. */
const CACHE_PREFIX = "perm:v1:";

/** Một quyền, kèm lý do nó có (hoặc không có) hiệu lực. */
export type PermissionExplanation = {
  key: Permission;
  /**
   * `role`   — đến từ vai trò, xem `roles`.
   * `grant`  — được cấp riêng cho người này, đè lên vai trò.
   * `denied` — bị TƯỚC riêng. Quyền KHÔNG có hiệu lực, dù vai trò có cho.
   */
  source: "role" | "grant" | "denied";
  /** Các vai trò cho quyền này. Rỗng khi nguồn là ngoại lệ cá nhân thuần tuý. */
  roles: string[];
  /** Ai đặt ngoại lệ. Chỉ có với `grant`/`denied`. */
  grantedBy?: string | null;
  /** Hạn của ngoại lệ. `null` = vĩnh viễn. */
  expiresAt?: Date | null;
  /** `true` khi từng có ngoại lệ nhưng nó đã hết hạn — quyền đã về theo vai trò. */
  expiredOverride?: boolean;
};

export class PermissionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Xoá cache của MỘT người. Gọi sau khi đổi vai trò hoặc quyền riêng của họ.
   */
  async invalidateUser(userId: string): Promise<void> {
    await cacheDelByPrefix(`${CACHE_PREFIX}${userId}`);
  }

  /**
   * Xoá cache của TẤT CẢ. Gọi sau khi sửa bảng phân quyền của một vai trò —
   * lúc đó không biết được ai đang mang vai trò đó mà không truy vấn thêm, và
   * thao tác này hiếm tới mức không đáng tối ưu.
   */
  async invalidateAll(): Promise<void> {
    await cacheDelByPrefix(CACHE_PREFIX);
  }

  private async load(userId: string): Promise<Permission[]> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        userRoles: {
          select: {
            role: {
              select: { permissions: { select: { permission: { select: { key: true } } } } },
            },
          },
        },
        userPermissions: {
          // Bỏ qua ngoại lệ ĐÃ HẾT HẠN ngay trong truy vấn.
          //
          // Lọc ở tầng ứng dụng cũng được, nhưng lọc ở đây thì không có đường
          // nào quên: mọi nơi hỏi "người này có quyền gì" đều đi qua đúng câu
          // truy vấn này. Một quyền tạm mà vẫn còn hiệu lực sau khi hết hạn là
          // đúng thứ mà cột `expiresAt` sinh ra để ngăn.
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { isGranted: true, permission: { select: { key: true } } },
        },
      },
    });

    if (!user) return [];

    const granted = new Set<Permission>();

    for (const { role } of user.userRoles) {
      for (const { permission } of role.permissions) {
        // Bỏ qua bản ghi còn sót của quyền đã bị xoá khỏi code. Không có bước
        // này, một dòng cũ trong database vẫn cấp được quyền mà không dòng mã
        // nào còn kiểm tra nó.
        if (isKnownPermission(permission.key)) granted.add(permission.key);
      }
    }

    // Cấp thêm trước, tước sau — thứ tự quyết định: tước luôn thắng.
    for (const item of user.userPermissions) {
      if (item.isGranted && isKnownPermission(item.permission.key)) {
        granted.add(item.permission.key);
      }
    }
    for (const item of user.userPermissions) {
      if (!item.isGranted) granted.delete(item.permission.key as Permission);
    }

    return [...granted];
  }

  /** Toàn bộ quyền hiệu lực của một người. */
  async permissionsFor(userId: string): Promise<ReadonlySet<Permission>> {
    const key = `${CACHE_PREFIX}${userId}`;

    const cachedList = await cacheGet<Permission[]>(key);
    if (cachedList) return new Set(cachedList);

    const list = await this.load(userId);
    await cacheSet(key, list, CACHE_TTL_SECONDS);

    return new Set(list);
  }

  async can(userId: string, permission: Permission): Promise<boolean> {
    return (await this.permissionsFor(userId)).has(permission);
  }

  /** Đúng khi có ÍT NHẤT MỘT trong các quyền được liệt kê. */
  async canAny(userId: string, permissions: readonly Permission[]): Promise<boolean> {
    const granted = await this.permissionsFor(userId);
    return permissions.some((permission) => granted.has(permission));
  }

  /** Đúng khi có ĐỦ TẤT CẢ các quyền được liệt kê. */
  async canAll(userId: string, permissions: readonly Permission[]): Promise<boolean> {
    const granted = await this.permissionsFor(userId);
    return permissions.every((permission) => granted.has(permission));
  }

  /**
   * Quyền hiệu lực KÈM NGUỒN GỐC — dùng cho màn hỗ trợ/kiểm toán.
   *
   * ---
   * VÌ SAO CẦN, KHI ĐÃ CÓ `permissionsFor()`
   *
   * `permissionsFor()` trả về "người này được làm gì" — đủ để QUYẾT ĐỊNH, nhưng
   * không đủ để GIẢI THÍCH. Khi hệ thống có ngoại lệ cá nhân, câu hỏi thật của
   * bộ phận hỗ trợ là: "vì sao tài khoản A xoá được người dùng?" — từ vai trò
   * ADMIN, hay do ai đó cấp riêng, hay một quyền tạm sắp hết hạn?
   *
   * Không trả lời được câu đó thì mọi lần rà soát phân quyền đều phải mở
   * database lên đọc tay.
   *
   * ⚠️ KHÔNG cache và KHÔNG dùng trên đường đi nóng: nó đọc nhiều hơn hẳn
   * `permissionsFor()`. Đây là truy vấn cho một màn hình quản trị, không phải
   * cho mỗi request.
   */
  async explainFor(userId: string): Promise<PermissionExplanation[]> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        userRoles: {
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
        userPermissions: {
          select: {
            isGranted: true,
            grantedBy: true,
            expiresAt: true,
            permission: { select: { key: true } },
          },
        },
      },
    });

    if (!user) return [];

    const byKey = new Map<Permission, PermissionExplanation>();

    // 1. Từ vai trò. Một quyền có thể đến từ NHIỀU vai trò — giữ hết, vì
    //    "gỡ vai trò nào thì mất quyền này" là câu hỏi tiếp theo của người tra.
    for (const { role } of user.userRoles) {
      for (const { permission } of role.permissions) {
        if (!isKnownPermission(permission.key)) continue;

        const existing = byKey.get(permission.key);
        if (existing?.source === "role") {
          existing.roles.push(role.key);
        } else {
          byKey.set(permission.key, { key: permission.key, source: "role", roles: [role.key] });
        }
      }
    }

    // 2. Ngoại lệ cá nhân, ghi đè phần trên — đúng thứ tự mà `load()` áp dụng.
    const now = new Date();

    for (const item of user.userPermissions) {
      if (!isKnownPermission(item.permission.key)) continue;

      const expired = item.expiresAt !== null && item.expiresAt <= now;
      const previous = byKey.get(item.permission.key);

      // Ngoại lệ ĐÃ HẾT HẠN không còn tác dụng: quyền quay về đúng những gì vai
      // trò cho. Hiện nó ra vẫn có ích — người tra thấy được "đã từng cấp".
      if (expired) {
        if (previous) previous.expiredOverride = true;
        continue;
      }

      byKey.set(item.permission.key, {
        key: item.permission.key,
        source: item.isGranted ? "grant" : "denied",
        roles: previous?.source === "role" ? previous.roles : [],
        grantedBy: item.grantedBy,
        expiresAt: item.expiresAt,
      });
    }

    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Kiểm tra quyền trên một tài nguyên cụ thể, có xét quyền `:own`.
   *
   * Ví dụ: ADMIN đọc được hồ sơ của bất kỳ ai, còn USER chỉ đọc được hồ sơ của
   * chính mình. Gói luật đó vào một chỗ để nó không bị chép lại — và chép sai —
   * ở từng controller.
   *
   * @example
   * await permissions.canActOnResource(actorId, ownerId, {
   *   any: "user:update",
   *   own: "profile:update:own",
   * });
   */
  async canActOnResource(
    actorId: string,
    ownerId: string,
    permissions: { any: Permission; own: Permission },
  ): Promise<boolean> {
    const granted = await this.permissionsFor(actorId);

    if (granted.has(permissions.any)) return true;
    return ownerId === actorId && granted.has(permissions.own);
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const permissionService = new PermissionService();
