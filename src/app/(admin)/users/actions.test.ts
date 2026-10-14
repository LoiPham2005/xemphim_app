import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as UserServiceModule from "@/services/user.service";
import { SelfActionForbiddenError, DuplicateFieldError } from "@/lib/errors";

/**
 * Đây là bài test quan trọng nhất trong repo.
 *
 * Server Action là HTTP endpoint công khai: proxy chặn được người chưa đăng
 * nhập ở đường vào trang, nhưng KHÔNG chặn được một người đã đăng nhập với
 * quyền USER gửi thẳng request tới action dành cho ADMIN. Những test dưới đây
 * khoá chặt hành vi đó.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * `defineAction` hỏi `permissionService.can()` chứ không so `role === "ADMIN"`
 * nữa. Mock ở đây để test không cần một Postgres đang chạy — thứ đang kiểm là
 * "action phản ứng thế nào với quyền", không phải "quyền được đọc lên ra sao"
 * (đã có `permission.service.test.ts` lo).
 */
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));

vi.mock("@/services/user.service", async (importOriginal) => {
  // Giữ nguyên các lớp lỗi thật để `instanceof` trong action vẫn đúng.
  const actual = await importOriginal<typeof UserServiceModule>();
  return {
    ...actual,
    userService: { create: vi.fn(), softDelete: vi.fn() },
  };
});

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";
import { createUserAction, deleteUserAction } from "./actions";

const adminSession: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const userSession: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mặc định: tài khoản admin có mọi quyền, tài khoản thường thì không.
  // `can` nhận userId chứ không nhận vai trò — một người mang được nhiều vai
  // trò cùng lúc, và hợp quyền của chúng nằm dưới database.
  vi.mocked(permissionService.can).mockImplementation((userId) =>
    Promise.resolve(userId === adminSession.sub),
  );
});

describe("createUserAction", () => {
  it("từ chối khi chưa đăng nhập và không chạm tới service", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await createUserAction({}, form({ email: "new@example.com" }));

    expect(result.error).toContain("đăng nhập");
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("từ chối user thường dù đã đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(userSession);

    const result = await createUserAction({}, form({ email: "new@example.com" }));

    expect(result.error).toContain("không có quyền");
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("bỏ qua field role gửi kèm — không cho tự phong ADMIN", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockResolvedValue({
      id: "u-2",
      email: "new@example.com",
      username: "u",
      fullName: null,
      emailVerifiedAt: null,
      status: "ACTIVE",
      lockedUntil: null,
      roles: ["USER"],
      phone: null,
      avatarUrl: null,
      twoFactorEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await createUserAction({}, form({ email: "new@example.com", roleKeys: "ADMIN" }));

    expect(vi.mocked(userService.create).mock.calls[0]?.[0].roleKeys).toBeUndefined();
  });

  it("trả lỗi theo field khi email sai định dạng", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);

    const result = await createUserAction({}, form({ email: "khong-phai-email" }));

    expect(result.fieldErrors?.email).toBeDefined();
    expect(userService.create).not.toHaveBeenCalled();
  });

  /**
   * Bài test này canh một lỗi đã xảy ra thật và KHÔNG lỗi nào bắt được nó:
   * form gửi `name` trong khi schema đã đổi sang `fullName`. Zod strip im lặng
   * khoá lạ nên parse vẫn thành công, typecheck vẫn xanh (`safeParse` nhận
   * `unknown`), chỉ có dữ liệu người dùng vừa nhập là biến mất.
   *
   * Vì vậy phải khẳng định trên ĐỐI SỐ THẬT truyền xuống service, chứ không
   * chỉ khẳng định action chạy xong không lỗi.
   */
  it("chuyển tiếp fullName và username xuống service", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockResolvedValue({
      id: "u-3",
      email: "new@example.com",
      username: "nguyenvana",
      fullName: "Nguyễn Văn A",
      emailVerifiedAt: null,
      status: "ACTIVE",
      lockedUntil: null,
      roles: ["USER"],
      phone: null,
      avatarUrl: null,
      twoFactorEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await createUserAction(
      {},
      form({
        email: "new@example.com",
        fullName: "Nguyễn Văn A",
        username: "nguyenvana",
      }),
    );

    expect(vi.mocked(userService.create).mock.calls[0]?.[0]).toMatchObject({
      email: "new@example.com",
      fullName: "Nguyễn Văn A",
      username: "nguyenvana",
    });
  });

  it("đưa lỗi trùng tên đăng nhập về đúng ô username", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockRejectedValue(new DuplicateFieldError("username", "trung"));

    const result = await createUserAction(
      {},
      form({ email: "new@example.com", username: "trung" }),
    );

    // Lỗi phải rơi vào ĐÚNG ô `username`, không phải một câu chung chung ở đầu
    // form: `DuplicateFieldError` mang sẵn tên trường trong `fields`.
    expect(result.fieldErrors?.username?.[0]).toContain("Tên đăng nhập");
    expect(result.fieldErrors?.email).toBeUndefined();
  });
});

describe("deleteUserAction", () => {
  it("từ chối khi chưa đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await deleteUserAction("victim-id");

    expect(result.error).toContain("đăng nhập");
    expect(userService.softDelete).not.toHaveBeenCalled();
  });

  it("từ chối user thường — đây là lỗ hổng của bản cũ", async () => {
    vi.mocked(getSession).mockResolvedValue(userSession);

    const result = await deleteUserAction("victim-id");

    expect(result.error).toContain("không có quyền");
    expect(userService.softDelete).not.toHaveBeenCalled();
  });

  it("truyền actorId xuống service để service tự áp luật tự-xoá", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.softDelete).mockRejectedValue(new SelfActionForbiddenError("xoá"));

    const result = await deleteUserAction(adminSession.sub);

    // Action không tự kiểm luật nữa — nó chỉ chuyển tiếp danh tính người thao
    // tác và hiển thị lỗi service trả về.
    expect(userService.softDelete).toHaveBeenCalledWith(adminSession.sub, {
      actorId: adminSession.sub,
    });
    expect(result.error).toContain("tự xoá");
  });

  it("cho phép admin xoá người khác", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.softDelete).mockResolvedValue();

    const result = await deleteUserAction("victim-id");

    expect(result.error).toBeUndefined();
    expect(userService.softDelete).toHaveBeenCalledWith("victim-id", {
      actorId: adminSession.sub,
    });
  });
});
