import { enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { requestPhoneOtpSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Gửi mã OTP xác thực số điện thoại.
 *
 * ⚠️ MẶC ĐỊNH TẮT (`PHONE_VERIFICATION_ENABLED=0`). Khác email, mỗi tin nhắn
 * SMS đều TỐN TIỀN THẬT, nên một endpoint gửi SMS không giới hạn là một hoá
 * đơn không giới hạn. Bật nó lên là một quyết định có chi phí, không phải mặc
 * định — service ném lỗi rõ ràng nếu chưa bật.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:phone-otp", RATE_LIMITS.phoneOtp);

    const body = await parseJsonBody(request, requestPhoneOtpSchema);
    await authService.requestPhoneVerification(session.sub, body.phone);

    // Không trả mã về response, kể cả ở môi trường dev: response đi qua log của
    // proxy, của trình duyệt, và của bất kỳ ai đang xem màn hình.
    return apiOk({ sent: true });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/phone/request-otp", request });
  }
}
