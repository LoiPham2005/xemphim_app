import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Màn "thiết bị đang đăng nhập" đụng vào dữ liệu riêng tư: người dùng nào đăng
 * nhập từ máy nào, lúc nào. Hai ranh giới phải khoá chặt:
 *
 *   1. Chỉ xem được phiên của CHÍNH MÌNH.
 *   2. Chỉ đăng xuất được thiết bị của CHÍNH MÌNH.
 *
 * Vế thứ hai nguy hiểm hơn: `id` đến từ URL, tức là người gọi tự đặt.
 */

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

vi.mock("@/services/token.service", () => ({
  tokenService: { listActive: vi.fn(), revokeById: vi.fn() },
}));

import { signSession, type SessionPayload } from "@/lib/session";
import { tokenService } from "@/services/token.service";
import { GET } from "./route";
import { DELETE } from "./[id]/route";

const owner: SessionPayload = { typ: "access", sub: "u-1", email: "a@b.com", roles: ["USER"] };

type ErrorBody = { error: { code: string } };
type SessionsBody = { data: { sessions: { id: string; userAgent: string | null }[] } };

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
});

function requestWith(token?: string) {
  return new Request("http://localhost/api/v1/auth/sessions", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/v1/auth/sessions", () => {
  it("401 khi chưa đăng nhập", async () => {
    const response = await GET(requestWith());

    expect(response.status).toBe(401);
    expect(tokenService.listActive).not.toHaveBeenCalled();
  });

  it("chỉ hỏi phiên của CHÍNH người đang đăng nhập", async () => {
    vi.mocked(tokenService.listActive).mockResolvedValue([]);
    const token = await signSession(owner);

    await GET(requestWith(token));

    // `sub` lấy từ token đã ký, không phải từ tham số người gọi truyền vào —
    // nên không có cách nào hỏi danh sách của người khác.
    expect(tokenService.listActive).toHaveBeenCalledWith("u-1");
  });

  it("trả về userAgent thô và thời điểm dạng ISO", async () => {
    vi.mocked(tokenService.listActive).mockResolvedValue([
      {
        id: "s-1",
        userAgent: "Mozilla/5.0 (iPhone)",
        ip: "203.0.113.7",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        expiresAt: new Date("2026-09-01T10:00:00Z"),
      },
    ]);
    const token = await signSession(owner);

    const response = await GET(requestWith(token));
    const body = (await response.json()) as SessionsBody;

    expect(body.data.sessions[0]).toMatchObject({
      id: "s-1",
      userAgent: "Mozilla/5.0 (iPhone)",
    });
  });
});

describe("DELETE /api/v1/auth/sessions/[id]", () => {
  async function del(id: string, token?: string) {
    return DELETE(
      new Request(`http://localhost/api/v1/auth/sessions/${id}`, {
        method: "DELETE",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("401 khi chưa đăng nhập", async () => {
    const response = await del("s-1");

    expect(response.status).toBe(401);
    expect(tokenService.revokeById).not.toHaveBeenCalled();
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * `id` đến từ URL nên người gọi tự đặt được. Ràng buộc quyền sở hữu phải đi
   * xuống tới câu truy vấn, không được là một phép kiểm tra riêng ở tầng trên —
   * kiểm tra riêng thì có ngày ai đó thêm đường gọi mới mà quên mất nó.
   */
  it("truyền userId xuống service để service tự ràng buộc quyền sở hữu", async () => {
    vi.mocked(tokenService.revokeById).mockResolvedValue(true);
    const token = await signSession(owner);

    await del("s-999", token);

    expect(tokenService.revokeById).toHaveBeenCalledWith("s-999", "u-1");
  });

  it("404 khi phiên không tồn tại HOẶC thuộc người khác — không phân biệt hai ca", async () => {
    vi.mocked(tokenService.revokeById).mockResolvedValue(false);
    const token = await signSession(owner);

    const response = await del("cua-nguoi-khac", token);
    const body = (await response.json()) as ErrorBody;

    // Trả 403 cho ca "của người khác" là xác nhận id đó có thật — đủ để dò.
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("200 khi thu hồi thành công", async () => {
    vi.mocked(tokenService.revokeById).mockResolvedValue(true);
    const token = await signSession(owner);

    const response = await del("s-1", token);

    expect(response.status).toBe(200);
  });
});
