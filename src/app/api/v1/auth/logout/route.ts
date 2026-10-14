import { z } from "zod";
import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { tokenService } from "@/services/token.service";

export const dynamic = "force-dynamic";

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
  /** true = đăng xuất khỏi mọi thiết bị. */
  allDevices: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    const { refreshToken, allDevices } = await parseJsonBody(request, logoutSchema);

    if (allDevices) {
      const count = await tokenService.revokeAllForUser(session.sub);
      logger.info("API logout (all devices)", { userId: session.sub, revoked: count });
      return apiOk({ revoked: count });
    }

    if (refreshToken) await tokenService.revoke(refreshToken);

    // Access token là JWT nên không thu hồi được — nó tự hết hạn sau
    // ACCESS_TOKEN_TTL_MINUTES. Client phải tự xoá token khỏi bộ nhớ.
    return apiOk({ revoked: refreshToken ? 1 : 0 });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/logout", request });
  }
}
