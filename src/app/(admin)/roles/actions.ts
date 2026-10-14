"use server";
import {
  RoleInUseError,
  RoleKeyAlreadyExistsError,
  RoleNotFoundError,
  SystemRoleImmutableError,
  UnknownPermissionError,
} from "@/lib/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { logger } from "@/lib/logger";
import { auditService } from "@/services/audit.service";
import { createRoleSchema, updateRoleSchema } from "@/schemas/role.schema";
import { roleService } from "@/services/role.service";

/**
 * Mỗi Server Action là một HTTP endpoint công khai — trang gọi nó nằm sau lớp
 * nào không quan trọng, ai cũng POST thẳng tới action id được.
 *
 * Mọi action ở đây bọc bằng `defineAction`, nên quyền là THAM SỐ BẮT BUỘC:
 * không khai báo là không biên dịch được, gõ sai tên quyền cũng bị TypeScript
 * bắt. Trước đây luật này được giữ bằng cách nhớ viết hai dòng kiểm tra ở đầu
 * mỗi hàm — quên thì không có gì báo. Xem `src/lib/define-action.ts`.
 *
 * Kiểm theo QUYỀN chứ không so `role === "ADMIN"`: đây chính là màn hình để
 * tạo ra những vai trò không phải ADMIN mà vẫn được giao việc, nên nó không
 * được phép tự giả định rằng chỉ ADMIN mới dùng tới.
 */

export type RoleFormState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<"key" | "name" | "description" | "permissions", string[]>>;
};

/**
 * Lưu lại bộ quyền của một vai trò.
 *
 * FormData gửi lên chỉ chứa những ô ĐƯỢC TICK — trình duyệt bỏ qua checkbox
 * không tick. Đó đúng là thứ ta cần vì `roleService.update` mang ngữ nghĩa
 * "thay thế toàn bộ": ô bỏ tick vắng mặt trong form nên cũng bị gỡ khỏi vai
 * trò. Nếu service mang ngữ nghĩa "chỉ thêm" thì màn hình này không bao giờ gỡ
 * được quyền nào.
 */
export const updateRolePermissionsAction = defineAction(
  "role:update",
  async (ctx, _prevState: RoleFormState, formData: FormData): Promise<RoleFormState> => {
    const key = formData.get("key");
    if (typeof key !== "string" || !key) return { error: "Thiếu khoá vai trò." };

    const parsed = updateRoleSchema.safeParse({
      permissions: formData.getAll("permissions"),
    });

    if (!parsed.success) {
      return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
    }

    try {
      await roleService.update(key, parsed.data, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof RoleNotFoundError || error instanceof UnknownPermissionError) {
        return { error: error.message };
      }
      logger.error("Cập nhật phân quyền thất bại", error, { roleKey: key });
      return { error: "Không thể lưu phân quyền lúc này. Vui lòng thử lại." };
    }

    logger.info("Phân quyền được cập nhật", { roleKey: key });

    // Đây là thao tác NGUY HIỂM NHẤT của cả hệ thống: ai sửa được bảng phân
    // quyền thì tự cấp cho mình mọi quyền còn lại. Ghi lại cả danh sách quyền
    // mới để sau này còn dựng lại được ai đã cấp gì cho ai, lúc nào.
    await auditService.record({
      action: "role.permissions_updated",
      entity: "role",
      entityId: key,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { permissions: parsed.data.permissions ?? [] },
    });

    revalidatePath("/roles");

    return { success: `Đã lưu phân quyền cho vai trò "${key}".` };
  },
);

export const createRoleAction = defineAction(
  "role:create",
  async (ctx, _prevState: RoleFormState, formData: FormData): Promise<RoleFormState> => {
    const parsed = createRoleSchema.safeParse({
      key: formData.get("key"),
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      // Vai trò mới cố ý bắt đầu với BỘ QUYỀN RỖNG, không kế thừa gì cả. Vai
      // trò vừa tạo mà đã có sẵn quyền là cách nhanh nhất để cấp nhầm.
      permissions: [],
    });

    if (!parsed.success) {
      return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
    }

    try {
      await roleService.create(parsed.data, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof RoleKeyAlreadyExistsError) {
        return { fieldErrors: { key: [error.message] } };
      }
      logger.error("Tạo vai trò thất bại", error, { roleKey: parsed.data.key });
      return { error: "Không thể tạo vai trò lúc này. Vui lòng thử lại." };
    }

    logger.info("Vai trò được tạo", { roleKey: parsed.data.key });

    await auditService.record({
      action: "role.created",
      entity: "role",
      entityId: parsed.data.key,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { name: parsed.data.name },
    });

    revalidatePath("/roles");

    return { success: `Đã tạo vai trò "${parsed.data.key}". Hãy tick quyền cho nó bên dưới.` };
  },
);

export const deleteRoleAction = defineAction(
  "role:delete",
  async (ctx, key: string): Promise<{ error?: string }> => {
    try {
      // Luật "không xoá vai trò hệ thống" và "không xoá vai trò còn người
      // dùng" nằm trong service — chép lại ở đây thì sớm muộn hai bên cũng
      // lệch nhau.
      await roleService.remove(key, { actorId: ctx.actorId });
    } catch (error) {
      if (
        error instanceof RoleNotFoundError ||
        error instanceof SystemRoleImmutableError ||
        error instanceof RoleInUseError
      ) {
        return { error: error.message };
      }
      logger.error("Xoá vai trò thất bại", error, { roleKey: key });
      return { error: "Không thể xoá vai trò lúc này. Vui lòng thử lại." };
    }

    logger.info("Vai trò bị xoá", { roleKey: key });

    await auditService.record({
      action: "role.deleted",
      entity: "role",
      entityId: key,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });

    revalidatePath("/roles");

    return {};
  },
);
