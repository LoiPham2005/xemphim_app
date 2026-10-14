import type { File as FileRow, Prisma, PrismaClient } from "@prisma/client";
import {
  DirectUploadUnsupportedError,
  FileInUseError,
  FileNotFoundError,
  FileNotUsableError,
  FileRejectedError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  UPLOAD_RULES,
  UploadRejectedError,
  assertSignature,
  assertTypeAndSize,
  assertUploadAllowed,
  buildStorageKey,
  getStorage,
  kindOf,
} from "@/lib/storage";
import { buildPaginationMeta, toPrismaPage, type Paginated } from "@/schemas/common.schema";
import type {
  CreateUploadInput,
  FileKind,
  ListFilesInput,
  RenameFileInput,
} from "@/schemas/file.schema";

/** Prisma client hoặc transaction client — để gắn/gỡ tệp nằm CHUNG transaction với thao tác nghiệp vụ. */
type Db = PrismaClient | Prisma.TransactionClient;

export type PublicFile = {
  id: string;
  /** Khoá trong kho. Client KHÔNG cần lưu — gửi `id` khi gắn tệp vào bản ghi. */
  key: string;
  url: string;
  originalName: string;
  contentType: string;
  /** Nhóm suy ra từ `contentType` — không phải cột riêng trong database. */
  kind: FileKind | null;
  size: number;
  /** Đang được dùng ở đâu đó (vd. làm avatar). `false` và không `retained` = mồ côi, bị dọn sau 24 giờ. */
  attached: boolean;
  /** Giữ trong thư viện dù không gắn vào đâu — không bị dọn. */
  retained: boolean;
  uploadedById: string | null;
  createdAt: Date;
};

/** Ai đang thao tác: chủ tệp luôn làm được với tệp của mình; `canManage` (`file:manage`) làm được với mọi tệp. */
export type FileViewer = { userId: string; canManage: boolean };

export type DirectUpload = {
  file: PublicFile;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date };
};

/** Tệp mồ côi (chưa gắn vào đâu) quá chừng này thì bị dọn. Đủ dài cho người dùng điền xong form. */
export const ORPHAN_TTL_HOURS = 24;

/** URL tải trực tiếp sống bao lâu. Đủ cho video vài trăm MB qua mạng di động. */
const DIRECT_UPLOAD_TTL_SECONDS = 30 * 60;

/** Đọc bấy nhiêu byte đầu tệp trên kho để kiểm chữ ký — mọi chữ ký trong `SIGNATURES` nằm trong 16 byte. */
const SIGNATURE_BYTES = 64;

/** Điều kiện lọc theo nhóm — suy từ MIME type, không cần cột "loại". */
const KIND_WHERE: Record<FileKind, Prisma.FileWhereInput> = {
  image: { mimeType: { startsWith: "image/" } },
  audio: { mimeType: { startsWith: "audio/" } },
  video: { mimeType: { startsWith: "video/" } },
  document: { mimeType: { in: [...UPLOAD_RULES.document.allowedTypes] } },
};

/**
 * Bảng `files` — sổ ghi mọi tệp đã tải lên kho, dùng chung cho ảnh/tài liệu/âm thanh/video.
 *
 * HAI đường tải lên, cùng đổ về một bảng:
 *   - Qua máy chủ (`upload`, `POST /api/v1/files` multipart): ảnh/tài liệu/âm thanh — tệp nhỏ, kiểm
 *     trọn nội dung trước khi lưu.
 *   - Trực tiếp lên kho (`createDirectUpload` -> client PUT -> `completeDirectUpload`): video và tệp
 *     lớn — không chạy qua RAM của tiến trình Node. Kiểm dung lượng + chữ ký SAU khi tệp lên kho.
 *
 * Gắn vào nghiệp vụ: client gửi `file.id` kèm form (vd. `avatarFileId`), service nghiệp vụ gọi
 * `claim()` trong CÙNG transaction. Thay tệp thì `release()` tệp cũ -> mồ côi -> `purgeOrphans()` dọn.
 *
 * Kho (S3) và database không chung transaction được, nên KHÔNG xoá tệp trên kho lúc nghiệp vụ chạy:
 * transaction rollback thì tệp đã mất. Chỉ đánh dấu, việc xoá thật để `purgeOrphans()` làm sau.
 */
