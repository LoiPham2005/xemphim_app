import { z } from "zod";
import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { createUserSchema, listUsersSchema } from "@/schemas/user.schema";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApiPermission(request, "user:read");

    /*
     * Phân trang theo TRANG thay vì cursor.
     *
     * Cursor tốt cho luồng cuộn vô hạn, nhưng màn quản trị cần "trang 7" và
     * cần biết TỔNG số bản ghi — cursor không cho cả hai. `userService.list`
     * trả `items` + `meta` trong một lần gọi, nên không có chuyện đếm và lấy
     * trang nhìn thấy hai trạng thái khác nhau của bảng.
     */
    const url = new URL(request.url);
    const parsed = listUsersSchema.safeParse(Object.fromEntries(url.searchParams));

    if (!parsed.success) {
      throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);
    }

    const { items, meta } = await userService.list(parsed.data);

    return apiOk({ items, meta });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/users", request });
  }
}

export async function POST(request: Request) {
  try {
    await requireApiPermission(request, "user:create");

    // createUserSchema có nhận `roleKey`, và ở đây thì hợp lệ: người gọi đã
    // được xác thực là ADMIN. Khác với form trên web, nơi vai trò bị bỏ qua
    // hoàn toàn vì bất kỳ ai cũng gửi được field ẩn.
    //
    // Vai trò không tồn tại sẽ thành RoleNotFoundError từ userService, chứ
    // không phải lỗi khoá ngoại thô của database.
    const body = await parseJsonBody(request, createUserSchema);
    const user = await userService.create(body);

    return apiOk({ user }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/users", request });
  }
}
