"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { renameFileSchema } from "@/schemas/file.schema";
import { auditService } from "@/services/audit.service";
import { fileService } from "@/services/file.service";

type ActionResult = { error?: string };

/**
 * Hai action của trang thư viện tệp. Tải lên KHÔNG đi Server Action: giới hạn thân request của Server
 * Action mặc định 1MB, và video phải PUT thẳng lên kho — `file-uploader.tsx` gọi REST `/api/v1/files*`
 * bằng cookie phiên, dùng chung luật với app mobile.
 */
export const renameFileAction = defineAction(
  "file:manage",
  async (ctx, id: string, originalName: string): Promise<ActionResult> => {
    const parsed = renameFileSchema.safeParse({ originalName });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Tên không hợp lệ" };

    try {
      await fileService.rename(id, parsed.data, { userId: ctx.actorId, canManage: true });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Đổi tên tệp thất bại", error, { fileId: id });
      return { error: "Không đổi tên được lúc này. Vui lòng thử lại." };
    }

    revalidatePath("/files");
    return {};
  },
);

export const deleteFileAction = defineAction(
  "file:manage",
  async (ctx, id: string): Promise<ActionResult> => {
    try {
      // Luật "đang được dùng thì không xoá" nằm trong service — chép lại ở đây là có ngày lệch nhau.
      await fileService.remove(id, { userId: ctx.actorId, canManage: true });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Xoá tệp thất bại", error, { fileId: id });
      return { error: "Không xoá được tệp lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: "file.deleted",
      entity: "file",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });

    revalidatePath("/files");
    return {};
  },
);
