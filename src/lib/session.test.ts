import { describe, expect, it } from "vitest";
import { signSession, verifySession, type SessionPayload } from "./session";

const payload: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["ADMIN"],
};

describe("session", () => {
  it("ký rồi verify lại ra đúng payload ban đầu", async () => {
    const token = await signSession(payload);

    // `toMatchObject` chứ không `toEqual`: JWT tự thêm `iat`, và đó là thứ
    // `SecurityStampService` dùng để vô hiệu mọi access token đã phát trước
    // thời điểm đổi mật khẩu. Mất nó thì đổi mật khẩu không đá được ai ra.
    const verified = await verifySession(token);

    expect(verified).toMatchObject(payload);
    expect(verified?.iat).toBeTypeOf("number");
  });

  it("trả null khi không có token", async () => {
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession("")).resolves.toBeNull();
  });

  it("trả null với token rác", async () => {
    await expect(verifySession("not.a.jwt")).resolves.toBeNull();
  });

  it("từ chối token bị sửa nội dung", async () => {
    // Ký với quyền USER, rồi sửa payload thành ADMIN mà giữ nguyên chữ ký cũ.
    // Đây chính là cách leo thang đặc quyền nếu chữ ký không được kiểm.
    const token = await signSession({ ...payload, typ: "access" as const, roles: ["USER"] });
    const [header, body, signature] = token.split(".");

    const tampered = JSON.parse(atob(body!)) as Record<string, unknown>;
    tampered.role = "ADMIN";
    const forgedBody = btoa(JSON.stringify(tampered)).replaceAll("=", "");

    await expect(verifySession(`${header}.${forgedBody}.${signature}`)).resolves.toBeNull();
  });

  it("từ chối token thiếu trường bắt buộc", async () => {
    // Token hợp lệ về chữ ký nhưng payload sai cấu trúc vẫn phải bị loại.
    const token = await signSession(payload);
    const [, , signature] = token.split(".");
    const header = btoa(JSON.stringify({ alg: "HS256" })).replaceAll("=", "");
    const body = btoa(JSON.stringify({ sub: "x" })).replaceAll("=", "");

    await expect(verifySession(`${header}.${body}.${signature}`)).resolves.toBeNull();
  });
});
