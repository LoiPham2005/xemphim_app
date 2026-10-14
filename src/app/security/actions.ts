"use server";

import { revalidatePath } from "next/cache";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { twoFactorService } from "@/services/two-factor.service";
import { webauthnService } from "@/services/webauthn.service";

/**
 * Thao tác tự phục vụ trên chính tài khoản đang đăng nhập.
 *
 * Dùng `defineAuthedAction` chứ không `defineAction`: không cần quyền quản trị
 * nào. Nhưng vẫn phải bọc — Server Action là endpoint công khai, ai cũng POST
 * thẳng tới action id được mà không đi qua trang này.
 */

/** Bước 1 — sinh bí mật và URI cho QR. CHƯA bật gì cả. */
export const beginTwoFactorSetupAction = defineAuthedAction(
  async (ctx): Promise<{ error?: string; secret?: string; uri?: string }> => {
    try {
      return await twoFactorService.beginSetup(ctx.actorId);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không bắt đầu được thiết lập 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể thiết lập 2FA lúc này." };
    }
  },
);

/**
 * Bước 3 — xác nhận mã và bật thật.
 *
 * Bước này không phải thủ tục thừa: nó chứng minh app xác thực ĐÃ lưu đúng bí
 * mật. Bật ngay từ bước 1 thì người quét QR hỏng sẽ bị khoá vĩnh viễn khỏi tài
 * khoản của chính mình.
 */
export const enableTwoFactorAction = defineAuthedAction(
  async (ctx, code: string): Promise<{ error?: string; recoveryCodes?: string[] }> => {
    try {
      const recoveryCodes = await twoFactorService.confirmSetup(ctx.actorId, code);

      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_ENABLED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");

      // ⚠️ Lần DUY NHẤT mã khôi phục tồn tại ở dạng đọc được.
      return { recoveryCodes };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không bật được 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể bật 2FA lúc này." };
    }
  },
);

export const disableTwoFactorAction = defineAuthedAction(
  async (ctx, password: string, code: string): Promise<{ error?: string }> => {
    try {
      await twoFactorService.disable(ctx.actorId, password || null, code);

      // Tắt 2FA là hành động HẠ mức bảo vệ — phải nằm trong nhật ký để sau này
      // còn trả lời được "ai tắt, lúc nào".
      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_DISABLED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return {};
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không tắt được 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể tắt 2FA lúc này." };
    }
  },
);

export const regenerateRecoveryCodesAction = defineAuthedAction(
  async (ctx, code: string): Promise<{ error?: string; recoveryCodes?: string[] }> => {
    try {
      const recoveryCodes = await twoFactorService.regenerateRecoveryCodes(ctx.actorId, code);

      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_RECOVERY_REGENERATED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return { recoveryCodes };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không cấp lại được mã khôi phục", error, { userId: ctx.actorId });
      return { error: "Không thể cấp lại mã khôi phục lúc này." };
    }
  },
);

export const removePasskeyAction = defineAuthedAction(
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      // Service từ chối nếu đây là cách đăng nhập CUỐI CÙNG — xoá được thì
      // người dùng tự khoá mình ra ngoài vĩnh viễn.
      await webauthnService.remove(id, ctx.actorId);

      await auditService.record({
        action: AUDIT_ACTIONS.PASSKEY_REMOVED,
        entity: "webauthn_credential",
        entityId: id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return {};
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không xoá được passkey", error, { userId: ctx.actorId });
      return { error: "Không thể xoá passkey lúc này." };
    }
  },
);
