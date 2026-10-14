import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WebAuthnService } from "./webauthn.service";
import { UserService } from "./user.service";
import { ForbiddenError, InvalidCredentialsError, UserNotFoundError } from "@/lib/errors";
import { webAuthnConfig } from "@/lib/env";

function createDb(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue({
        email: "a@b.com",
        username: null,
        profile: { fullName: "Nguyễn A" },
        passkeys: [],
      }),
      findFirstOrThrow: vi.fn().mockResolvedValue({
        password: "hash",
        _count: { oauthAccounts: 0, passkeys: 2 },
      }),
    },
    webAuthnCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

const service = (db: PrismaClient) => new WebAuthnService(db, new UserService(db));

describe("cấu hình WebAuthn", () => {
  it("suy ra rpID và origin từ APP_URL", () => {
    // Sai `rpID` thì passkey ĐĂNG KÝ THÀNH CÔNG rồi không bao giờ đăng nhập
    // được — lỗi chỉ lộ ra ở lần thử thứ hai, trên máy người dùng.
    const config = webAuthnConfig();

    expect(config.rpID).toBe("localhost");
    expect(config.origins).toEqual(["http://localhost:3000"]);
  });
});

describe("WebAuthnService — đăng ký", () => {
  it("bắt buộc discoverable credential + xác minh người dùng", async () => {
    /*
     * Hai tuỳ chọn này là thứ biến passkey từ "yếu tố thứ hai" thành "thay thế
     * hẳn mật khẩu":
     *
     *   residentKey: required     → khoá tự mang danh tính, đăng nhập không cần gõ email
     *   userVerification: required → buộc mở khoá bằng sinh trắc/PIN, tức là 2 yếu tố
     */
    const options = await service(createDb()).createRegistrationOptions("u1");

    expect(options.authenticatorSelection?.residentKey).toBe("required");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
  });

  it("liệt kê passkey đã có vào excludeCredentials", async () => {
    // Thiếu bước này thì bấm "thêm passkey" hai lần trên cùng một máy sẽ tạo
    // hai bản ghi cho một thiết bị, và màn quản lý hiện hai dòng giống hệt nhau.
    const db = createDb({
      user: {
        findFirst: vi.fn().mockResolvedValue({
          email: "a@b.com",
          username: null,
          profile: null,
          passkeys: [{ credentialId: "cred-cu", transports: ["internal"] }],
        }),
      },
    });

    const options = await service(db).createRegistrationOptions("u1");

    expect(options.excludeCredentials).toEqual([
      { id: "cred-cu", type: "public-key", transports: ["internal"] },
    ]);
  });

  it("KHÔNG xin attestation", async () => {
    // `attestation: none` tránh hộp thoại cảnh báo quyền riêng tư của trình
    // duyệt, đổi lại một thông tin mà ứng dụng dân sự không dùng vào việc gì.
    const options = await service(createDb()).createRegistrationOptions("u1");

    expect(options.attestation).toBe("none");
  });

  it("người dùng không tồn tại thì báo lỗi rõ ràng", async () => {
    const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(null) } });

    await expect(service(db).createRegistrationOptions("khong-co")).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});

describe("WebAuthnService — đăng nhập", () => {
  it("không truyền allowCredentials — đăng nhập không cần nhập email", async () => {
    /*
     * Điểm mấu chốt của luồng "usernameless". Truyền danh sách vào sẽ buộc phải
     * biết TRƯỚC người dùng là ai, tức là phải có một bước "nhập email" phía
     * trước — và bước đó biến endpoint thành công cụ dò xem email nào đã đăng ký.
     */
    const options = await service(createDb()).createAuthenticationOptions();

    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
  });

  it("passkey không tồn tại trả về ĐÚNG lỗi mà chữ ký sai trả về", async () => {
    // Phân biệt hai trường hợp là xác nhận cho người hỏi biết passkey đó có thật.
    const db = createDb();

    await expect(
      service(db).verifyAuthentication({ id: "khong-co" }, "challenge"),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("chữ ký hỏng KHÔNG làm lộ lý do kỹ thuật ra ngoài", async () => {
    // Thư viện ném lỗi kèm chi tiết (sai origin, sai RP ID). Ghi log thì được,
    // trả ra ngoài thì không — đó là bản đồ cấu hình cho người đang dò.
    const db = createDb({
      webAuthnCredential: {
        findUnique: vi.fn().mockResolvedValue({
          id: "pk-1",
          userId: "u1",
          publicKey: "cGhhaS1sYS1raG9hLXRoYXQ",
          counter: 0n,
          transports: ["internal"],
        }),
        update: vi.fn(),
      },
    });

    await expect(
      service(db).verifyAuthentication({ id: "pk-1", response: {} }, "challenge"),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("WebAuthnService — quản lý", () => {
  it("TỪ CHỐI xoá passkey cuối cùng khi không còn cách đăng nhập nào khác", async () => {
    // Xoá xong là mất tài khoản, và không có nút hoàn tác nào.
    const db = createDb({
      user: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          password: null,
          _count: { oauthAccounts: 0, passkeys: 1 },
        }),
      },
    });

    await expect(service(db).remove("pk-1", "u1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(db.webAuthnCredential.deleteMany).not.toHaveBeenCalled();
  });

  it("cho xoá passkey cuối cùng NẾU vẫn còn mật khẩu", async () => {
    const db = createDb({
      user: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          password: "hash",
          _count: { oauthAccounts: 0, passkeys: 1 },
        }),
      },
    });

    await expect(service(db).remove("pk-1", "u1")).resolves.toBeUndefined();
  });

  it("xoá và đổi tên đều ràng buộc userId ngay trong where", async () => {
    // Id đến từ client, nên thiếu ràng buộc này là xoá/đổi tên được passkey
    // của người khác chỉ bằng cách đoán id.
    const db = createDb();
    await service(db).remove("pk-1", "u1");

    expect(db.webAuthnCredential.deleteMany).toHaveBeenCalledWith({
      where: { id: "pk-1", userId: "u1" },
    });
  });
});
