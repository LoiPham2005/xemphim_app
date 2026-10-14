import "server-only";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { Permission } from "@/lib/permissions";
import type { SessionPayload } from "@/lib/session";
import { permissionService } from "@/services/permission.service";

/**
 * Bọc Server Action lại, biến việc kiểm quyền từ KỶ LUẬT thành RÀNG BUỘC KIỂU.
 *
 * ---
 * VẤN ĐỀ NÓ GIẢI QUYẾT
 *
 * Mỗi Server Action là một HTTP endpoint công khai. Trang chứa nó nằm sau lớp
 * bảo vệ nào không quan trọng — ai cũng POST thẳng tới action id được. Nên mọi
 * action đều PHẢI tự kiểm quyền.
 *
 * Trước file này, luật đó được giữ bằng cách nhớ viết hai dòng ở đầu mỗi hàm:
 *
 *     const denied = await denyUnlessPermitted("role:update");
 *     if (denied) return denied;
 *
 * Quên hai dòng đó thì KHÔNG có gì báo: TypeScript không biết, test khác vẫn
 * xanh, trang vẫn chạy. Lỗ hổng chỉ lộ ra khi có người thử. Làm việc theo đội
 * thì review bắt được; làm một mình thì không.
 *
 * Với `defineAction`, không khai báo quyền là **không biên dịch được** — quyền
 * là tham số bắt buộc, và `Permission` là union nên gõ sai tên cũng bị bắt.
 *
 * ---
 * NÓ KHÔNG THAY THẾ ĐIỀU GÌ
 *
 * Đây vẫn là lớp kiểm quyền của TẦNG ACTION. Ba lớp còn lại giữ nguyên:
 * proxy chặn người chưa đăng nhập vào trang, trang tự gọi `requirePermission`,
 * và route handler của REST API tự kiểm. Xem README mục "Mô hình bảo mật".
 */

/**
 * Hình dạng tối thiểu của state mà một action trả về.
 *
 * Mọi state của action trong dự án đều có `error?: string` — đó là cách giao
 * diện hiển thị lỗi. `defineAction` dựa vào đúng trường này để báo "bị từ
 * chối" mà không cần thêm một kiểu riêng lọt ra call site.
 */
export type ActionState = { error?: string };

/**
 * Ngữ cảnh truyền vào phần thân action.
 *
 * Có sẵn `session` để không phải gọi `getSession()` lần nữa — `defineAction` đã
 * đọc rồi, và `getSession` được bọc `cache()` nên gọi lại cũng không tốn thêm
 * truy vấn, nhưng truyền thẳng vào thì rõ ràng hơn.
 */
export type ActionContext = {
  session: SessionPayload;
  /** Id người đang thao tác. Viết tắt của `session.sub` vì dùng rất nhiều. */
  actorId: string;
};

/**
 * Tạo một Server Action đã tự kiểm quyền.
 *
 * @param permission Quyền bắt buộc phải có. Đây là lý do hàm này tồn tại —
 * không có cách nào tạo action mà bỏ qua tham số này.
 *
 * @example
 * export const deleteRoleAction = defineAction(
 *   "role:delete",
 *   async (ctx, key: string) => {
 *     await roleService.delete(key);
 *     revalidatePath("/roles");
 *     return {};
 *   },
 * );
 */
export function defineAction<TArgs extends unknown[], TState extends ActionState>(
  permission: Permission,
  handler: (ctx: ActionContext, ...args: TArgs) => Promise<TState>,
): (...args: TArgs) => Promise<TState> {
  return async (...args: TArgs) => {
    const session = await getSession();

    if (!session) {
      return denied<TState>("Bạn cần đăng nhập để thực hiện thao tác này.");
    }

    if (!(await permissionService.can(session.sub, permission))) {
      // Ghi log MỌI lần bị từ chối. Một tài khoản hợp lệ gõ cửa action nó không
      // có quyền là tín hiệu đáng chú ý — có thể là lỗi giao diện (hiện nút cho
      // người không đủ quyền), cũng có thể là ai đó đang dò.
      logger.warn("Server Action bị từ chối vì thiếu quyền", {
        userId: session.sub,
        roles: session.roles,
        permission,
      });
      return denied<TState>("Bạn không có quyền thực hiện thao tác này.");
    }

    return handler({ session, actorId: session.sub }, ...args);
  };
}

/**
 * Dựng giá trị "bị từ chối" mang kiểu state của chính action đó.
 *
 * Ép kiểu ở đây là CÓ CHỦ ĐÍCH, và đánh đổi được ghi rõ: `TState` chỉ được
 * ràng buộc là có `error?: string`, nên về lý thuyết nó có thể mang thêm
 * trường BẮT BUỘC mà nhánh từ chối không điền.
 *
 * Chấp nhận vì hai lẽ. Một: mọi state của form trong dự án đều toàn trường
 * tuỳ chọn — đó là bản chất của form state, nó phải biểu diễn được cả lúc
 * chưa gửi gì. Hai: giữ đúng kiểu trả về khiến nơi gọi không phải xử lý một
 * union lạ, mà chính sự phiền phức đó là lý do người ta lười bọc action.
 *
 * ⚠️ Thêm trường bắt buộc vào state của một action thì phải tự trả nó ở nhánh
 * lỗi — hoặc tốt hơn, để trường đó tuỳ chọn.
 */
function denied<TState extends ActionState>(message: string): TState {
  return { error: message } as TState;
}

/**
 * Bản dành cho action chỉ cần ĐĂNG NHẬP, không cần quyền cụ thể.
 *
 * Tách thành hàm riêng thay vì cho `permission` thành tuỳ chọn: nếu tham số đó
 * bỏ trống được thì việc quên nó lại trở thành lỗi im lặng — đúng thứ file này
 * sinh ra để chặn. Muốn không cần quyền thì phải nói ra bằng một cái tên khác.
 */
export function defineAuthedAction<TArgs extends unknown[], TState extends ActionState>(
  handler: (ctx: ActionContext, ...args: TArgs) => Promise<TState>,
): (...args: TArgs) => Promise<TState> {
  return async (...args: TArgs) => {
    const session = await getSession();

    if (!session) {
      return denied<TState>("Bạn cần đăng nhập để thực hiện thao tác này.");
    }

    return handler({ session, actorId: session.sub }, ...args);
  };
}
