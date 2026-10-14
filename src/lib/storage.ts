import "server-only";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env, isProduction } from "./env";
import { logger } from "./logger";
import { FILE_KINDS, type FileKind } from "@/schemas/file.schema";
import { createS3Storage } from "./storage-s3";

/**
 * Lưu trữ file.
 *
 * ---
 * CHỌN NHÀ CUNG CẤP — giống `mailer.ts`
 *
 * 1. Có `S3_BUCKET` → S3 (`storage-s3.ts`) — chạy với AWS, Cloudflare R2, MinIO, Vietnix, Bizfly...
 *    vì tất cả đều nói chung giao thức S3. Chỉ cần đổi `S3_ENDPOINT`.
 * 2. Không có → ghi ra ĐĨA CỤC BỘ (chỉ cho dev, xem cảnh báo dưới).
 * 3. Kho khác hẳn (Google Cloud Storage, máy chủ riêng của khách...) → viết object thoả `Storage`
 *    rồi gọi `setStorage()` lúc khởi động.
 *
 * Tệp tải lên được ghi nhận ở bảng `files` (`fileService`), bảng nghiệp vụ trỏ tới bằng khoá ngoại.
 *
 * ---
 * ⚠️ BẢN GHI ĐĨA CỤC BỘ KHÔNG DÙNG ĐƯỢC TRÊN PRODUCTION
 *
 * Ba lý do, và cả ba đều là lỗi im lặng:
 *
 * 1. **Chạy nhiều instance thì file lạc.** Người dùng tải ảnh lên instance A,
 *    lần sau request rơi vào instance B — ảnh "biến mất".
 * 2. **Container không giữ dữ liệu.** Deploy lại là mất sạch file đã tải lên.
 * 3. **Không có CDN.** Mọi lượt xem ảnh đều đi qua tiến trình Node.
 *
 * Vì vậy trên production, bản mặc định **NÉM LỖI** thay vì âm thầm ghi vào một
 * thư mục sẽ bị xoá. Cùng thái độ với `mailer`: thà hỏng lúc deploy còn hơn
 * mất dữ liệu của người dùng vài tuần sau.
 */

export type StoredFile = {
  /** Khoá dùng để đọc/xoá về sau. Đây là thứ nên lưu vào database. */
  key: string;
  /** URL công khai, nếu nhà cung cấp có. Bản đĩa cục bộ trả đường dẫn tương đối. */
  url: string;
  size: number;
  contentType: string;
};

export type PutOptions = {
  contentType: string;
  /** Thư mục logic, ví dụ `avatars`. Không có thì file nằm ở gốc. */
  folder?: string;
};

export type Storage = {
  put(data: Buffer, originalName: string, options: PutOptions): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /**
   * URL công khai dựng từ khoá. Database chỉ lưu `key`; URL dựng lúc trả về để đổi CDN/bucket
   * không phải sửa dữ liệu.
   */
  url(key: string): string;
  /**
   * URL tạm có chữ ký, dùng cho file RIÊNG TƯ.
   *
   * Không phải nhà cung cấp nào cũng hỗ trợ — trả `null` thì nơi gọi phải tự
   * phục vụ file qua route handler có kiểm quyền.
   */
  signedUrl?(key: string, expiresInSeconds: number): Promise<string | null>;

  /*
   * Ba thao tác cho đường TẢI TRỰC TIẾP (client PUT thẳng lên kho, không qua máy chủ — dành cho video
   * và tệp lớn). Kho không hỗ trợ (đĩa cục bộ) thì bỏ trống: `fileService` báo lỗi rõ ràng.
   */
  /** URL ký sẵn cho client `PUT` nội dung lên. Client PHẢI gửi đúng `headers` trả về. */
  presignPut?(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedPut>;
  /** Tệp có trên kho không, nặng bao nhiêu. `null` = chưa có. */
  head?(key: string): Promise<{ size: number } | null>;
  /** Đọc `bytes` byte ĐẦU tệp — đủ để kiểm chữ ký nội dung mà không tải cả tệp. */
  readHead?(key: string, bytes: number): Promise<Buffer>;
};

export type PresignedPut = { url: string; headers: Record<string, string> };

/**
 * Dựng khoá lưu trữ an toàn.
 *
 * Cố ý KHÔNG giữ tên file gốc làm khoá. Tên do người dùng đặt là dữ liệu không
 * tin được: nó có thể chứa `../` (thoát khỏi thư mục), ký tự Unicode gây rối,
 * hoặc trùng tên file người khác đã tải lên. Chỉ giữ lại phần mở rộng — và
 * cũng lọc luôn phần đó.
 */
export function buildStorageKey(originalName: string, folder?: string): string {
  const ext = extname(originalName).toLowerCase().slice(0, 10);
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : "";

  const name = `${Date.now()}-${randomUUID()}${safeExt}`;

  // Thư mục cũng phải lọc: nơi gọi có thể vô tình truyền vào giá trị từ input.
  const safeFolder = folder?.replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "");

  return safeFolder ? `${safeFolder}/${name}` : name;
}

