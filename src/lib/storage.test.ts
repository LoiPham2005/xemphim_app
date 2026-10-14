import { describe, expect, it } from "vitest";
import {
  IMAGE_UPLOAD,
  UPLOAD_RULES,
  UploadRejectedError,
  assertSignature,
  assertTypeAndSize,
  assertUploadAllowed,
  buildStorageKey,
  kindOf,
} from "./storage";

/** Dựng buffer có magic bytes của một định dạng ảnh thật. */
function fakeImage(type: "jpeg" | "png" | "gif" | "webp", size = 64): Buffer {
  const buffer = Buffer.alloc(size);

  if (type === "jpeg") buffer.set([0xff, 0xd8, 0xff], 0);
  if (type === "png") buffer.set([0x89, 0x50, 0x4e, 0x47], 0);
  if (type === "gif") buffer.write("GIF8", 0, "ascii");
  if (type === "webp") {
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
  }

  return buffer;
}

describe("buildStorageKey", () => {
  it("KHÔNG giữ tên file gốc", () => {
    const key = buildStorageKey("Ảnh Của Tôi.png");

    // Tên do người dùng đặt là dữ liệu không tin được. Giữ lại nó làm khoá là
    // mở đường cho đủ thứ: trùng tên, ký tự lạ, và tệ nhất là đường dẫn.
    expect(key).not.toContain("Ảnh");
    expect(key.endsWith(".png")).toBe(true);
  });

  it("chặn path traversal trong TÊN FILE", () => {
    const key = buildStorageKey("../../../etc/passwd");

    expect(key).not.toContain("..");
    expect(key).not.toContain("/etc/");
  });

  it("chặn path traversal trong THƯ MỤC", () => {
    const key = buildStorageKey("a.png", "../../secret");

    expect(key).not.toContain("..");
  });

  it("bỏ phần mở rộng lạ thay vì giữ nguyên", () => {
    // `.php%00` là kỹ thuật cũ nhưng vẫn xuất hiện: chèn byte null để qua mặt
    // bộ lọc phần mở rộng.
    const key = buildStorageKey("shell.php%00.png");

    expect(key).not.toContain("%00");
  });

  it("hai lần gọi cho ra hai khoá khác nhau", () => {
    expect(buildStorageKey("a.png")).not.toBe(buildStorageKey("a.png"));
  });
});

describe("assertUploadAllowed", () => {
  it("cho qua ảnh hợp lệ", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("png"), "image/png", IMAGE_UPLOAD);
    }).not.toThrow();
  });

  it("từ chối file rỗng", () => {
    expect(() => {
      assertUploadAllowed(Buffer.alloc(0), "image/png", IMAGE_UPLOAD);
    }).toThrow(UploadRejectedError);
  });

  it("từ chối file quá lớn", () => {
    const tooBig = Buffer.alloc(IMAGE_UPLOAD.maxBytes + 1);
    tooBig.set([0x89, 0x50, 0x4e, 0x47], 0);

    expect(() => {
      assertUploadAllowed(tooBig, "image/png", IMAGE_UPLOAD);
    }).toThrow(/vượt quá/);
  });

  it("từ chối định dạng không nằm trong danh sách trắng", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("png"), "application/x-msdownload", IMAGE_UPLOAD);
    }).toThrow(/không được chấp nhận/);
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * `File.type` do TRÌNH DUYỆT khai báo, và trình duyệt suy ra nó từ phần mở
   * rộng. Đổi tên `virus.exe` thành `anh.png` là đủ để `type` thành
   * `image/png` — nên chỉ kiểm `type` là không kiểm gì cả.
   */
  it("từ chối file KHÔNG phải ảnh dù khai là ảnh", () => {
    const notAnImage = Buffer.from("MZ\x90\x00 đây là file thực thi, không phải ảnh");

    // Bản đầu của `assertUploadAllowed` để lọt đúng ca này: nó chỉ đối chiếu
    // KHI nhận diện được định dạng, mà file thực thi thì không nhận diện được
    // nên rơi vào nhánh "bỏ qua". Danh sách trắng đảo lại logic đó — với ảnh,
    // "không chứng minh được là ảnh" nghĩa là từ chối.
    expect(() => {
      assertUploadAllowed(notAnImage, "image/png", IMAGE_UPLOAD);
    }).toThrow(/không phải ảnh hợp lệ/);
  });

  it("phát hiện cả khi đổi giữa hai định dạng ảnh", () => {
    expect(() => {
      assertUploadAllowed(fakeImage("jpeg"), "image/png", IMAGE_UPLOAD);
    }).toThrow(/không khớp/);
  });

  it("nhận diện đúng cả bốn định dạng ảnh được hỗ trợ", () => {
    const cases = [
      ["jpeg", "image/jpeg"],
      ["png", "image/png"],
      ["gif", "image/gif"],
      ["webp", "image/webp"],
    ] as const;

    for (const [kind, mime] of cases) {
      expect(() => {
        assertUploadAllowed(fakeImage(kind), mime, IMAGE_UPLOAD);
      }, `${kind} phải được chấp nhận`).not.toThrow();
    }
  });
});

