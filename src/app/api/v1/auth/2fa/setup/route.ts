import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { twoFactorService } from "@/services/two-factor.service";

export const dynamic = "force-dynamic";

/** Bước 1 — sinh bí mật và URI cho mã QR. CHƯA bật gì cả. */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    return apiOk(await twoFactorService.beginSetup(session.sub));
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/2fa/setup", request });
  }
}