export class FileService {
  constructor(private readonly db: PrismaClient = prisma) {}

  // -------------------------------------------------------------------------
  // Tải lên
  // -------------------------------------------------------------------------

  /**
   * Tải lên QUA MÁY CHỦ: kiểm trọn nội dung theo luật của nhóm, lưu kho, ghi sổ. Nhóm SUY RA từ
   * `contentType` — client không gửi `kind` (hai trường cùng nói một điều là có ngày lệch nhau).
   */
  async upload(
    input: {
      data: Buffer;
      originalName: string;
      contentType: string;
      folder?: string;
      /** Giữ trong thư viện, không dọn. Nơi gọi PHẢI kiểm `file:manage` trước khi bật. */
      retained?: boolean;
    },
    uploadedById: string,
  ): Promise<PublicFile> {
    const kind = ruleKindOf(input.contentType);
    if (kind === "video") {
      throw new FileRejectedError("Video tải trực tiếp lên kho qua POST /api/v1/files/uploads");
    }
    try {
      assertUploadAllowed(input.data, input.contentType, UPLOAD_RULES[kind]);
    } catch (error) {
      if (error instanceof UploadRejectedError) throw new FileRejectedError(error.message);
      throw error;
    }

    const stored = await getStorage().put(input.data, input.originalName, {
      contentType: input.contentType,
      folder: input.folder,
    });
    return this.record(stored, {
      originalName: input.originalName,
      uploadedById,
      retained: input.retained,
    });
  }

  /** Ghi nhận tệp vừa lưu vào kho. Gọi ngay sau `getStorage().put()`. */
  async record(
    stored: { key: string; size: number; contentType: string },
    meta: { originalName: string; uploadedById: string; retained?: boolean },
  ): Promise<PublicFile> {
    const row = await this.db.file.create({
      data: {
        key: stored.key,
        originalName: meta.originalName.slice(0, 255),
        mimeType: stored.contentType,
        size: stored.size,
        uploadedById: meta.uploadedById,
        retained: meta.retained ?? false,
      },
    });
    return toPublicFile(row);
  }

  /**
   * Bước 1 của tải trực tiếp (`input.retain` — nơi gọi PHẢI kiểm `file:manage`): kiểm loại + dung lượng KHAI BÁO, cấp URL ký sẵn, ghi sổ ở trạng thái
   * `PENDING` (chưa dùng/chưa liệt kê được). Client `PUT` nội dung lên `upload.url` kèm đúng
   * `upload.headers`, rồi gọi `completeDirectUpload`.
   */
  async createDirectUpload(input: CreateUploadInput, uploadedById: string): Promise<DirectUpload> {
    const storage = getStorage();
    if (!storage.presignPut) throw new DirectUploadUnsupportedError();

    try {
      assertTypeAndSize(input.contentType, input.size, UPLOAD_RULES[ruleKindOf(input.contentType)]);
    } catch (error) {
      if (error instanceof UploadRejectedError) throw new FileRejectedError(error.message);
      throw error;
    }

    const key = buildStorageKey(input.fileName, input.folder);
    const signed = await storage.presignPut(key, input.contentType, DIRECT_UPLOAD_TTL_SECONDS);

    const row = await this.db.file.create({
      data: {
        key,
        originalName: input.fileName,
        mimeType: input.contentType,
        size: input.size,
        status: "PENDING",
        retained: input.retain ?? false,
        uploadedById,
      },
    });

    return {
      file: toPublicFile(row),
      upload: {
        url: signed.url,
        method: "PUT",
        headers: signed.headers,
        expiresAt: new Date(Date.now() + DIRECT_UPLOAD_TTL_SECONDS * 1000),
      },
    };
  }

