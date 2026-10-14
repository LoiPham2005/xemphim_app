import { z } from "zod";
import { emptyToUndefined, paginationSchema } from "@/schemas/common.schema";

/**
 * Luật về người dùng, khai báo MỘT LẦN cho cả ba phía: form trên web,
 * DTO của NestJS, và tham số của service trong core.
 *
 * Chép luật sang từng tầng là cách chắc chắn nhất để chúng lệch nhau — và chiều
 * lệch nguy hiểm nhất diễn ra trong im lặng: web siết 12 ký tự, API vẫn nhận 6,
 * client mobile gọi thẳng API là lách được.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email không hợp lệ")
  .max(254, "Email quá dài");

/**
 * Tên đăng nhập. Cấm ký tự `@` có chủ đích: đó là thứ DUY NHẤT giúp
 * `AuthService` phân biệt "người dùng đang nhập email" với "đang nhập username"
 * trong cùng một ô nhập.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Tên đăng nhập tối thiểu 3 ký tự")
  .max(32, "Tên đăng nhập tối đa 32 ký tự")
  .regex(/^[a-z0-9._-]+$/, "Tên đăng nhập chỉ gồm chữ thường, số và . _ -");

/** Số điện thoại Việt Nam, dạng 0xxxxxxxxx hoặc +84xxxxxxxxx. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(0|\+84)[1-9][0-9]{8}$/, "Số điện thoại không hợp lệ");

/**
 * Mật khẩu.
 *
 * Chỉ ép ĐỘ DÀI, không ép "phải có hoa/số/ký tự đặc biệt". Đây là khuyến nghị
 * hiện hành của NIST SP 800-63B: luật ghép ký tự đẩy người dùng tới những mật
 * khẩu dễ đoán theo khuôn (`Password1!`) trong khi một câu dài ngẫu nhiên lại
 * bị từ chối.
 */
export const passwordSchema = z
  .string()
  .min(8, "Mật khẩu tối thiểu 8 ký tự")
  .max(128, "Mật khẩu tối đa 128 ký tự");

export const fullNameSchema = z.string().trim().min(1, "Họ tên không được để trống").max(100);

export const userStatusSchema = z.enum(["ACTIVE", "INACTIVE", "BANNED"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const genderSchema = z.enum(["MALE", "FEMALE", "OTHER"]);

/** Hình dạng user trả ra ngoài. KHÔNG BAO GIỜ có `password`. */
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  username: z.string().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: userStatusSchema,
  emailVerifiedAt: z.coerce.date().nullable(),
  /**
   * Khoá TẠM do sai mật khẩu liên tiếp; `null` = không bị khoá.
   *
   * Có mặt ở đây vì màn quản trị phải phân biệt được "bị đình chỉ"
   * (`status = BANNED`, quyết định hành chính) với "đang khoá tạm" (tự hết
   * hạn) — hai thứ cần hai nút bấm khác nhau.
   */
  lockedUntil: z.coerce.date().nullable(),
  /** `true` khi tài khoản đã bật xác thực hai lớp. */
  twoFactorEnabled: z.boolean().default(false),
  /** Khoá của mọi vai trò đang mang, ví dụ `["ADMIN", "STAFF"]`. */
  roles: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

// ---------------------------------------------------------------------------
// Quản trị người dùng
// ---------------------------------------------------------------------------

export const createUserSchema = z
  .object({
    email: emailSchema.optional(),
    phone: emptyToUndefined(phoneSchema.optional()),
    username: emptyToUndefined(usernameSchema.optional()),
    /** Bỏ trống = tài khoản chưa có mật khẩu, người dùng tự đặt qua email. */
    password: emptyToUndefined(passwordSchema.optional()),
    fullName: emptyToUndefined(fullNameSchema.optional()),
    status: userStatusSchema.default("ACTIVE"),
    /** Bỏ trống = gán vai trò USER. */
    roleKeys: z.array(z.string()).optional(),
  })
  // Không có định danh nào thì bản ghi tạo ra không đăng nhập được bằng bất kỳ
  // đường nào — chặn ngay thay vì để nó nằm chết trong database.
  .refine((value) => Boolean(value.email ?? value.phone ?? value.username), {
    message: "Phải có ít nhất một trong: email, số điện thoại, tên đăng nhập",
    path: ["email"],
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  phone: emptyToUndefined(phoneSchema.optional()),
  username: emptyToUndefined(usernameSchema.optional()),
  fullName: emptyToUndefined(fullNameSchema.optional()),
  status: userStatusSchema.optional(),
  roleKeys: z.array(z.string()).optional(),
  /**
   * Ảnh đại diện: `id` lấy từ `POST /api/v1/files`. `null` = gỡ ảnh. Tệp phải là ảnh, do chính chủ hồ
   * sơ hoặc người đang sửa tải lên, và chưa gắn ở nơi khác.
   */
  avatarFileId: z.string().min(1).nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateProfileSchema = z.object({
  fullName: emptyToUndefined(fullNameSchema.optional()),
  avatarUrl: emptyToUndefined(z.string().url("Đường dẫn ảnh không hợp lệ").optional()),
  gender: genderSchema.optional(),
  dob: emptyToUndefined(z.coerce.date().optional()),
  bio: emptyToUndefined(z.string().max(1000).optional()),
  address: emptyToUndefined(z.string().max(255).optional()),
  city: emptyToUndefined(z.string().max(100).optional()),
  district: emptyToUndefined(z.string().max(100).optional()),
  country: emptyToUndefined(z.string().max(2).optional()),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const listUsersSchema = paginationSchema.extend({
  /** Tìm theo email / username / số điện thoại / họ tên. */
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  status: userStatusSchema.optional(),
  roleKey: emptyToUndefined(z.string().optional()),
  /** Mặc định ẩn tài khoản đã xoá mềm. */
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListUsersInput = z.infer<typeof listUsersSchema>;

export const setUserStatusSchema = z.object({ status: userStatusSchema });
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const assignRolesSchema = z.object({
  roleKeys: z.array(z.string()).min(1, "Phải chọn ít nhất một vai trò"),
});
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;

export const setUserPermissionSchema = z.object({
  permissionKey: z.string().min(1),
  /** `true` = cấp thêm, `false` = tước bỏ (thắng mọi vai trò). */
  isGranted: z.boolean(),
  /**
   * Hạn của ngoại lệ này. Bỏ trống = vĩnh viễn.
   *
   * Dùng cho "cấp quyền trong 24 giờ để xử lý sự cố" — nhu cầu rất thường gặp,
   * và không có hạn thì nó âm thầm thành vĩnh viễn vì không ai nhớ quay lại gỡ.
   */
  expiresAt: z.coerce.date().optional(),
});
export type SetUserPermissionInput = z.infer<typeof setUserPermissionSchema>;
