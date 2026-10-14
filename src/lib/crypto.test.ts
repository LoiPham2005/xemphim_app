import { describe, expect, it } from "vitest";
import { CryptoUtils } from "@/lib/crypto";

describe("CryptoUtils", () => {
  it("băm rồi kiểm tra lại được chính mật khẩu đó", async () => {
    const hash = await CryptoUtils.hashPassword("matkhau-rat-dai-123");

    await expect(CryptoUtils.verifyPassword("matkhau-rat-dai-123", hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it("từ chối mật khẩu sai", async () => {
    const hash = await CryptoUtils.hashPassword("dung");
    const check = await CryptoUtils.verifyPassword("sai", hash);

    expect(check.valid).toBe(false);
  });

  it("hai lần băm cùng một mật khẩu cho ra hai chuỗi khác nhau", async () => {
    // Salt ngẫu nhiên. Nếu hai chuỗi giống nhau nghĩa là salt đang cố định — và
    // lúc đó một bảng tra sẵn phá được toàn bộ kho mật khẩu cùng lúc.
    const a = await CryptoUtils.hashPassword("cung-mot-mat-khau");
    const b = await CryptoUtils.hashPassword("cung-mot-mat-khau");

    expect(a).not.toBe(b);
  });

  it("hash thuật toán khác (bcrypt cũ) thất bại AN TOÀN, không crash", async () => {
    // Bộ khung chỉ dùng Argon2id. Một hash bcrypt lọt vào database do nhập dữ
    // liệu từ hệ thống cũ phải dẫn tới "sai mật khẩu", không phải lỗi 500 —
    // xem ghi chú đầu `crypto.ts` để biết cách hỗ trợ nếu thật sự cần.
    const bcryptHash = "$2b$10$mfOSMFAGI5rmd4CXWS5m5OG/.CdQ6RzFezGMk0HTrnqnYZDRwKyz.";

    await expect(CryptoUtils.verifyPassword("password", bcryptHash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("đánh dấu cần băm lại khi tham số Argon2 đã lỗi thời", async () => {
    // Hash Argon2id hợp lệ nhưng sinh bằng memoryCost thấp hơn cấu hình hiện
    // tại. Đây là cách toàn bộ kho mật khẩu tự nâng cấp sau mỗi lần đăng nhập
    // khi bạn siết tham số để theo kịp phần cứng mới.
    const { hash } = await import("@node-rs/argon2");
    const weak = await hash("matkhau-cu", {
      algorithm: 2,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });

    await expect(CryptoUtils.verifyPassword("matkhau-cu", weak)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it("hash rác trả về 'sai mật khẩu' thay vì ném lỗi", async () => {
    // Một dòng dữ liệu hỏng trong database phải dẫn tới đăng nhập thất bại,
    // KHÔNG phải lỗi 500 — vốn làm lộ ra rằng bản ghi đó có vấn đề.
    await expect(CryptoUtils.verifyPassword("bat-ky", "day-khong-phai-hash")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("fakeCompare không ném lỗi và tốn thời gian tương đương", async () => {
    // Không có nó, "email không tồn tại" trả về nhanh hơn hẳn "sai mật khẩu",
    // và đo thời gian phản hồi là dò ra được email nào đã đăng ký.
    const startedAt = Date.now();
    await CryptoUtils.fakeCompare("bat-ky");

    expect(Date.now() - startedAt).toBeGreaterThan(5);
  });
});
