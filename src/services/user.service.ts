import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ROLES, isKnownPermission } from "@/lib/permissions";
import { buildPaginationMeta, toPrismaPage, type Paginated } from "@/schemas/common.schema";
import {
  type CreateUserInput,
  type ListUsersInput,
  type PublicUser,
  type UpdateProfileInput,
  type UpdateUserInput,
} from "@/schemas/user.schema";
import { CryptoUtils } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";
import { fileService } from "@/services/file.service";
import { type PermissionService, permissionService } from "@/services/permission.service";
import {
  DuplicateFieldError,
  InsufficientRoleLevelError,
  SelfActionForbiddenError,
  UnknownPermissionError,
  UnknownRoleKeyError,
  UserNotFoundError,
} from "@/lib/errors";

/**
 * Phần hồ sơ đi kèm mọi bản ghi user trả ra API. Dùng chung ở auth/oauth để `toPublicUser` luôn nhận
 * đủ dữ liệu dựng `avatarUrl`.
 */
export const PROFILE_SUMMARY_SELECT = {
  fullName: true,
  avatarUrl: true,
  avatarFile: { select: { key: true } },
} satisfies Prisma.UserProfileSelect;

/**
 * `select` dùng chung cho MỌI truy vấn trả user ra ngoài.
 *
 * Danh sách tường minh, KHÔNG dùng `select: undefined` (lấy hết cột): cột
 * `password` phải không bao giờ rời khỏi tầng này, và cách chắc chắn nhất là
 * không bao giờ đọc nó lên trừ khi đang xác thực.
 */
const USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  username: true,
  status: true,
  emailVerifiedAt: true,
  lockedUntil: true,
  twoFactorEnabledAt: true,
  createdAt: true,
  updatedAt: true,
  profile: { select: PROFILE_SUMMARY_SELECT },
  userRoles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * Ảnh tải lên (`avatarFile`) thắng URL ngoài (`avatarUrl`). URL dựng từ `key` lúc trả về — database
 * không giữ URL nên đổi CDN/bucket không phải sửa dữ liệu.
 */
function avatarUrlOf(
  profile: { avatarUrl: string | null; avatarFile: { key: string } | null } | null,
): string | null {
  if (profile?.avatarFile) return getStorage().url(profile.avatarFile.key);
  return profile?.avatarUrl ?? null;
}

/**
 * Làm phẳng bản ghi Prisma thành hình dạng công khai.
 *
 * `roles` thành mảng chuỗi thay vì mảng object lồng: client chỉ quan tâm khoá
 * vai trò, và `user.roles.includes("ADMIN")` đọc dễ hơn hẳn
 * `user.userRoles.some(r => r.role.key === "ADMIN")`.
 */
export function toPublicUser(row: UserRow): PublicUser {
  const { profile, userRoles, twoFactorEnabledAt, ...rest } = row;
  return {
    ...rest,
    fullName: profile?.fullName ?? null,
    avatarUrl: avatarUrlOf(profile),
    roles: userRoles.map((item) => item.role.key),
    // Trả cờ boolean chứ không trả mốc thời gian: client chỉ cần biết có bật
    // hay không, còn "bật từ khi nào" là thông tin của riêng chủ tài khoản
    // (xem `GET /auth/2fa`), không nên lộ ra ở mọi danh sách người dùng.
    twoFactorEnabled: twoFactorEnabledAt !== null,
  };
}

