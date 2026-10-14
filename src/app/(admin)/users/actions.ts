"use server";
import { DomainError, DuplicateFieldError } from "@/lib/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { logger } from "@/lib/logger";
import { auditService } from "@/services/audit.service";
import { createUserSchema, userStatusSchema, type SetUserStatusInput } from "@/schemas/user.schema";
import { userService } from "@/services/user.service";

/**
 * Mỗi Server Action là một HTTP endpoint công khai.
 *
 * Việc trang gọi nó nằm sau proxy KHÔNG bảo vệ được action: ai cũng POST thẳng
 * tới action id được, không cần đi qua trang. Vì vậy mọi action ở đây tự kiểm
 * quyền, không tin vào bất cứ lớp nào phía trên.
 *
 * `defineAction` biến luật đó thành ràng buộc kiểu — quyền là tham số bắt
 * buộc. Xem `src/lib/define-action.ts`.
 *
 * ---
 * ĐỔI TỪ "role === ADMIN" SANG KIỂM THEO QUYỀN
 *
 * Bản trước dùng `denyIfNotAdmin()`, tức là gắn cứng vào vai trò ADMIN. Điều
 * đó mâu thuẫn với chính tính năng của dự án: quản trị viên tạo được vai trò
 * mới lúc chạy và tick quyền `user:create` cho nó, nhưng action vẫn chặn vì
 * vai trò đó không tên là ADMIN. Người dùng thấy nút, bấm vào, và bị từ chối —
 * không hiểu vì sao.
 *
 * Kiểm theo quyền thì bảng phân quyền trên `/roles` mới thật sự có tác dụng.
 */

export type CreateUserState = {
  error?: string;
  /**
   * Khoá phải trùng tên trường trong `createUserSchema` — đó vừa là thứ
   * `z.flattenError` trả về, vừa là `name=` của các ô trong form. Union cũ còn
   * ghi `name`/`role`, hai trường không tồn tại trong schema, nên lỗi trả về
   * không bao giờ tìm được ô để hiển thị.
   */
  fieldErrors?: Partial<Record<"email" | "username" | "fullName" | "password", string[]>>;
};

export const createUserAction = defineAction(
  "user:create",
  async (ctx, _prevState: CreateUserState, formData: FormData): Promise<CreateUserState> => {
    // `roleKey` cố ý KHÔNG đọc từ formData. Nếu đọc, bất kỳ ai gửi được form
    // cũng tự phong mình làm ADMIN — leo thang đặc quyền chỉ bằng một field ẩn.
    // Muốn gán vai trò thì đi qua REST API, nơi người gọi được xác thực bằng
    // token chứ không phải bằng nội dung form.
    //
    // Tên trường phải là `fullName`, không phải `name`: Zod strip im lặng khoá
    // lạ, nên gửi sai tên không hề báo lỗi — parse vẫn thành công, chỉ có dữ
    // liệu người dùng vừa nhập là biến mất trước khi tới database.
    const parsed = createUserSchema.safeParse({
      email: formData.get("email"),
      username: formData.get("username") || undefined,
      fullName: formData.get("fullName") || undefined,
    });

    if (!parsed.success) {
      return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
    }

    let created;
    try {
      created = await userService.create(parsed.data);
    } catch (error) {
      /*
       * `DuplicateFieldError` mang theo TÊN TRƯỜNG bị trùng trong `fields`, nên
       * thông báo hiện ngay dưới đúng ô nhập. Trước đây mỗi trường một lớp lỗi
       * riêng, và thêm một trường unique nghĩa là thêm một nhánh `if` — quên
       * nhánh đó thì admin chỉ nhận được một câu chung chung.
       */
      if (error instanceof DuplicateFieldError) {
        return { fieldErrors: error.fields, error: error.message };
      }
      logger.error("Create user failed", error, { email: parsed.data.email });
      return { error: "Không thể tạo người dùng lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: "user.created",
      entity: "user",
      entityId: created.id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      // Ghi email của tài khoản MỚI để sau này tra được, nhưng không ghi mật
      // khẩu hay bất cứ thứ gì nhạy cảm.
      metadata: { email: created.email },
    });

    revalidatePath("/users");
    return {};
  },
);

export const setUserStatusAction = defineAction(
  "user:update",
  async (ctx, id: string, status: SetUserStatusInput): Promise<{ error?: string }> => {
    const parsed = userStatusSchema.safeParse(status);
    if (!parsed.success) return { error: "Trạng thái không hợp lệ" };

    try {
      // `ctx.actorId` do defineAction cung cấp — không phải gọi lại getSession
      // rồi xử lý trường hợp null như bản trước (chỗ đó từng truyền chuỗi rỗng
      // khi không có session, khiến luật "không tự khoá mình" hụt).
      await userService.setStatus(id, parsed.data, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) {
        return { error: error instanceof Error ? error.message : "Thao tác thất bại." };
      }
      logger.error("Set user status failed", error, { targetUserId: id, status });
      return { error: "Không thể đổi trạng thái lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: parsed.data === "BANNED" ? "user.banned" : "user.unbanned",
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });

    revalidatePath("/users");
    return {};
  },
);

/** Mở khoá sớm — bỏ qua thời gian còn lại của `lockedUntil` (khoá tự động do brute-force). */
export const unlockUserAction = defineAction(
  "user:update",
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      await userService.unlock(id, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) {
        return { error: error instanceof Error ? error.message : "Thao tác thất bại." };
      }
      logger.error("Unlock user failed", error, { targetUserId: id });
      return { error: "Không thể mở khoá lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: "user.unlocked",
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });

    revalidatePath("/users");
    return {};
  },
);

export const deleteUserAction = defineAction(
  "user:delete",
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      // Luật "không tự xoá chính mình" nằm trong service, không nằm ở đây —
      // nếu chép lại tại từng cửa vào thì sớm muộn hai bên cũng lệch nhau.
      await userService.softDelete(id, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) {
        return { error: error instanceof Error ? error.message : "Thao tác thất bại." };
      }
      logger.error("Delete user failed", error, { targetUserId: id });
      return { error: "Không thể xoá người dùng lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: "user.deleted",
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });

    revalidatePath("/users");
    return {};
  },
);