  /**
   * Bước 2 của tải trực tiếp: client báo đã PUT xong. URL ký sẵn KHÔNG giới hạn được dung lượng và
   * nội dung, nên kiểm lại trên tệp THẬT trong kho: có tồn tại, dung lượng trong luật, chữ ký đầu tệp
   * khớp định dạng. Không đạt thì xoá cả trên kho lẫn sổ — không để rác nằm chờ.
   */
  async completeDirectUpload(fileId: string, viewer: FileViewer): Promise<PublicFile> {
    const storage = getStorage();
    if (!storage.head || !storage.readHead) throw new DirectUploadUnsupportedError();

    const file = await this.db.file.findFirst({
      where: { id: fileId, status: "PENDING", uploadedById: viewer.userId },
    });
    if (!file) throw new FileNotFoundError();

    const kind = kindOf(file.mimeType);
    const object = await storage.head(file.key);
    if (!object)
      throw new FileRejectedError("Chưa thấy tệp trên kho — hãy tải lên xong rồi mới xác nhận");

    try {
      if (!kind) throw new UploadRejectedError(`Định dạng ${file.mimeType} không được chấp nhận`);
      assertTypeAndSize(file.mimeType, object.size, UPLOAD_RULES[kind]);
      assertSignature(await storage.readHead(file.key, SIGNATURE_BYTES), file.mimeType);
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) throw error;
      await storage.delete(file.key);
      await this.db.file.delete({ where: { id: file.id } });
      throw new FileRejectedError(error.message);
    }

