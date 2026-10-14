import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UserServiceModule from "@/services/user.service";

/**
 * `PATCH /api/v1/users/[id]` là endpoint dễ mở đường leo thang đặc quyền nhất
 * trong repo: nó vừa phục vụ "người dùng tự sửa hồ sơ của mình", vừa phục vụ
 * "quản trị viên sửa hồ sơ người khác". Chỉ cần một nhánh quyền viết lỏng là
 * mọi tài khoản đều tự phong ADMIN được bằng một field trong body.
 *
 * Những test dưới đây khoá chặt ranh giới đó.
 */

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

vi.mock("@/services/user.service", async (importOriginal) => {
  const actual = await importOriginal<typeof UserServiceModule>();
  return {
    ...actual,
    userService: { findById: vi.fn(), update: vi.fn(), softDelete: vi.fn() },
  };
});

vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canActOnResource: vi.fn() },
}));

import { signSession, type SessionPayload } from "@/lib/session";
import { userService } from "@/services/user.service";
import { permissionService } from "@/services/permission.service";
import { PATCH } from "./route";

const admin: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const user: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

type ErrorBody = { error: { code: string } };

const updated = {
  id: "user-1",
  email: "user@example.com",
  username: "user",
  fullName: "Tên mới",
  roles: ["USER"],
  phone: null,
  avatarUrl: null,
  twoFactorEnabled: false,
  lockedUntil: null,
  emailVerifiedAt: null,
  status: "ACTIVE" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function patch(id: string, body: unknown, token?: string) {
  return PATCH(
    new Request(`http://localhost/api/v1/users/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  vi.mocked(userService.update).mockResolvedValue(updated);
  // Mặc định: chỉ ADMIN có `user:update`.
  // `can` nhận userId, không nhận vai trò: vai trò nằm dưới database.
  vi.mocked(permissionService.can).mockImplementation((userId) =>
    Promise.resolve(userId === admin.sub),
  );
});

describe("PATCH /api/v1/users/[id]", () => {
  it("401 khi không có token", async () => {
    const response = await patch("user-1", { fullName: "Tên mới" });

    expect(response.status).toBe(401);
    expect(userService.update).not.toHaveBeenCalled();
  });

  it("cho phép người dùng thường sửa hồ sơ của CHÍNH MÌNH", async () => {
    vi.mocked(permissionService.canActOnResource).mockResolvedValue(true);
    const token = await signSession(user);

    const response = await patch("user-1", { fullName: "Tên mới" }, token);

    expect(response.status).toBe(200);
    expect(vi.mocked(userService.update).mock.calls[0]?.[1]).toMatchObject({
      fullName: "Tên mới",
    });
  });

  it("403 khi người dùng thường sửa hồ sơ NGƯỜI KHÁC", async () => {
    vi.mocked(permissionService.canActOnResource).mockResolvedValue(false);
    const token = await signSession(user);

    const response = await patch("victim-9", { fullName: "Tên mới" }, token);

    expect(response.status).toBe(403);
    expect(userService.update).not.toHaveBeenCalled();
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * `profile:update:own` đủ để sửa hồ sơ của chính mình — nhưng KHÔNG được đủ
   * để đổi vai trò của chính mình. Nếu hai luật đó dùng chung một nhánh kiểm
   * tra, mọi người dùng đều tự phong ADMIN bằng đúng một request.
   */
  it("403 khi người dùng thường tự đổi vai trò của chính mình", async () => {
    vi.mocked(permissionService.canActOnResource).mockResolvedValue(true);
    const token = await signSession(user);

    const response = await patch("user-1", { roleKeys: ["ADMIN"] }, token);
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(userService.update).not.toHaveBeenCalled();
  });

  it("cho phép ADMIN đổi vai trò của người khác", async () => {
    vi.mocked(permissionService.canActOnResource).mockResolvedValue(true);
    const token = await signSession(admin);

    const response = await patch("user-1", { roleKeys: ["ADMIN"] }, token);

    expect(response.status).toBe(200);
    // actorId phải được truyền xuống service — đó là thứ giữ luật "không tự
    // đổi vai trò của chính mình" và luật cấm leo thang theo `Role.level`.
    expect(vi.mocked(userService.update).mock.calls[0]?.[2]).toEqual({ actorId: "admin-1" });
  });

  it("422 khi body sai định dạng", async () => {
    vi.mocked(permissionService.canActOnResource).mockResolvedValue(true);
    const token = await signSession(admin);

    const response = await patch("user-1", { username: "CHỮ HOA CÓ DẤU" }, token);

    expect(response.status).toBe(422);
    expect(userService.update).not.toHaveBeenCalled();
  });
});
