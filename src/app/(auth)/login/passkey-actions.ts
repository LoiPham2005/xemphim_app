"use server";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { headers } from "next/headers";
import { createSession } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { issueWebAuthnTicket, verifyTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { webauthnService } from "@/services/webauthn.service";

/**
 * Đăng nhập bằng passkey trên WEB.
 *
 * Hai bước như mọi luồng WebAuthn, và bước đầu cấp một "vé" chứa `challenge` —
 * xem `src/lib/tickets.ts` để biết vì sao không lưu challenge vào database.
 *
 * Đây là Server Action chứ không phải REST route vì kết quả là một COOKIE
 * phiên; REST route ở `/api/v1/auth/passkeys/login/*` phục vụ mobile và trả
 * Bearer token. Cùng service, hai bề mặt.
 */
export async function getPasskeyLoginOptions(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeToken: string;
}> {
  const options = await webauthnService.createAuthenticationOptions();

  return {
    /*
     * Trả về ĐÚNG kiểu của chuẩn WebAuthn, không hạ xuống `Record<string,
     * unknown>`: nó vốn đã là JSON thuần nên đi qua ranh giới Server Action
     * được, và giữ kiểu thì client không phải ép kiểu — mà mỗi lần ép kiểu là
     * một lần TypeScript ngừng kiểm tra hộ.
     */
    options,
    // Vé không có `sub`: ở luồng này ta CHƯA biết người dùng là ai, và đó là
    // điểm mạnh — danh tính đến từ chính passkey được chọn.
    challengeToken: await issueWebAuthnTicket("webauthn_auth", options.challenge),
  };
}

export async function verifyPasskeyLogin(
  challengeToken: string,
  response: unknown,
  next?: string,
): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? "unknown";

  const limit = await rateLimit(`passkey:${ip}`, RATE_LIMITS.passkey);
  if (!limit.success) {
    return { ok: false, error: `Bạn đã thử quá nhiều lần. Đợi ${limit.retryAfterSeconds} giây.` };
  }

  const ticket = await verifyTicket(challengeToken, "webauthn_auth");
  if (!ticket) {
    return { ok: false, error: "Phiên đăng nhập passkey đã hết hạn. Vui lòng thử lại." };
  }

  try {
    const user = await webauthnService.verifyAuthentication(response, ticket.challenge);

    await createSession({
      typ: "access" as const,
      sub: user.id,
      email: user.email,
      roles: user.roles,
      /*
       * Đánh dấu phiên đã qua xác thực nhiều yếu tố, và KHÔNG hỏi thêm mã 2FA
       * kể cả khi tài khoản có bật TOTP.
       *
       * Một passkey với `userVerification: "required"` đã là hai yếu tố: thiết
       * bị + sinh trắc/PIN. Hỏi thêm chỉ khiến người dùng quay về dùng mật
       * khẩu — tức là làm hệ thống YẾU đi.
       */
      mfa: new Date().toISOString(),
    });

    await auditService.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: "passkey" },
      ip,
      userAgent: headerList.get("user-agent"),
    });

    return { ok: true, next: safeRedirectPath(next, "/") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    logger.error("Đăng nhập passkey thất bại", error);
    return { ok: false, error: "Không đăng nhập được bằng passkey này." };
  }
}