export class UserService {
  /**
   * ⚠️ MỌI đường ghi đụng tới thẩm quyền — gán vai trò, cấp/tước quyền lẻ, xoá
   * tài khoản — đều PHẢI gọi `permissions.invalidateUser()`.
   *
   * Quên một chỗ thì thay đổi chỉ có hiệu lực sau khi cache hết hạn (60 giây).
   * Chiều "cấp thêm" chỉ gây khó hiểu: admin tick một quyền, thử ngay, thấy
   * vẫn 403, rồi kết luận hệ thống hỏng. Chiều "tước bỏ" thì là lỗ hổng thật:
   * người vừa bị gỡ vai trò vẫn thao tác được như cũ thêm một phút nữa.
   */
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly permissions: PermissionService = permissionService,
  ) {}

  // -------------------------------------------------------------------------
  // Bậc quyền lực — chốt chặn leo thang đặc quyền
  // -------------------------------------------------------------------------

  /**
   * Bậc cao nhất trong số các vai trò của một người. Không có vai trò nào → -1.
   *
   * Dùng -1 chứ không phải 0 vì 0 là bậc HỢP LỆ của vai trò USER: nếu tài khoản
   * không vai trò cũng được coi là bậc 0 thì nó ngang hàng USER, và luật "phải
   * cao hơn hẳn" sẽ chặn cả những thao tác đáng lẽ hợp lệ.
   */
  private async maxRoleLevel(userId: string): Promise<number> {
    const rows = await this.db.userRole.findMany({
      where: { userId },
      select: { role: { select: { level: true } } },
    });

    return rows.reduce((max, row) => Math.max(max, row.role.level), -1);
  }

  /**
   * Chặn thao tác lên người NGANG HÀNG hoặc MẠNH HƠN mình.
   *
   * ---
   * VÌ SAO CHỐT NÀY LÀ BẮT BUỘC
   *
   * Không có nó thì phân quyền theo quyền hạn (`user:update`, `user:create`)
   * trở thành phẳng: ai sửa được người dùng thì sửa được TẤT CẢ người dùng, kể
   * cả quản trị tối cao. Và tệ hơn — họ tạo được một tài khoản mang vai trò
   * SUPER_ADMIN rồi đăng nhập vào đó. Chốt "không tự đổi vai trò của chính
   * mình" không cứu được, vì họ tạo tài khoản KHÁC.
   *
   * `actorId` là `null` khi thao tác đến từ hệ thống (seed, script, job nền) —
   * lúc đó không có ai để so bậc, và bỏ qua là đúng.
   */
  private async assertCanActOn(actorId: string | null | undefined, targetUserId: string) {
    if (!actorId) return;

    const [actorLevel, targetLevel] = await Promise.all([
      this.maxRoleLevel(actorId),
      this.maxRoleLevel(targetUserId),
    ]);

    if (targetLevel >= actorLevel) {
      throw new InsufficientRoleLevelError(
        "Bạn không thể thao tác lên tài khoản có thẩm quyền ngang hoặc cao hơn mình",
      );
    }
  }

  /**
   * Chặn gán vai trò MẠNH HƠN HOẶC BẰNG bậc của chính mình.
   *
   * "Bằng" cũng bị chặn: cho phép một ADMIN tạo thêm ADMIN nghe hợp lý, nhưng
   * nó có nghĩa là bậc ADMIN tự nhân bản vô hạn và không ai gỡ được — vì theo
   * `assertCanActOn`, ADMIN không đụng được vào ADMIN khác. Muốn thêm người
   * cùng bậc thì phải do bậc CAO HƠN thực hiện.
   */
  private async assertCanAssignRoles(actorId: string | null | undefined, roleKeys: string[]) {
    if (!actorId || roleKeys.length === 0) return;

    const [actorLevel, roles] = await Promise.all([
      this.maxRoleLevel(actorId),
      this.db.role.findMany({
        where: { key: { in: roleKeys } },
        select: { key: true, level: true },
      }),
    ]);

    const tooHigh = roles.filter((role) => role.level >= actorLevel);

    if (tooHigh.length > 0) {
      throw new InsufficientRoleLevelError(
        `Bạn không đủ thẩm quyền để gán vai trò: ${tooHigh.map((role) => role.key).join(", ")}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Đọc
  // -------------------------------------------------------------------------

  async findById(
    id: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<PublicUser | null> {
    const row = await this.db.user.findFirst({
      where: { id, ...(options.includeDeleted ? {} : { deletedAt: null }) },
      select: USER_SELECT,
    });

    return row ? toPublicUser(row) : null;
  }

  /**
   * Tra theo email.
   *
   * Chuẩn hoá chữ thường TRƯỚC khi tra: email được lưu ở dạng chữ thường, nên
   * tra bằng chuỗi thô làm `Loi@X.com` không khớp dòng nào — và lỗi đó im lặng
   * ở những luồng luôn trả 200 theo thiết kế (quên mật khẩu).
   */
  async findByEmail(email: string): Promise<PublicUser | null> {
    const row = await this.db.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
      select: USER_SELECT,
    });

    return row ? toPublicUser(row) : null;
  }

  async list(input: ListUsersInput): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      ...(input.includeDeleted ? {} : { deletedAt: null }),
      ...(input.status ? { status: input.status } : {}),
      ...(input.roleKey ? { userRoles: { some: { role: { key: input.roleKey } } } } : {}),
      ...(input.q
        ? {
            OR: [
              { email: { contains: input.q, mode: "insensitive" } },
              { username: { contains: input.q, mode: "insensitive" } },
              { phone: { contains: input.q } },
              { profile: { fullName: { contains: input.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    // Đếm và lấy trang song song: hai truy vấn độc lập, chạy tuần tự là tự cộng
    // thêm một lượt đi-về database vào mỗi lần mở danh sách.
    const [total, rows] = await Promise.all([
      this.db.user.count({ where }),
      this.db.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: "desc" },
        ...toPrismaPage(input),
      }),
    ]);

    return { items: rows.map(toPublicUser), meta: buildPaginationMeta(total, input) };
  }

  // -------------------------------------------------------------------------
  // Ghi
  // -------------------------------------------------------------------------

  /**
   * Đổi danh sách khoá vai trò thành id.
   *
   * Ném lỗi khi có khoá không tồn tại thay vì lặng lẽ bỏ qua: bỏ qua nghĩa là
   * người quản trị bấm "gán vai trò KE_TOAN", hệ thống báo thành công, mà
   * người dùng không nhận được vai trò nào.
   */
  private async resolveRoleIds(roleKeys: readonly string[]): Promise<string[]> {
    const roles = await this.db.role.findMany({
      where: { key: { in: [...roleKeys] } },
      select: { id: true, key: true },
    });

    const found = new Set(roles.map((role) => role.key));
    const missing = roleKeys.filter((key) => !found.has(key));
    if (missing.length > 0) throw new UnknownRoleKeyError(missing);

    return roles.map((role) => role.id);
  }

  /**
   * Chặn trước những va chạm mà database sẽ từ chối.
   *
   * Có thể để unique constraint tự bắn lỗi, nhưng lỗi P2002 của Prisma chỉ cho
   * biết "một cột nào đó trùng" — kiểm ở đây thì báo được ĐÚNG trường nào,
   * hiển thị ngay dưới ô nhập tương ứng.
   *
   * ⚠️ Vẫn có khe hở đua (hai request cùng lúc). Đó là lý do
   * `catchDuplicate` bên dưới vẫn phải bắt P2002 — kiểm trước là để có thông
   * báo tử tế, không phải để thay thế ràng buộc của database.
   */
  private async assertUnique(
    fields: { email?: string; username?: string; phone?: string },
    excludeUserId?: string,
  ): Promise<void> {
    const checks: Array<[keyof typeof fields, string]> = [];
    if (fields.email) checks.push(["email", fields.email]);
    if (fields.username) checks.push(["username", fields.username]);
    if (fields.phone) checks.push(["phone", fields.phone]);
    if (checks.length === 0) return;

    const existing = await this.db.user.findFirst({
      where: {
        OR: checks.map(([field, value]) => ({ [field]: value })),
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
      select: { email: true, username: true, phone: true },
    });

    if (!existing) return;

    for (const [field, value] of checks) {
      if (existing[field] === value) throw new DuplicateFieldError(field, value);
    }
  }

  /** Đổi P2002 của Prisma thành lỗi nghiệp vụ chỉ đúng trường bị trùng. */
  private static catchDuplicate(error: unknown): never {
    const code = (error as { code?: string }).code;
    const target = (error as { meta?: { target?: string[] } }).meta?.target ?? [];

    if (code === "P2002") {
      for (const field of ["email", "username", "phone"] as const) {
        if (target.includes(field)) throw new DuplicateFieldError(field);
      }
    }

    throw error;
  }

  async create(input: CreateUserInput & { actorId?: string | null }): Promise<PublicUser> {
    await this.assertUnique(input);

    const roleKeys = input.roleKeys?.length ? input.roleKeys : [SYSTEM_ROLES.USER];

    // TRƯỚC khi tạo. Đây là đường leo thang đặc quyền rõ nhất: tạo một tài
    // khoản SUPER_ADMIN rồi tự đăng nhập vào đó.
    await this.assertCanAssignRoles(input.actorId, roleKeys);

    const roleIds = await this.resolveRoleIds(roleKeys);

    const password = input.password ? await CryptoUtils.hashPassword(input.password) : null;

    try {
      const row = await this.db.user.create({
        data: {
          email: input.email ?? null,
          phone: input.phone ?? null,
          username: input.username ?? null,
          password,
          status: input.status,
          // Tạo hồ sơ ngay cùng lúc thay vì để null: mọi màn hình đọc
          // `user.profile` sẽ không phải xử lý nhánh "chưa có hồ sơ", và một
          // nhánh không tồn tại là một nhánh không thể sai.
          profile: { create: { fullName: input.fullName ?? null } },
          userRoles: {
            create: roleIds.map((roleId) => ({ roleId, assignedBy: input.actorId ?? null })),
          },
        },
        select: USER_SELECT,
      });

      await this.permissions.invalidateUser(row.id);

      return toPublicUser(row);
    } catch (error) {
      UserService.catchDuplicate(error);
    }
  }

  async update(
    id: string,
    input: UpdateUserInput,
    options: { actorId?: string | null } = {},
  ): Promise<PublicUser> {
    const existing = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new UserNotFoundError(id);

    // Tự đổi vai trò của CHÍNH MÌNH là cách nhanh nhất để quản trị viên cuối
    // cùng tự khoá mình ra ngoài — và không còn ai vào sửa được nữa.
    if (input.roleKeys && options.actorId && options.actorId === id) {
      throw new SelfActionForbiddenError("đổi vai trò của");
    }

    const isSelf = Boolean(options.actorId) && options.actorId === id;

    if (isSelf) {
      /*
       * Tự sửa CHÍNH MÌNH: không so bậc vai trò — trước đây `assertCanActOn` so người sửa với chính họ
       * ("ngang bậc" -> chặn), nên `profile:update:own` không dùng được, kể cả đổi tên.
       *
       * Đổi lại, chỉ cho đổi trường HỒ SƠ. Email/SĐT có luồng xác minh riêng (`/auth/change-email`,
       * `/auth/phone/*`) — cho đổi thẳng ở đây là đổi email không cần xác minh. Tự đổi trạng thái thì
       * giống tự khoá (`setStatus` cũng chặn).
       */
      const blocked = (["email", "phone", "username", "status"] as const).filter(
        (field) => input[field] !== undefined,
      );
      if (blocked.length > 0) throw new SelfActionForbiddenError(`đổi ${blocked.join(", ")} của`);
    } else {
      await this.assertCanActOn(options.actorId, id);
    }
    if (input.roleKeys) await this.assertCanAssignRoles(options.actorId, input.roleKeys);

    await this.assertUnique(input, id);

    const roleIds = input.roleKeys ? await this.resolveRoleIds(input.roleKeys) : null;

    try {
      const row = await this.db.$transaction(async (tx) => {
        if (roleIds) {
          // Thay thế toàn bộ chứ không cộng dồn: màn phân vai trò là một bảng
          // tick, gửi nguyên trạng thái cuối cùng thì không có chỗ cho lệch pha
          // giữa "vừa bỏ tick" và "chưa bao giờ có".
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({
              userId: id,
              roleId,
              assignedBy: options.actorId ?? null,
            })),
          });
        }

        const hasProfileChange = input.fullName !== undefined;

        if (input.avatarFileId !== undefined) {
          await this.setAvatar(tx, id, input.avatarFileId, options.actorId ?? null);
        }

        return tx.user.update({
          where: { id },
          data: {
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.username !== undefined ? { username: input.username } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(hasProfileChange
              ? {
                  profile: {
                    upsert: {
                      create: { fullName: input.fullName ?? null },
                      update: { fullName: input.fullName ?? null },
                    },
                  },
                }
              : {}),
          },
          select: USER_SELECT,
        });
      });

      await this.permissions.invalidateUser(row.id);

      return toPublicUser(row);
    } catch (error) {
      UserService.catchDuplicate(error);
    }
  }

  /**
   * Đổi ảnh đại diện sang tệp đã tải lên (`null` = gỡ ảnh). Chạy trong transaction của `update()`:
   * gắn tệp mới và gỡ tệp cũ phải cùng thành công hoặc cùng huỷ.
   *
   * Tệp phải do chính chủ hồ sơ HOẶC người đang thao tác tải lên (admin đổi ảnh hộ), phải là ảnh, và
   * chưa gắn ở đâu — xem `fileService.claim`.
   */
  private async setAvatar(
    tx: Prisma.TransactionClient,
    userId: string,
    fileId: string | null,
    actorId: string | null,
  ): Promise<void> {
    const current = await tx.userProfile.findUnique({
      where: { userId },
      select: { avatarFileId: true },
    });
    if (current?.avatarFileId === fileId) return;

    if (fileId) {
      await fileService.claim(tx, fileId, {
        field: "avatarFileId",
        ownerIds: actorId ? [userId, actorId] : [userId],
        mimePrefix: "image/",
      });
    }
    if (current?.avatarFileId) await fileService.release(tx, current.avatarFileId);

    await tx.userProfile.upsert({
      where: { userId },
      create: { userId, avatarFileId: fileId },
      update: { avatarFileId: fileId },
    });
  }

  /** Cập nhật hồ sơ của CHÍNH người đang đăng nhập. */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    const existing = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new UserNotFoundError(userId);

    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.dob !== undefined ? { dob: input.dob } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
    };

    await this.db.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    const row = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_SELECT,
    });
    return toPublicUser(row);
  }

  /** Hồ sơ đầy đủ (mọi field của `UserProfile`), cho màn "trang cá nhân". */
  async getProfile(userId: string) {
    const row = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { ...USER_SELECT, profile: { include: { avatarFile: { select: { key: true } } } } },
    });
    if (!row) throw new UserNotFoundError(userId);

    const { profile, userRoles, twoFactorEnabledAt, ...rest } = row;
    return {
      ...rest,
      roles: userRoles.map((item) => item.role.key),
      // Cùng hình dạng với `toPublicUser`: trả cờ boolean, KHÔNG trả mốc thời
      // gian. "Bật từ khi nào" là thông tin của riêng chủ tài khoản và chỉ có
      // ở `GET /auth/2fa`.
      twoFactorEnabled: twoFactorEnabledAt !== null,
      profile: profile ? { ...profile, avatarFile: undefined } : null,
      fullName: profile?.fullName ?? null,
      avatarUrl: avatarUrlOf(profile),
    };
  }

  async setStatus(
    id: string,
    status: PublicUser["status"],
    options: { actorId?: string | null } = {},
  ): Promise<PublicUser> {
    if (options.actorId && options.actorId === id) {
      throw new SelfActionForbiddenError("đổi trạng thái");
    }

    await this.assertCanActOn(options.actorId, id);

    const existing = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new UserNotFoundError(id);

    const row = await this.db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          status,
          // Bỏ khoá tạm khi được mở lại: `lockedUntil` là hệ quả của brute-force
          // mật khẩu, không liên quan tới quyết định hành chính vừa rồi. Giữ
          // lại thì admin "mở khoá" xong người dùng vẫn không vào được.
          ...(status === "ACTIVE" ? { lockedUntil: null, failedLoginAttempts: 0 } : {}),
        },
        select: USER_SELECT,
      });

      // Khoá tài khoản mà để phiên cũ còn sống thì việc khoá gần như vô nghĩa —
      // họ vẫn dùng tiếp tới khi refresh token hết hạn (mặc định 30 ngày).
      if (status !== "ACTIVE") {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return updated;
    });

    return toPublicUser(row);
  }

  /**
   * Mở khoá tạm do sai mật khẩu liên tiếp, KHÔNG đụng tới `status`.
   *
   * Khác `setStatus("ACTIVE")` ở chỗ đó: `lockedUntil` là hệ quả của
   * brute-force, còn `status` là quyết định hành chính. Gộp hai việc lại thì
   * "mở khoá cho người gõ nhầm mật khẩu" vô tình gỡ luôn lệnh đình chỉ mà quản
   * trị viên khác vừa đặt.
   */
  async unlock(id: string, options: { actorId?: string | null } = {}): Promise<PublicUser> {
    await this.assertCanActOn(options.actorId, id);

    const existing = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new UserNotFoundError(id);

    const row = await this.db.user.update({
      where: { id },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
      select: USER_SELECT,
    });

    return toPublicUser(row);
  }

  /**
   * Xoá MỀM.
   *
   * Không xoá cứng vì dữ liệu nghiệp vụ (đơn hàng, giao dịch, nhật ký) tham
   * chiếu tới người dùng — xoá cứng là mất luôn ngữ cảnh của chúng, hoặc tệ
   * hơn: cascade xoá theo cả những thứ phải giữ lại.
   *
   * Email/username/phone được gắn hậu tố để giải phóng ràng buộc unique —
   * không có bước này thì địa chỉ email đó vĩnh viễn không ai đăng ký lại được,
   * kể cả chính chủ.
   */
  async softDelete(id: string, options: { actorId?: string | null } = {}): Promise<void> {
    if (options.actorId && options.actorId === id) {
      throw new SelfActionForbiddenError("xoá");
    }

    await this.assertCanActOn(options.actorId, id);

    const user = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, username: true, phone: true },
    });
    if (!user) throw new UserNotFoundError(id);

    const suffix = `deleted:${Date.now()}`;

    await this.db.$transaction([
      this.db.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: "INACTIVE",
          email: user.email ? `${user.email}:${suffix}` : null,
          username: user.username ? `${user.username}:${suffix}` : null,
          phone: user.phone ? `${user.phone}:${suffix}` : null,
        },
      }),
      this.db.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.permissions.invalidateUser(id);
  }

  // -------------------------------------------------------------------------
  // Quyền riêng của từng người (đè lên quyền đến từ vai trò)
  // -------------------------------------------------------------------------

  async setUserPermission(
    userId: string,
    permissionKey: string,
    isGranted: boolean,
    options: { actorId?: string | null; expiresAt?: Date | null } = {},
  ): Promise<void> {
    if (!isKnownPermission(permissionKey)) throw new UnknownPermissionError([permissionKey]);

    // Cấp/tước quyền lẻ là một dạng đổi thẩm quyền — phải chịu cùng chốt chặn
    // với việc đổi vai trò, nếu không thì nó trở thành đường vòng.
    await this.assertCanActOn(options.actorId, userId);

    const permission = await this.db.permission.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    // Quyền có trong code nhưng chưa có trong database = quên chạy `db:seed`.
    if (!permission) throw new UnknownPermissionError([permissionKey]);

    await this.db.userPermission.upsert({
      where: { userId_permissionId: { userId, permissionId: permission.id } },
      create: {
        userId,
        permissionId: permission.id,
        isGranted,
        grantedBy: options.actorId ?? null,
        expiresAt: options.expiresAt ?? null,
      },
      update: {
        isGranted,
        grantedBy: options.actorId ?? null,
        expiresAt: options.expiresAt ?? null,
      },
    });

    await this.permissions.invalidateUser(userId);
  }

  /** Gỡ ngoại lệ, trả người dùng về đúng quyền của vai trò họ đang mang. */
  async clearUserPermission(userId: string, permissionKey: string): Promise<void> {
    const permission = await this.db.permission.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) return;

    await this.db.userPermission.deleteMany({
      where: { userId, permissionId: permission.id },
    });

    await this.permissions.invalidateUser(userId);
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const userService = new UserService();