    const row = await this.db.file.update({
      where: { id: file.id },
      data: { status: "READY", size: object.size },
    });
    return toPublicFile(row);
  }

  // -------------------------------------------------------------------------
  // Xem / sửa / xoá
  // -------------------------------------------------------------------------

  /**
   * Danh sách tệp ĐÃ SẴN SÀNG. Người thường chỉ thấy tệp của mình — ràng buộc nằm TRONG câu truy vấn,
   * không phải phép kiểm riêng; `file:manage` thấy tất cả và lọc được theo người tải lên.
   */
  async list(input: ListFilesInput, viewer: FileViewer): Promise<Paginated<PublicFile>> {
    const where: Prisma.FileWhereInput = {
      status: "READY",
      uploadedById: viewer.canManage ? input.uploadedById : viewer.userId,
      ...(input.kind ? KIND_WHERE[input.kind] : {}),
      ...(input.q ? { originalName: { contains: input.q, mode: "insensitive" } } : {}),
      ...(input.attached === undefined
        ? {}
        : { attachedAt: input.attached ? { not: null } : null }),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.file.findMany({ where, orderBy: { createdAt: "desc" }, ...toPrismaPage(input) }),
      this.db.file.count({ where }),
    ]);

    return { items: rows.map(toPublicFile), meta: buildPaginationMeta(total, input) };
  }

  async get(id: string, viewer: FileViewer): Promise<PublicFile> {
    return toPublicFile(await this.findVisible(id, viewer));
  }

  /** Chỉ đổi TÊN hiển thị. Nội dung không sửa được: muốn thay thì tải tệp mới rồi gắn lại. */
  async rename(id: string, input: RenameFileInput, viewer: FileViewer): Promise<PublicFile> {
    await this.findVisible(id, viewer);
    const row = await this.db.file.update({
      where: { id },
      data: { originalName: input.originalName },
    });
    return toPublicFile(row);
  }

  /**
   * Xoá tệp — trên KHO trước rồi mới tới sổ. Tệp đang được dùng thì từ chối (409): xoá là vỡ chỗ đang
   * dùng nó, ví dụ avatar của ai đó thành ảnh hỏng.
   */
  async remove(id: string, viewer: FileViewer): Promise<void> {
    const file = await this.findVisible(id, viewer);
    if (file.attachedAt !== null) throw new FileInUseError();

    await getStorage().delete(file.key);
    await this.db.file.delete({ where: { id } });
  }

  /** Tệp `id` mà `viewer` được thấy — không thấy thì 404, KHÔNG phải 403 (không lộ tệp có tồn tại). */
  private async findVisible(id: string, viewer: FileViewer): Promise<FileRow> {
    const file = await this.db.file.findFirst({
      where: {
        id,
        status: "READY",
        ...(viewer.canManage ? {} : { uploadedById: viewer.userId }),
      },
    });
    if (!file) throw new FileNotFoundError();
    return file;
  }

  // -------------------------------------------------------------------------
  // Gắn vào nghiệp vụ
  // -------------------------------------------------------------------------

  /**
   * Gắn tệp vào một bản ghi nghiệp vụ. Ném `FileNotUsableError` (422 vào trường `field`) khi tệp
   * không tồn tại, chưa tải xong, không do `ownerIds` tải lên, sai loại, hoặc đang gắn ở nơi khác.
   *
   * `ownerIds`: ai được phép dùng tệp — thường là chủ bản ghi VÀ người đang thao tác (admin tải ảnh
   * lên hộ người khác thì tệp mang id admin).
   */
  async claim(
    db: Db,
    fileId: string,
    rule: { field: string; ownerIds: string[]; mimePrefix?: string },
  ): Promise<void> {
    const file = await db.file.findUnique({ where: { id: fileId } });
    const usable =
      file !== null &&
      file.status === "READY" &&
      file.attachedAt === null &&
      file.uploadedById !== null &&
      rule.ownerIds.includes(file.uploadedById) &&
      (!rule.mimePrefix || file.mimeType.startsWith(rule.mimePrefix));

    if (!usable) throw new FileNotUsableError(rule.field);

    // `attachedAt: null` trong điều kiện: hai request cùng gắn một tệp thì chỉ một bên thắng.
    const { count } = await db.file.updateMany({
      where: { id: fileId, attachedAt: null },
      data: { attachedAt: new Date() },
    });
    if (count === 0) throw new FileNotUsableError(rule.field);
  }

  /** Gỡ tệp khỏi bản ghi nghiệp vụ — nó thành mồ côi và `purgeOrphans()` sẽ xoá. */
  async release(db: Db, fileId: string): Promise<void> {
    await db.file.updateMany({ where: { id: fileId }, data: { attachedAt: null } });
  }

  /**
   * Xoá tệp mồ côi quá `ORPHAN_TTL_HOURS` — gồm cả lượt tải trực tiếp bỏ dở (`PENDING`). Xoá trên KHO
   * trước rồi mới tới database: xoá kho hỏng thì dòng còn đó và lần chạy sau thử lại; làm ngược lại
   * thì tệp trên kho mất dấu vĩnh viễn.
   *
   * `avatarOf: null` là chốt an toàn thứ hai: dữ liệu cũ/sửa tay có thể trỏ tới tệp mà quên đặt
   * `attachedAt` — không bao giờ xoá tệp đang có người dùng.
   */
  async purgeOrphans(batchSize = 200): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 3_600_000);
    const orphans = await this.db.file.findMany({
      where: {
        attachedAt: null,
        retained: false,
        createdAt: { lt: cutoff },
        avatarOf: null,
        moviePoster: null,
        episodeVideo: null,
      },
      select: { id: true, key: true },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });

    let deleted = 0;
    for (const file of orphans) {
      try {
        await getStorage().delete(file.key);
        await this.db.file.delete({ where: { id: file.id } });
        deleted++;
      } catch (error) {
        logger.warn("Không xoá được tệp mồ côi — lần chạy sau thử lại", { key: file.key, error });
      }
    }
    return deleted;
  }
}

/** Nhóm của MIME type để chọn luật; định dạng không được phép thì 422 ngay, không cấp gì. */
function ruleKindOf(contentType: string): FileKind {
  const kind = kindOf(contentType);
  if (!kind) throw new FileRejectedError(`Định dạng ${contentType} không được chấp nhận`);
  return kind;
}

export function toPublicFile(row: FileRow): PublicFile {
  return {
    id: row.id,
    key: row.key,
    url: getStorage().url(row.key),
    originalName: row.originalName,
    contentType: row.mimeType,
    kind: kindOf(row.mimeType),
    size: Number(row.size),
    attached: row.attachedAt !== null,
    retained: row.retained,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
  };
}

export const fileService = new FileService();
