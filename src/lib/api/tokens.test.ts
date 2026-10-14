import { describe, expect, it, vi } from "vitest";

const issue = vi.hoisted(() => vi.fn());
vi.mock("@/services/token.service", () => ({ tokenService: { issue } }));

const { issueTokenPair } = await import("./tokens");
const { verifySession } = await import("@/lib/session");

const USER = { id: "u1", email: "a@b.com", roles: ["USER"] };

describe("issueTokenPair", () => {
  it("`sessionId` và `sid` trong access token là FAMILY ID — ổn định qua mọi lần refresh", async () => {
    issue.mockResolvedValue({ token: "rt", familyId: "fam-1", expiresAt: new Date("2026-12-01") });

    const pair = await issueTokenPair(USER);
    const session = await verifySession(pair.accessToken);

    expect(pair).toMatchObject({ tokenType: "Bearer", refreshToken: "rt", sessionId: "fam-1" });
    expect(session).toMatchObject({ typ: "access", sub: "u1", sid: "fam-1" });
  });

  it("đăng nhập qua 2FA thì access token mang mốc `mfa`; không qua thì KHÔNG có", async () => {
    issue.mockResolvedValue({ token: "rt", familyId: "fam-1", expiresAt: new Date() });
    const at = new Date("2026-10-10T00:00:00Z");

    const withMfa = await verifySession(
      (await issueTokenPair(USER, { twoFactorAt: at })).accessToken,
    );
    const without = await verifySession((await issueTokenPair(USER)).accessToken);

    expect(withMfa?.mfa).toBe(at.toISOString());
    expect(without?.mfa).toBeUndefined();
  });
});
