import { requireApiPermission, requireApiUser } from "@/lib/api/auth";
import { permissionService } from "@/services/permission.service";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { updateUserSchema } from "@/schemas/user.schema";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    // Người dùng thường chỉ xem được chính mình; ADMIN xem được tất cả.
    // Đọc được hồ sơ người khác cần quyền `user:read`; hồ sơ của chính mình
    // thì chỉ cần `profile:read:own`. Luật gói trong canActOnResource để không
    // bị chép lại — và chép sai — ở từng route.
    const allowed = await permissionService.canActOnResource(session.sub, id, {
      any: "user:read",
      own: "profile:read:own",
    });

    if (!allowed) {
      throw apiErrors.forbidden();
    }

    const user = await userService.findById(id);
    if (!user) throw apiErrors.notFound("Không tìm thấy người dùng");

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/users/[id]", request });
  }
}

/**
 * Sửa hồ sơ người dùng.
 *
 * ---
 * HAI MỨC QUYỀN TRONG CÙNG MỘT ENDPOINT
 *
 * Sửa hồ sơ của CHÍNH MÌNH chỉ cần `profile:update:own`; sửa của người khác
 * cần `user:update`. Gộp vào một endpoint thay vì tách `/me` riêng để client
 * chỉ phải viết một hàm.
 *
 * ⚠️ NHƯNG `roleKey` thì KHÔNG đi theo luật đó. Nó luôn đòi `user:update`, kể
 * cả khi người gọi đang sửa chính mình. Nếu không, bất kỳ ai có
 * `profile:update:own` — tức là mọi người dùng — đều tự phong mình làm ADMIN
 * bằng một field trong body. Đây là đường leo thang đặc quyền kinh điển của
 * các endpoint "sửa hồ sơ".
 *
 * Luật "không tự đổi vai trò của chính mình" nằm ở service, không nằm đây.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    const body = await parseJsonBody(request, updateUserSchema);

    const allowed = await permissionService.canActOnResource(session.sub, id, {
      any: "user:update",
      own: "profile:update:own",
    });

    if (!allowed) throw apiErrors.forbidden();

    // Kiểm tra riêng và kiểm tra SAU, chỉ khi body thật sự đụng tới vai trò.
    // Đặt trước sẽ chặn cả những request chỉ đổi tên hiển thị.
    if (body.roleKeys !== undefined && !(await permissionService.can(session.sub, "user:update"))) {
      throw apiErrors.forbidden("Bạn không có quyền đổi vai trò");
    }

    const user = await userService.update(id, body, { actorId: session.sub });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/users/[id]", request });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:delete");

    // Luật "không tự xoá chính mình" do service giữ; handleApiError đổi
    // SelfDeletionError thành 409. Refresh token có onDelete: Cascade nên mọi
    // phiên của user này biến mất cùng lúc — xoá tài khoản mà token còn sống
    // được thì vô nghĩa.
    await userService.softDelete(id, { actorId: session.sub });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/users/[id]", request });
  }
}
