import { describe, expect, it } from "vitest";
import {
  generateNumericOtp,
  generateOpaqueToken,
  generateRecoveryCode,
  hashOpaqueToken,
  hashScopedToken,
  normalizeRecoveryCode,
  safeEqualHash,
} from "@/lib/opaque-token";

describe("opaque token", () => {
  it("mỗi lần sinh ra một giá trị khác nhau", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(200);
  });

  it("băm ổn định và không thể suy ngược ra token gốc", () => {
    const token = generateOpaqueToken();

    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toContain(token);
    // SHA-256 hex = 64 ký tự.
    expect(hashOpaqueToken(token)).toHaveLength(64);
  });

  it("OTP luôn đủ số chữ số, kể cả khi giá trị bắt đầu bằng 0", () => {
    for (let i = 0; i < 300; i += 1) {
      const otp = generateNumericOtp(6);
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it("safeEqualHash trả false thay vì ném lỗi khi độ dài khác nhau", () => {
    // `timingSafeEqual` của Node ném lỗi khi độ dài lệch — mà chính việc ném
    // lỗi đó đã làm lộ thông tin.
    expect(safeEqualHash("abc", "abcdef")).toBe(false);
    expect(safeEqualHash("giong-nhau", "giong-nhau")).toBe(true);
  });
});

describe("băm có phạm vi (scoped hash)", () => {
  it("cùng một mã, hai người dùng → hai hash KHÁC nhau", () => {
    /*
     * Đây là lỗ hổng mà `hashScopedToken` sinh ra để bịt.
     *
     * `SHA-256("123456")` là một hằng số. Băm OTP bằng hash trần rồi tra cứu
     * bằng chính nó sẽ trả về bản ghi của NGƯỜI KHÁC: A nhập đúng mã của mình,
     * hệ thống trả về `userId` của B, và A đăng nhập vào tài khoản B.
     */
    const a = hashScopedToken("user-a:PHONE_OTP", "123456");
    const b = hashScopedToken("user-b:PHONE_OTP", "123456");

    expect(a).not.toBe(b);
  });

  it("cùng phạm vi + cùng mã → hash ổn định", () => {
    expect(hashScopedToken("u1:PHONE_OTP", "123456")).toBe(
      hashScopedToken("u1:PHONE_OTP", "123456"),
    );
  });

  it("không nhầm lẫn được ranh giới giữa phạm vi và token", () => {
    // Không có dấu phân tách thì scope="ab"+token="c" băm ra cùng giá trị với
    // scope="a"+token="bc" — một cách tra chéo giữa hai người dùng.
    expect(hashScopedToken("ab", "c")).not.toBe(hashScopedToken("a", "bc"));
  });

  it("hash không chứa mã gốc", () => {
    expect(hashScopedToken("u1", "123456")).not.toContain("123456");
  });
});

describe("mã khôi phục 2FA", () => {
  it("đúng định dạng 5 ký tự - 5 ký tự, không có chữ dễ đọc nhầm", () => {
    for (let i = 0; i < 200; i += 1) {
      // Bỏ I, L, O, U vì người dùng chép tay từ giấy.
      expect(generateRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it("mỗi lần sinh ra một mã khác nhau", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(500);
  });

  it("chuẩn hoá bỏ gạch, khoảng trắng và chữ thường", () => {
    // Người dùng dán lại mã theo đủ kiểu; tất cả phải quy về một dạng, nếu
    // không thì mã đúng vẫn bị từ chối.
    expect(normalizeRecoveryCode(" a1b2c-3d4e5 ")).toBe("A1B2C3D4E5");
    expect(normalizeRecoveryCode("A1B2C3D4E5")).toBe("A1B2C3D4E5");
  });
});
