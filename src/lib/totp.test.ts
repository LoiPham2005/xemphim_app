import { describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
import { createTotpSecret, verifyTotp } from "@/lib/totp";

/** Sinh mã đúng cho một bí mật, dùng chính tham số mà `totp.ts` khai báo. */
function generate(secret: string, timestamp?: number): string {
  const totp = new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.generate(timestamp === undefined ? undefined : { timestamp });
}

describe("TOTP", () => {
  it("sinh bí mật base32 kèm URI otpauth chứa tên sản phẩm", () => {
    const setup = createTotpSecret("Cửa Hàng ABC", "an@example.com");

    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(setup.uri)).toContain("Cửa Hàng ABC");
  });

  it("mỗi lần sinh ra một bí mật khác nhau", () => {
    const a = createTotpSecret("App", "a@example.com").secret;
    const b = createTotpSecret("App", "b@example.com").secret;

    expect(a).not.toBe(b);
  });

  it("chấp nhận mã đúng của thời điểm hiện tại", () => {
    const { secret } = createTotpSecret("App", "a@example.com");

    expect(verifyTotp(secret, generate(secret))).toBe(0);
  });

  it("bỏ qua khoảng trắng người dùng dán kèm từ app xác thực", () => {
    const { secret } = createTotpSecret("App", "a@example.com");
    const code = generate(secret);

    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(0);
  });

  it("chấp nhận lệch ±1 bước (đồng hồ điện thoại sai vài giây)", () => {
    const { secret } = createTotpSecret("App", "a@example.com");
    const now = Date.now();

    expect(verifyTotp(secret, generate(secret, now - 30_000))).toBe(-1);
    expect(verifyTotp(secret, generate(secret, now + 30_000))).toBe(1);
  });

  it("TỪ CHỐI mã lệch 2 bước trở lên", () => {
    // Cửa sổ rộng hơn không giải quyết được đồng hồ lệch hẳn vài phút, mà chỉ
    // nhân số mã hợp lệ tại mỗi thời điểm lên.
    const { secret } = createTotpSecret("App", "a@example.com");

    expect(verifyTotp(secret, generate(secret, Date.now() - 90_000))).toBeNull();
  });

  it("từ chối mã sai và mã của bí mật khác", () => {
    const a = createTotpSecret("App", "a@example.com").secret;
    const b = createTotpSecret("App", "b@example.com").secret;

    expect(verifyTotp(a, "000000")).toBeNull();
    expect(verifyTotp(a, generate(b))).toBeNull();
  });

  it("bí mật hỏng trả null thay vì ném lỗi", () => {
    // Một bản ghi hỏng trong database phải dẫn tới "mã sai", không phải lỗi 500
    // làm lộ ra rằng bản ghi đó có vấn đề.
    expect(verifyTotp("khong-phai-base32!!!", "123456")).toBeNull();
  });
});
