import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/encryption";

describe("mã hoá bí mật", () => {
  it("mã hoá rồi giải mã ra đúng chuỗi ban đầu", () => {
    const plaintext = "JBSWY3DPEHPK3PXP";

    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("hai lần mã hoá cùng một chuỗi cho ra hai bản mã khác nhau", () => {
    // IV ngẫu nhiên mỗi lần. Nếu hai bản mã giống nhau nghĩa là IV đang cố
    // định — và lúc đó nhìn database là biết ngay ai đang dùng chung một bí
    // mật, chưa kể GCM mất hoàn toàn tính an toàn khi dùng lại nonce.
    const a = encryptSecret("cung-mot-bi-mat");
    const b = encryptSecret("cung-mot-bi-mat");

    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("bản mã KHÔNG chứa chuỗi gốc", () => {
    expect(encryptSecret("BI-MAT-DE-NHAN-RA")).not.toContain("BI-MAT-DE-NHAN-RA");
  });

  it("sửa một byte trong bản mã thì giải mã THẤT BẠI, không trả ra rác", () => {
    // Đây là điều AES-GCM cho mà AES-CBC không cho. Nếu chỗ này trả về một
    // chuỗi rác thay vì ném lỗi thì một bí mật bị sửa sẽ được coi là hợp lệ.
    const payload = encryptSecret("bi-mat");
    const parts = payload.split(".");
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      // Đổi ký tự đầu của phần dữ liệu.
      `${parts[3]![0] === "A" ? "B" : "A"}${parts[3]!.slice(1)}`,
    ].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("bản mã của một KHOÁ KHÁC thì không giải mã được", () => {
    /*
     * Dựng bản mã bằng đúng thuật toán nhưng khoá khác, thay vì đổi biến môi
     * trường: `env` được validate MỘT LẦN lúc load module, nên sửa
     * `process.env` giữa chừng không có tác dụng — và một test dựa vào điều đó
     * sẽ xanh vì lý do sai.
     *
     * Đây là tính chất quan trọng nhất của việc mã hoá khoá 2FA: một bản dump
     * database bị lộ mà không có `ENCRYPTION_KEY` thì vô dụng.
     */
    const foreignKey = createHash("sha256").update("mot-khoa-hoan-toan-khac").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", foreignKey, iv);
    const data = Buffer.concat([cipher.update("bi-mat", "utf8"), cipher.final()]);

    const payload = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      data.toString("base64url"),
    ].join(".");

    expect(() => decryptSecret(payload)).toThrow();
  });

  it("từ chối bản mã sai định dạng thay vì đoán bừa", () => {
    expect(() => decryptSecret("khong-phai-ban-ma")).toThrow();
    expect(() => decryptSecret("v9.a.b.c")).toThrow();
  });
});
