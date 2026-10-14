import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { registerDeviceSchema } from "@/schemas/notification.schema";
import { deviceService } from "@/services/device.service";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Thiết bị nhận push của tài khoản hiện tại.
 *
 * ⚠️ `fcmToken` là UNIQUE TOÀN BẢNG, không phải unique theo người dùng: cùng
 * một máy có thể được hai người đăng nhập lần lượt, và FCM cấp lại đúng token
 * đó. Nếu để trùng, người đăng nhập sau vẫn nhận push của người trước.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    const body = await parseJsonBody(request, registerDeviceSchema);

    return apiOk({ device: await deviceService.register(session.sub, body) }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/devices", request });
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    return apiOk({ devices: await deviceService.listActive(session.sub) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/devices", request });
  }
}

/** Gỡ thiết bị khỏi danh sách nhận push — gọi lúc đăng xuất trên máy đó. */
export async function DELETE(request: Request) {
  try {
    const session = await requireApiUser(request);
    const body = await parseJsonBody(request, z.object({ fcmToken: z.string().min(1) }));

    await deviceService.deactivate(session.sub, body.fcmToken);

    return apiOk({ deactivated: true });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/devices", request });
  }
}
