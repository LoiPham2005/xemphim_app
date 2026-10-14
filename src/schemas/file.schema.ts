import { z } from "zod";
import { emptyToUndefined, paginationSchema } from "./common.schema";

/**
 * Bốn nhóm tệp. Nằm ở đây (không ở `lib/storage`) để giao diện phía trình duyệt dùng lại được —
 * `lib/storage` có `server-only`.
 */
export const FILE_KINDS = ["image", "document", "audio", "video"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const fileKindSchema = z.enum(FILE_KINDS);

/**
 * Query string luôn là chuỗi, và `z.coerce.boolean()` biến `"false"` thành `true` (chuỗi khác rỗng).
 * Chỉ nhận đúng hai giá trị `true`/`false`.
 */
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const listFilesSchema = paginationSchema.extend({
  kind: fileKindSchema.optional(),
  /** Tìm theo tên tệp. */
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  /** `true` = đang được dùng, `false` = mồ côi (sắp bị dọn). Bỏ trống = cả hai. */
  attached: booleanQuery.optional(),
  /** Chỉ người có `file:manage`: lọc theo người tải lên. Người thường luôn chỉ thấy tệp của mình. */
  uploadedById: emptyToUndefined(z.string().optional()),
});
export type ListFilesInput = z.infer<typeof listFilesSchema>;

export const renameFileSchema = z.object({
  originalName: z.string().trim().min(1, "Tên tệp không được trống").max(255),
});
export type RenameFileInput = z.infer<typeof renameFileSchema>;

/**
 * Xin URL tải TRỰC TIẾP lên kho — cho video và tệp lớn. Không có `kind`: nhóm suy ra từ
 * `contentType`, gửi thêm chỉ tạo khả năng hai trường lệch nhau.
 */
export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().min(1).max(127),
  /** Byte. Kiểm lại bằng dung lượng THẬT trên kho khi client báo xong. */
  size: z.number().int().positive(),
  folder: emptyToUndefined(z.string().max(100).optional()),
  /** Giữ trong thư viện, không dọn sau 24h. Chỉ người có `file:manage` — người thường gửi lên bị 403. */
  retain: z.boolean().optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;