/** Thư mục ghi file khi chạy bản đĩa cục bộ. Nằm trong `public/` để Next phục vụ tĩnh. */
const LOCAL_DIR = join(process.cwd(), "public", "uploads");

const localDiskStorage: Storage = {
  async put(data, originalName, options) {
    if (isProduction) {
      throw new Error(
        "Chưa cấu hình Storage. Bản mặc định ghi ra đĩa cục bộ, KHÔNG dùng được " +
          "trên production: chạy nhiều instance thì file lạc, và deploy lại là mất sạch. " +
          "Gọi setStorage() với một nhà cung cấp thật (S3/R2/Vietnix) lúc khởi động.",
      );
    }

    const key = buildStorageKey(originalName, options.folder);
    const target = join(LOCAL_DIR, key);

    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data);

    logger.warn("[storage:dev] Ghi file ra đĩa cục bộ — chỉ dùng cho môi trường dev", { key });

    return {
      key,
      url: localDiskStorage.url(key),
      size: data.byteLength,
      contentType: options.contentType,
    };
  },

  url(key) {
    return `/uploads/${key}`;
  },

  async delete(key) {
    // Chặn `../` một lần nữa ngay trước khi chạm hệ thống file. Khoá lẽ ra do
    // `buildStorageKey` sinh ra, nhưng nó cũng có thể đến từ database — và dữ
    // liệu cũ trong database thì không ai bảo đảm được.
    if (key.includes("..")) throw new Error("Khoá lưu trữ không hợp lệ");

    await unlink(join(LOCAL_DIR, key)).catch(() => {
      // Xoá file không tồn tại không phải lỗi: người gọi muốn nó biến mất, và
      // nó đã biến mất rồi.
    });
  },
};

let currentStorage: Storage | null = null;

/** Cắm nhà cung cấp tự viết. Gọi một lần lúc khởi động ứng dụng — thắng cấu hình `S3_*`. */
export function setStorage(storage: Storage): void {
  currentStorage = storage;
}

export function getStorage(): Storage {
  currentStorage ??= env.S3_BUCKET ? createS3StorageFromEnv(env.S3_BUCKET) : localDiskStorage;
  return currentStorage;
}

/**
 * Có `S3_BUCKET` mà thiếu khoá truy cập là cấu hình dở dang — ném lỗi rõ ràng ngay lần đầu dùng kho,
 * thay vì để S3 trả 403 "SignatureDoesNotMatch" khó đoán ra nguyên nhân.
 */
function createS3StorageFromEnv(bucket: string): Storage {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("Đã đặt S3_BUCKET nhưng thiếu S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.");
  }
  return createS3Storage({
    bucket,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    publicUrl: env.S3_PUBLIC_URL,
  });
}

// ---------------------------------------------------------------------------
// Kiểm tra file tải lên
// ---------------------------------------------------------------------------

export type UploadRule = {
  /** Kích thước tối đa, tính bằng byte. */
  maxBytes: number;
  /** Danh sách MIME type cho phép. Dùng danh sách TRẮNG, không phải danh sách đen. */
  allowedTypes: readonly string[];
};

export { FILE_KINDS, type FileKind };

