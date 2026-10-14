import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `defineAction` là chốt chặn của MỌI Server Action trong dự án. Hỏng nó là
 * hỏng cùng lúc toàn bộ lớp kiểm quyền ở tầng action — nên nó cần test riêng,
 * không dựa vào test của từng action.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { defineAction, defineAuthedAction } from "./define-action";

const session = { sub: "u-1", email: "a@b.com", typ: "access" as const, roles: ["KE_TOAN"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defineAction", () => {
  it("chạy phần thân khi có quyền, và truyền actorId vào ngữ cảnh", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    const body = vi.fn().mockResolvedValue({ ok: true });
    const action = defineAction("user:create", body);

    const result = await action("tham-so");

    expect(result).toEqual({ ok: true });
    expect(body).toHaveBeenCalledWith({ session, actorId: "u-1" }, "tham-so");
  });

  it("chặn khi chưa đăng nhập và KHÔNG chạm vào phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const body = vi.fn();
    const result = await defineAction("user:create", body)();

    expect(result.error).toContain("đăng nhập");
    // Điểm mấu chốt: phần thân không được chạy. Nếu nó chạy rồi mới bị chặn ở
    // đầu ra thì tác dụng phụ (ghi database, gửi mail) đã xảy ra mất rồi.
    expect(body).not.toHaveBeenCalled();
  });

  it("chặn khi thiếu quyền và KHÔNG chạm vào phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(false);

    const body = vi.fn();
    const result = await defineAction("user:delete", body)();

    expect(result.error).toContain("không có quyền");
    expect(body).not.toHaveBeenCalled();
  });

  it("hỏi ĐÚNG quyền đã khai báo, theo vai trò trong session", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    await defineAction("role:update", vi.fn().mockResolvedValue({}))();

    // Kiểm theo QUYỀN, không phải theo tên vai trò — nhờ vậy vai trò tự tạo
    // (KE_TOAN trong session ở đây) vẫn dùng được action nếu được tick quyền
    // tương ứng. `can` nhận userId chứ không nhận vai trò: một người có thể
    // mang nhiều vai trò cùng lúc, hợp quyền của chúng nằm dưới database.
    expect(permissionService.can).toHaveBeenCalledWith(session.sub, "role:update");
  });

  it("không nuốt lỗi từ phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    const action = defineAction("user:create", () => Promise.reject(new Error("lỗi nghiệp vụ")));

    // Lỗi phải bung ra để error boundary/logger xử lý, không được biến thành
    // một object trông như thành công.
    await expect(action()).rejects.toThrow("lỗi nghiệp vụ");
  });
});

describe("defineAuthedAction", () => {
  it("cho qua khi đã đăng nhập, không hỏi quyền nào", async () => {
    vi.mocked(getSession).mockResolvedValue(session);

    const result = await defineAuthedAction(() => Promise.resolve({ error: undefined }))();

    expect(result.error).toBeUndefined();
    expect(permissionService.can).not.toHaveBeenCalled();
  });

  it("vẫn chặn khi chưa đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const body = vi.fn();
    const result = await defineAuthedAction(body)();

    expect(result.error).toContain("đăng nhập");
    expect(body).not.toHaveBeenCalled();
  });
});
