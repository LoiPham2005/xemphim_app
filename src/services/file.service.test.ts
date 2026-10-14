import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  DirectUploadUnsupportedError,
  FileInUseError,
  FileNotFoundError,
  FileNotUsableError,
  FileRejectedError,
} from "@/lib/errors";
import type * as StorageModule from "@/lib/storage";

const storage = vi.hoisted(() => ({
  put: vi.fn(),
  delete: vi.fn(),
  url: (key: string) => `https://cdn.test/${key}`,
  presignPut: vi.fn() as ReturnType<typeof vi.fn> | undefined,
  head: vi.fn() as ReturnType<typeof vi.fn> | undefined,
  readHead: vi.fn() as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  getStorage: () => storage,
}));

const { FileService } = await import("./file.service");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const MP4_HEAD = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypmp42"),
  Buffer.alloc(4),
]);

const FILE = {
  id: "f1",
  key: "avatars/1-abc.png",
  originalName: "anh.png",
  mimeType: "image/png",
  size: 3,
  status: "READY" as "READY" | "PENDING",
  uploadedById: "u1",
  attachedAt: null as Date | null,
  createdAt: new Date("2026-10-09T00:00:00Z"),
};

type FileMock = Record<
  "create" | "findUnique" | "findFirst" | "findMany" | "count" | "update" | "updateMany" | "delete",
  ReturnType<typeof vi.fn>
>;

