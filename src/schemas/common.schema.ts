import { z } from "zod";

/**
 * Mảnh ghép dùng lại ở mọi schema. Gom về một chỗ để luật không bị chép lệch —
 * ví dụ `page` mặc định 1 ở chỗ này nhưng 0 ở chỗ kia là một lớp lỗi rất khó
 * nhìn ra khi đọc từng file riêng lẻ.
 */

export const cuidSchema = z.string().cuid("Định danh không hợp lệ");

/**
 * Phân trang theo trang/số dòng.
 *
 * `coerce` vì query string luôn là chuỗi: `?page=2` cho ra `"2"`, và `z.number()`
 * thuần sẽ từ chối nó.
 *
 * `limit` chặn trần 100 — không phải để làm khó client, mà vì `?limit=1000000`
 * là cách rẻ nhất để bắt server dựng một mảng khổng lồ.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(["asc", "desc"]).default("desc");

/** Hình dạng response phân trang, giống nhau ở MỌI endpoint danh sách. */
export type Paginated<T> = {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
};

export function buildPaginationMeta(
  total: number,
  { page, limit }: PaginationInput,
): Paginated<never>["meta"] {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNext: page < totalPages };
}

/** `skip`/`take` cho Prisma từ tham số phân trang. */
export function toPrismaPage({ page, limit }: PaginationInput) {
  return { skip: (page - 1) * limit, take: limit };
}

/**
 * Chuỗi rỗng → `undefined`.
 *
 * Form HTML gửi `""` cho ô để trống, còn `.optional()` của Zod chỉ nhảy vào
 * khi giá trị là `undefined`. Không có lớp này thì "để trống ô không bắt buộc"
 * lại thành lỗi validate.
 */
export const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);