/**
 * Bốn nhóm tệp, mỗi nhóm một luật. KHÔNG có cột "loại" trong database — nhóm suy ra từ `mimeType`
 * (`kindOf`), lưu thêm một cột là lưu một thông tin hai lần.
 *
 * Chỉ cho phép định dạng KIỂM ĐƯỢC NỘI DUNG (có chữ ký đầu tệp, xem `SIGNATURES`). TXT/CSV không có
 * chữ ký nên cố ý không nằm đây: cho phép là tin hoàn toàn vào Content-Type do client khai.
 */

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<FileKind, UploadRule> = {
  image: {
    maxBytes: 5 * MB,
    allowedTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
  document: {
    maxBytes: 20 * MB,
    allowedTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
    ],
  },
  audio: {
    maxBytes: 50 * MB,
    allowedTypes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/wav",
      "audio/x-wav",
      "audio/ogg",
      "audio/webm",
    ],
  },
  /**
   * Video đi đường tải TRỰC TIẾP lên kho (`POST /api/v1/files/uploads`), không qua máy chủ: đọc vài
   * trăm MB vào RAM của tiến trình Node là sập máy chủ nhỏ.
   */
  video: {
    // 4GB: đủ cho phim 1080p. Tải trực tiếp là MỘT lệnh PUT, mà S3 chặn PUT đơn ở 5GB.
    maxBytes: 4 * 1024 * MB,
    allowedTypes: ["video/mp4", "video/quicktime", "video/webm"],
  },
};

/** Bộ luật dựng sẵn cho ảnh — trường hợp phổ biến nhất. */
export const IMAGE_UPLOAD: UploadRule = UPLOAD_RULES.image;

/** Nhóm của một MIME type đã được phép; `null` nếu không thuộc nhóm nào. */
export function kindOf(mimeType: string): FileKind | null {
  return FILE_KINDS.find((kind) => UPLOAD_RULES[kind].allowedTypes.includes(mimeType)) ?? null;
}

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/**
 * Kiểm một tệp trước khi lưu: dung lượng, danh sách trắng định dạng, rồi CHỮ KÝ NỘI DUNG.
 *
 * ---
 * VÌ SAO KHÔNG TIN `file.type`
 *
 * `File.type` do TRÌNH DUYỆT khai báo, và trình duyệt lấy nó từ phần mở rộng
 * tên file. Đổi `virus.exe` thành `anh.png` là đủ để `type` thành `image/png`.
 *
 * Vì vậy hàm này đọc thêm **magic bytes** — vài byte đầu của file, do chính
 * định dạng quy định và không đổi được bằng cách đổi tên. Không phải lớp phòng
 * thủ tuyệt đối (nhồi dữ liệu độc sau phần header vẫn được), nhưng nó chặn
 * đứng trường hợp phổ biến nhất.
 *
 * ⚠️ Chốt chặn thật sự vẫn là: KHÔNG BAO GIỜ phục vụ file người dùng tải lên
 * từ cùng tên miền với ứng dụng, và luôn set `Content-Disposition: attachment`
 * cho những gì không phải ảnh.
 */
export function assertUploadAllowed(data: Buffer, declaredType: string, rule: UploadRule): void {
  assertTypeAndSize(declaredType, data.byteLength, rule);
  assertSignature(data, declaredType);
}

/** Phần kiểm KHÔNG cần nội dung — dùng lúc cấp URL tải trực tiếp, khi tệp chưa lên kho. */
export function assertTypeAndSize(declaredType: string, size: number, rule: UploadRule): void {
  if (size <= 0) {
    throw new UploadRejectedError("File rỗng");
  }
  if (size > rule.maxBytes) {
    const mb = (rule.maxBytes / MB).toFixed(1);
    throw new UploadRejectedError(`File vượt quá ${mb}MB`);
  }
  if (!rule.allowedTypes.includes(declaredType)) {
    throw new UploadRejectedError(`Định dạng ${declaredType} không được chấp nhận`);
  }
}