function createDb(file: Partial<typeof FILE> | null = FILE) {
  const row = file === null ? null : { ...FILE, ...file };
  const db = {
    file: {
      create: vi.fn(({ data }: { data: object }) => Promise.resolve({ ...FILE, ...data })),
      findUnique: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue(row ? [row] : []),
      count: vi.fn().mockResolvedValue(row ? 1 : 0),
      update: vi.fn(({ data }: { data: object }) => Promise.resolve({ ...row, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue(row),
    } satisfies FileMock,
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return db as unknown as PrismaClient & { file: FileMock };
}

const OWNER = { userId: "u1", canManage: false };
const OTHER = { userId: "u2", canManage: false };
const MANAGER = { userId: "admin", canManage: true };
const RULE = { field: "avatarFileId", ownerIds: ["u1"], mimePrefix: "image/" };

beforeEach(() => {
  vi.clearAllMocks();
  storage.presignPut = vi.fn();
  storage.head = vi.fn();
  storage.readHead = vi.fn();
});

describe("FileService.upload (qua máy chủ)", () => {
  it("kiểm nội dung theo luật của nhóm rồi mới lưu kho + ghi sổ", async () => {
    storage.put.mockResolvedValue({
      key: "k.png",
      url: "",
      size: PNG.length,
      contentType: "image/png",
    });
    const db = createDb();

    const saved = await new FileService(db).upload(
      { data: PNG, originalName: "a.png", contentType: "image/png" },
      "u1",
    );

    expect(storage.put).toHaveBeenCalled();
    expect(saved).toMatchObject({ key: "k.png", attached: false });
  });

  it("nội dung không khớp định dạng khai báo -> 422 vào trường `file`, KHÔNG lưu gì", async () => {
    const db = createDb();

    await expect(
      new FileService(db).upload(
        {
          data: Buffer.from("MZ đây là file thực thi"),
          originalName: "a.pdf",
          contentType: "application/pdf",
        },
        "u1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: { file: expect.any(Array) } });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("video bị chặn ở đường qua máy chủ — phải tải trực tiếp", async () => {
    await expect(
      new FileService(createDb()).upload(
        { data: MP4_HEAD, originalName: "a.mp4", contentType: "video/mp4" },
        "u1",
      ),
    ).rejects.toBeInstanceOf(FileRejectedError);
  });
});

describe("FileService.record", () => {
  it("ghi khoá + người tải lên; URL dựng từ kho, không lưu vào DB", async () => {
    const db = createDb();
    const saved = await new FileService(db).record(
      { key: FILE.key, size: 3, contentType: "image/png" },
      { originalName: "anh.png", uploadedById: "u1" },
    );

    const { data } = db.file.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      key: FILE.key,
      mimeType: "image/png",
      size: 3,
      uploadedById: "u1",
    });
    expect(data).not.toHaveProperty("url");
    expect(saved.url).toBe(`https://cdn.test/${FILE.key}`);
  });
});

describe("tải trực tiếp lên kho (video)", () => {
  const INPUT = {
    fileName: "clip.mp4",
    contentType: "video/mp4",
    size: 1000,
  };

  it("cấp URL ký sẵn + ghi sổ PENDING (chưa dùng/chưa liệt kê được)", async () => {
    storage.presignPut?.mockResolvedValue({
      url: "https://s3/put",
      headers: { "Content-Type": "video/mp4" },
    });
    const db = createDb();

    const result = await new FileService(db).createDirectUpload(INPUT, "u1");

    const { data } = db.file.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ status: "PENDING", mimeType: "video/mp4", uploadedById: "u1" });
    expect(result.upload).toMatchObject({ url: "https://s3/put", method: "PUT" });
  });

  it("định dạng không được phép -> 422 ngay, KHÔNG cấp URL, không ghi sổ", async () => {
    const db = createDb();

    await expect(
      new FileService(db).createDirectUpload(
        { ...INPUT, contentType: "application/x-msdownload" },
        "u1",
      ),
    ).rejects.toBeInstanceOf(FileRejectedError);
    expect(storage.presignPut).not.toHaveBeenCalled();
    expect(db.file.create).not.toHaveBeenCalled();
  });

  it("nhóm SUY RA từ contentType — client không gửi `kind`, luật video (4GB) được áp", async () => {
    storage.presignPut?.mockResolvedValue({ url: "https://s3/put", headers: {} });

    await expect(
      new FileService(createDb()).createDirectUpload(
        { ...INPUT, size: 3 * 1024 * 1024 * 1024 },
        "u1",
      ),
    ).resolves.toBeDefined();
  });

  it("kho không hỗ trợ (đĩa cục bộ) -> báo rõ, không ghi sổ", async () => {
    storage.presignPut = undefined;
    const db = createDb();

    await expect(new FileService(db).createDirectUpload(INPUT, "u1")).rejects.toBeInstanceOf(
      DirectUploadUnsupportedError,
    );
    expect(db.file.create).not.toHaveBeenCalled();
  });

  it("khai dung lượng vượt luật thì từ chối NGAY, chưa cấp URL", async () => {
    await expect(
      new FileService(createDb()).createDirectUpload(
        { ...INPUT, size: 5 * 1024 * 1024 * 1024 },
        "u1",
      ),
    ).rejects.toBeInstanceOf(FileRejectedError);
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it("xác nhận: kiểm tệp THẬT trên kho rồi chuyển READY với dung lượng thật", async () => {
    storage.head?.mockResolvedValue({ size: 4321 });
    storage.readHead?.mockResolvedValue(MP4_HEAD);
    const db = createDb({ status: "PENDING", mimeType: "video/mp4", key: "v.mp4" });

    const file = await new FileService(db).completeDirectUpload("f1", OWNER);

    expect(db.file.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { status: "READY", size: 4321 },
    });
    expect(file.kind).toBe("video");
  });

  it("nội dung trên kho KHÔNG phải video -> xoá cả kho lẫn sổ, trả 422", async () => {
    storage.head?.mockResolvedValue({ size: 100 });
    storage.readHead?.mockResolvedValue(Buffer.from("MZ đây là file thực thi đổi tên"));
    const db = createDb({ status: "PENDING", mimeType: "video/mp4", key: "v.mp4" });

    await expect(new FileService(db).completeDirectUpload("f1", OWNER)).rejects.toBeInstanceOf(
      FileRejectedError,
    );
    expect(storage.delete).toHaveBeenCalledWith("v.mp4");
    expect(db.file.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });

  it("chưa thấy tệp trên kho (client chưa PUT xong) -> báo lỗi, KHÔNG xoá sổ", async () => {
    storage.head?.mockResolvedValue(null);
    const db = createDb({ status: "PENDING", mimeType: "video/mp4" });

    await expect(new FileService(db).completeDirectUpload("f1", OWNER)).rejects.toBeInstanceOf(
      FileRejectedError,
    );
    expect(db.file.delete).not.toHaveBeenCalled();
  });

  it("chỉ NGƯỜI TẢI LÊN mới xác nhận được — điều kiện nằm trong câu truy vấn", async () => {
    const db = createDb(null);

    await expect(new FileService(db).completeDirectUpload("f1", OTHER)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    expect(db.file.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", status: "PENDING", uploadedById: "u2" },
    });
  });
});

describe("xem / sửa / xoá", () => {
  it("người thường chỉ thấy tệp CỦA MÌNH, bỏ qua mọi lọc uploadedById gửi lên", async () => {
    const db = createDb();
    await new FileService(db).list({ page: 1, limit: 20, uploadedById: "u9" }, OWNER);

    const { where } = db.file.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(where).toMatchObject({ status: "READY", uploadedById: "u1" });
  });

  it("file:manage thấy tất cả, lọc được theo nhóm/người tải/trạng thái gắn", async () => {
    const db = createDb();
    const result = await new FileService(db).list(
      { page: 1, limit: 20, kind: "image", attached: false, uploadedById: "u9" },
      MANAGER,
    );

    const { where } = db.file.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(where).toMatchObject({
      uploadedById: "u9",
      mimeType: { startsWith: "image/" },
      attachedAt: null,
    });
    expect(result.meta).toMatchObject({ total: 1, page: 1 });
  });

  it("xem tệp của người khác -> 404 (không lộ tệp có tồn tại)", async () => {
    const db = createDb(null);
    await expect(new FileService(db).get("f1", OTHER)).rejects.toBeInstanceOf(FileNotFoundError);
    expect(db.file.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", status: "READY", uploadedById: "u2" },
    });
  });

  it("đổi tên chỉ đổi originalName", async () => {
    const db = createDb();
    const file = await new FileService(db).rename("f1", { originalName: "tên mới.png" }, OWNER);

    expect(db.file.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { originalName: "tên mới.png" },
    });
    expect(file.originalName).toBe("tên mới.png");
  });

  it("xoá: tệp đang được dùng (vd. avatar) -> 409, không đụng tới kho", async () => {
    const db = createDb({ attachedAt: new Date() });

    await expect(new FileService(db).remove("f1", OWNER)).rejects.toBeInstanceOf(FileInUseError);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("xoá tệp mồ côi: xoá trên kho TRƯỚC rồi mới xoá dòng", async () => {
    const db = createDb();
    await new FileService(db).remove("f1", MANAGER);

    expect(storage.delete).toHaveBeenCalledWith(FILE.key);
    expect(db.file.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      db.file.delete.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe("FileService.claim", () => {
  it("gắn tệp hợp lệ — điều kiện `attachedAt: null` để hai request không cùng gắn một tệp", async () => {
    const db = createDb();
    await new FileService().claim(db, "f1", RULE);

    expect(db.file.updateMany).toHaveBeenCalledWith({
      where: { id: "f1", attachedAt: null },
      data: { attachedAt: expect.any(Date) },
    });
  });

  it.each([
    ["không tồn tại", null],
    ["của người khác", { uploadedById: "u2" }],
    ["đang gắn ở nơi khác", { attachedAt: new Date() }],
    ["sai loại (PDF làm avatar)", { mimeType: "application/pdf" }],
    ["người tải lên đã bị xoá", { uploadedById: null as unknown as string }],
    ["chưa tải xong (PENDING)", { status: "PENDING" as const }],
  ])("từ chối tệp %s — cùng một lỗi, không lộ tệp có tồn tại hay không", async (_, file) => {
    const db = createDb(file);

    await expect(new FileService().claim(db, "f1", RULE)).rejects.toBeInstanceOf(
      FileNotUsableError,
    );
    expect(db.file.updateMany).not.toHaveBeenCalled();
  });

  it("thua cuộc đua (request khác vừa gắn) thì báo lỗi, không im lặng coi như xong", async () => {
    const db = createDb();
    db.file.updateMany.mockResolvedValue({ count: 0 });

    await expect(new FileService().claim(db, "f1", RULE)).rejects.toBeInstanceOf(
      FileNotUsableError,
    );
  });
});

describe("FileService.purgeOrphans", () => {
  it("chỉ hỏi tệp mồ côi quá 24h và KHÔNG đang làm avatar của ai", async () => {
    const db = createDb();
    await new FileService(db).purgeOrphans();

    const { where } = db.file.findMany.mock.calls[0]?.[0] as {
      where: {
        attachedAt: unknown;
        avatarOf: unknown;
        moviePoster: unknown;
        episodeVideo: unknown;
        retained: unknown;
        createdAt: { lt: Date };
      };
    };
    expect(where.attachedAt).toBeNull();
    expect(where.avatarOf).toBeNull();
    expect(where.moviePoster).toBeNull();
    expect(where.episodeVideo).toBeNull();
    // Tệp lưu trong thư viện (`retained`) không gắn vào đâu nhưng KHÔNG được dọn.
    expect(where.retained).toBe(false);
    expect(Date.now() - where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
  });

  it("xoá trên kho TRƯỚC rồi mới xoá dòng; kho lỗi thì giữ dòng để lần sau thử lại", async () => {
    const db = createDb();
    db.file.findMany.mockResolvedValue([
      { id: "a", key: "k-a" },
      { id: "b", key: "k-b" },
    ]);
    storage.delete.mockRejectedValueOnce(new Error("S3 sập")).mockResolvedValueOnce(undefined);

    const deleted = await new FileService(db).purgeOrphans();

    expect(deleted).toBe(1);
    expect(db.file.delete).toHaveBeenCalledTimes(1);
    expect(db.file.delete).toHaveBeenCalledWith({ where: { id: "b" } });
  });
});
