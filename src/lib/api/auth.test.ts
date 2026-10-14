import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

import { signSession } from "@/lib/session";
import { __clearRateLimits } from "@/lib/rate-limit";
import { ApiError } from "./response";
import { clientIp, enforceRateLimit, getApiSession, requireApiAdmin, requireApiUser } from "./auth";

const adminPayload: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const userPayload: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

function requestWith(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/users", { headers });
}

beforeEach(async () => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  await __clearRateLimits();
});

describe("getApiSession", () => {
  it("đọc token từ header Authorization: Bearer", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `Bearer ${token}` })),
    ).resolves.toMatchObject(userPayload);
  });

  it("chấp nhận chữ 'bearer' viết thường", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `bearer ${token}` })),
    ).resolves.toMatchObject(userPayload);
  });

  it("bỏ qua scheme khác Bearer", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `Basic ${token}` })),
    ).resolves.toBeNull();
  });

  it("fallback về cookie khi không có header — để web dùng chung endpoint", async () => {
    const token = await signSession(adminPayload);
    cookieStore.get.mockReturnValue({ value: token });

    await expect(getApiSession(requestWith())).resolves.toMatchObject(adminPayload);
  });

  it("trả null khi không có nguồn nào", async () => {
    await expect(getApiSession(requestWith())).resolves.toBeNull();
  });

  it("trả null với token rác trong header", async () => {
    await expect(getApiSession(requestWith({ authorization: "Bearer rac" }))).resolves.toBeNull();
  });
});

describe("requireApiUser / requireApiAdmin", () => {
  it("ném 401 khi chưa đăng nhập", async () => {
    await expect(requireApiUser(requestWith())).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("ném 403 — không phải 404 — khi thiếu quyền", async () => {
    const token = await signSession(userPayload);

    // Web trả 404 để giấu tài nguyên khỏi trình duyệt; API phải nói rõ để
    // client phân biệt được "đăng nhập lại" với "không đủ quyền".
    await expect(
      requireApiAdmin(requestWith({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("cho ADMIN đi qua", async () => {
    const token = await signSession(adminPayload);

    await expect(
      requireApiAdmin(requestWith({ authorization: `Bearer ${token}` })),
    ).resolves.toMatchObject(adminPayload);
  });
});

describe("clientIp", () => {
  it("lấy IP đầu tiên trong x-forwarded-for", () => {
    expect(clientIp(requestWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("fallback x-real-ip rồi tới 'unknown'", () => {
    expect(clientIp(requestWith({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(requestWith())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  it("ném ApiError 429 khi vượt ngưỡng", async () => {
    const request = requestWith({ "x-forwarded-for": "1.1.1.1" });
    const options = { limit: 2, windowSeconds: 60 };

    await enforceRateLimit(request, "test", options);
    await enforceRateLimit(request, "test", options);

    await expect(enforceRateLimit(request, "test", options)).rejects.toThrowError(ApiError);
    await expect(enforceRateLimit(request, "test", options)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("đếm riêng theo IP", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    await enforceRateLimit(requestWith({ "x-forwarded-for": "1.1.1.1" }), "test", options);

    // IP khác thì có bộ đếm riêng, nên vẫn qua được dù IP kia đã chạm ngưỡng.
    await expect(
      enforceRateLimit(requestWith({ "x-forwarded-for": "2.2.2.2" }), "test", options),
    ).resolves.toBeTypeOf("string");
  });
});