/**
 * Đối chiếu vài byte ĐẦU tệp với định dạng khai báo. Chỉ cần ~16 byte — nên kiểm được cả tệp đã nằm
 * trên kho bằng một lượt đọc Range nhỏ, không phải tải cả video về.
 *
 * Danh sách TRẮNG: định dạng không có trong `SIGNATURES` thì luôn bị từ chối.
 *
 * Bản đầu của hàm này viết `if (detected && detected !== declaredType)` — tức là chỉ đối chiếu KHI
 * nhận diện được. Nó để lọt đúng ca nguy hiểm nhất: file thực thi (header `MZ`) khai là `image/png`
 * cho `detected === null` và nhánh trên bỏ qua. `src/lib/storage.test.ts` đã bắt được lỗ này.
 */
export function assertSignature(head: Buffer, declaredType: string): void {
  if (declaredType.startsWith("image/")) {
    const detected = detectImageType(head);
    if (detected === null) {
      throw new UploadRejectedError("Nội dung file không phải ảnh hợp lệ");
    }
    if (detected !== declaredType) {
      throw new UploadRejectedError(
        `Nội dung file (${detected}) không khớp định dạng khai báo (${declaredType})`,
      );
    }
    return;
  }

  const matches = SIGNATURES[declaredType];
  if (!matches?.(head)) {
    throw new UploadRejectedError(`Nội dung file không khớp định dạng khai báo (${declaredType})`);
  }
}

const ascii = (data: Buffer, from: number, to: number) => data.toString("ascii", from, to);

const isZip = (d: Buffer) =>
  d.length >= 4 && d[0] === 0x50 && d[1] === 0x4b && d[2] === 0x03 && d[3] === 0x04;
/** Office đời cũ (.doc/.xls/.ppt) — định dạng OLE Compound File. */
const isOle = (d: Buffer) =>
  d.length >= 8 &&
  d.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
/** Họ ISO-BMFF (MP4, MOV, M4A): hộp `ftyp` ở byte 4-7. */
const isIsoBmff = (d: Buffer) => d.length >= 12 && ascii(d, 4, 8) === "ftyp";
/** Matroska/WebM: mã EBML 1A 45 DF A3. */
const isEbml = (d: Buffer) =>
  d.length >= 4 && d[0] === 0x1a && d[1] === 0x45 && d[2] === 0xdf && d[3] === 0xa3;
const isWav = (d: Buffer) =>
  d.length >= 12 && ascii(d, 0, 4) === "RIFF" && ascii(d, 8, 12) === "WAVE";
/** MP3: thẻ ID3 ở đầu, hoặc khung âm thanh bắt đầu bằng 11 bit 1 (frame sync). */
const isMp3 = (d: Buffer) =>
  d.length >= 3 && (ascii(d, 0, 3) === "ID3" || (d[0] === 0xff && ((d[1] ?? 0) & 0xe0) === 0xe0));

/**
 * Chữ ký cho mọi định dạng KHÔNG phải ảnh. DOCX/XLSX/PPTX đều là tệp zip nên chỉ phân biệt được "là
 * zip" — đủ để chặn file thực thi đổi tên, không đủ để chặn zip độc khai là docx. Vì vậy tệp không
 * phải ảnh phải được phục vụ kèm `Content-Disposition: attachment`.
 */
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  "application/pdf": (d) => ascii(d, 0, 5) === "%PDF-",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZip,
  "application/msword": isOle,
  "application/vnd.ms-excel": isOle,
  "application/vnd.ms-powerpoint": isOle,
  "audio/mpeg": isMp3,
  "audio/mp4": isIsoBmff,
  "audio/x-m4a": isIsoBmff,
  "audio/wav": isWav,
  "audio/x-wav": isWav,
  "audio/ogg": (d) => ascii(d, 0, 4) === "OggS",
  "audio/webm": isEbml,
  "video/mp4": isIsoBmff,
  "video/quicktime": isIsoBmff,
  "video/webm": isEbml,
};

/** Nhận diện ảnh qua magic bytes. Trả `null` nếu không phải định dạng đã biết. */
function detectImageType(data: Buffer): string | null {
  if (data.length < 12) return null;

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }

  // GIF: "GIF8"
  if (ascii(data, 0, 4) === "GIF8") return "image/gif";

  // WebP: "RIFF" ở byte 0-3 và "WEBP" ở byte 8-11
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") {
    return "image/webp";
  }

  return null;
}