describe("chữ ký nội dung — tài liệu, âm thanh, video", () => {
  const bytes = (...parts: (string | number[])[]) =>
    Buffer.concat(
      parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
    );
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(16)]);

  const VALID: [string, Buffer][] = [
    ["application/pdf", pad(bytes("%PDF-1.7"))],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pad(bytes([0x50, 0x4b, 0x03, 0x04])),
    ],
    ["application/msword", pad(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))],
    ["audio/mpeg", pad(bytes("ID3"))],
    ["audio/mpeg", pad(bytes([0xff, 0xfb, 0x90]))],
    ["audio/wav", pad(bytes("RIFF", [0, 0, 0, 0], "WAVE"))],
    ["audio/ogg", pad(bytes("OggS"))],
    ["audio/x-m4a", pad(bytes([0, 0, 0, 0x20], "ftypM4A "))],
    ["audio/webm", pad(bytes([0x1a, 0x45, 0xdf, 0xa3]))],
    ["video/mp4", pad(bytes([0, 0, 0, 0x18], "ftypmp42"))],
    ["video/quicktime", pad(bytes([0, 0, 0, 0x14], "ftypqt  "))],
    ["video/webm", pad(bytes([0x1a, 0x45, 0xdf, 0xa3]))],
  ];

  it.each(VALID)("nhận %s có chữ ký đúng", (type, head) => {
    expect(() => assertSignature(head, type)).not.toThrow();
  });

  it.each(VALID.map(([type]) => type))("từ chối file thực thi đổi tên thành %s", (type) => {
    expect(() => assertSignature(pad(bytes("MZ\x90\x00")), type)).toThrow(UploadRejectedError);
  });

  it("định dạng không có chữ ký (TXT/CSV) không bao giờ lọt — danh sách trắng", () => {
    expect(() => assertSignature(pad(bytes("a,b,c")), "text/csv")).toThrow(UploadRejectedError);
  });

  it("mọi định dạng được phép đều có cách kiểm nội dung", () => {
    for (const rule of Object.values(UPLOAD_RULES)) {
      for (const type of rule.allowedTypes) {
        // Ném "không khớp" chứ không ném vì thiếu luật: buffer rỗng là nội dung sai, không phải định dạng lạ.
        expect(() => assertSignature(Buffer.alloc(16), type), type).toThrow(/không/);
      }
    }
  });

  it("dung lượng theo từng nhóm: âm thanh 50MB, video 4GB", () => {
    expect(() => assertTypeAndSize("audio/mpeg", 60 * 1024 * 1024, UPLOAD_RULES.audio)).toThrow(
      /50\.0MB/,
    );
    expect(() =>
      assertTypeAndSize("video/mp4", 3 * 1024 * 1024 * 1024, UPLOAD_RULES.video),
    ).not.toThrow();
    expect(() =>
      assertTypeAndSize("video/mp4", 5 * 1024 * 1024 * 1024, UPLOAD_RULES.video),
    ).toThrow(/4096\.0MB/);
  });

  it("kindOf suy nhóm từ MIME type — không cần cột riêng", () => {
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("application/pdf")).toBe("document");
    expect(kindOf("audio/ogg")).toBe("audio");
    expect(kindOf("video/webm")).toBe("video");
    expect(kindOf("text/html")).toBeNull();
  });
});
