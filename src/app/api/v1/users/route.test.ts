import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UserServiceModule from "@/services/user.service";

/**
 * Proxy cố tình không chạy trên /api, nên route handler là lớp kiểm quyền duy
 * nhất. Những test này khoá chặt điều đó — mất nó là API mở toang.
 */

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

vi.mock("@/services/user.service", async (importOriginal) => {
  const actual = await importOriginal<typeof UserServiceModule>();
  return { ...actual, userService: { list: vi.fn(), create: vi.fn() } };
});

/**
 * Từ khi vai trò xuống database, `requireApiPermission` phải tra bảng phân
 * quyền. Mock lại để test route không cần một Postgres đang chạy — thứ đang
 * được kiểm ở đây là cách route phản ứng với quyền, không phải cách quyền được
 * đọc lên (đã có `permission.service.test.ts` lo).
 */
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canActOnResource: vi.fn() },
}));

import { buildPaginationMeta, type Paginated } from "@/schemas/common.schema";
import { signSession, type SessionPayload } from "@/lib/session";
import { userService } from "@/services/user.service";
import { permissionService } from "@/services/permission.service";
import { GET, POST } from "./route";

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
type ListBody = { data: { items: unknown[]; meta: Paginated<never>["meta"] } };

const EMPTY_PAGE = { items: [], meta: buildPaginationMeta(0, { page: 1, limit: 20 }) };

async function get(token?: string, query = "") {
  return GET(
    new Request(`http://localhost/api/v1/users${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  vi.mocked(userService.list).mockResolvedValue(EMPTY_PAGE);
  // Mặc định: ADMIN có quyền, USER thì không. `can` nhận userId chứ không nhận
  // vai trò nữa — vai trò đã xuống database, route không còn nhìn thấy nó.
  vi.mocked(permissionService.can).mockImplementation((userId) =>
    Promise.resolve(userId === admin.sub),
  );
});

describe("GET /api/v1/users", () => {
  it("401 khi không có token", async () => {
    const response = await get();

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("UNAUTHENTICATED");
    expect(userService.list).not.toHaveBeenCalled();
  });

  it("403 khi token là USER thường", async () => {
    const response = await get(await signSession(user));

    expect(response.status).toBe(403);
    expect(userService.list).not.toHaveBeenCalled();
  });

  it("200 kèm meta phân trang khi là ADMIN", async () => {
    vi.mocked(userService.list).mockResolvedValue({
      items: [],
      meta: buildPaginationMeta(45, { page: 2, limit: 20 }),
    });

    const response = await get(await signSession(admin), "?page=2&limit=20");
    const body = (await response.json()) as ListBody;

    expect(response.status).toBe(200);
    // `total` và `totalPages` đi kèm ngay trong lần gọi này, không phải một
    // truy vấn count riêng — hai truy vấn có thể thấy hai trạng thái khác nhau.
    expect(body.data.meta).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasNext: true,
    });
    expect(vi.mocked(userService.list).mock.calls[0]?.[0]).toMatchObject({ page: 2, limit: 20 });
  });

  it("chặn limit vượt trần thay vì cho kéo cả bảng", async () => {
    const response = await get(await signSession(admin), "?limit=100000");

    expect(response.status).toBe(422);
    expect(userService.list).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/users", () => {
  async function post(token: string | undefined, body: unknown) {
    return POST(
      new Request("http://localhost/api/v1/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("401 khi không có token", async () => {
    const response = await post(undefined, { email: "new@example.com" });

    expect(response.status).toBe(401);
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("403 khi là USER thường", async () => {
    const response = await post(await signSession(user), { email: "new@example.com" });

    expect(response.status).toBe(403);
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("422 khi body sai định dạng", async () => {
    const response = await post(await signSession(admin), { email: "khong-phai-email" });

    expect(response.status).toBe(422);
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("201 khi ADMIN tạo user hợp lệ, và ADMIN được phép chỉ định vai trò", async () => {
    vi.mocked(userService.create).mockResolvedValue({
      id: "u-2",
      email: "new@example.com",
      phone: null,
      username: "u",
      fullName: null,
      avatarUrl: null,
      status: "ACTIVE",
      emailVerifiedAt: null,
      lockedUntil: null,
      twoFactorEnabled: false,
      roles: ["ADMIN"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await post(await signSession(admin), {
      email: "new@example.com",
      roleKeys: ["ADMIN"],
    });

    expect(response.status).toBe(201);
    // Khác hẳn form trên web: ở đó `roleKeys` bị bỏ qua hoàn toàn vì bất kỳ ai
    // cũng gửi được field ẩn. Ở đây người gọi đã qua `user:create`.
    expect(vi.mocked(userService.create).mock.calls[0]?.[0].roleKeys).toEqual(["ADMIN"]);
  });
});
