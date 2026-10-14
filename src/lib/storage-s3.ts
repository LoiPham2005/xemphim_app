import "server-only";
import { AwsClient } from "aws4fetch";
import { buildStorageKey, type Storage } from "./storage";
import { bucketBaseUrl } from "./storage-origin";

/**
 * Kho tệp S3 — chạy được với mọi dịch vụ nói giao thức S3: AWS, Cloudflare R2, MinIO, Vietnix,
 * Bizfly... Bật tự động khi có `S3_BUCKET` (xem `getStorage()`).
 *
 * ---
 * VÌ SAO `aws4fetch` CHỨ KHÔNG PHẢI `@aws-sdk/client-s3`
 *
 * Ta chỉ cần ba thao tác (PUT, DELETE, URL ký sẵn). SDK chính thức kéo theo hàng chục package và vài
 * MB cho đúng ba lệnh đó; `aws4fetch` chỉ làm một việc — ký request theo AWS Signature V4 — rồi để
 * `fetch` lo phần còn lại. Cùng tinh thần với OAuth tự viết bằng `fetch` (GOTCHAS #5).
 *
 * ---
 * HAI KIỂU ĐỊA CHỈ BUCKET
 *
 * - virtual-hosted (mặc định — AWS, R2, Vietnix): `https://<bucket>.<endpoint>/<key>`
 * - path-style (`S3_FORCE_PATH_STYLE=1` — MinIO, vài nhà cung cấp cũ): `https://<endpoint>/<bucket>/<key>`
 *
 * Sai kiểu thì nhà cung cấp trả 403/404 khó hiểu (SignatureDoesNotMatch, NoSuchBucket) — đó là chỗ
 * đầu tiên cần nghi khi kết nối hỏng.
 *
 * ---
 * TỆP PHẢI ĐỌC ĐƯỢC CÔNG KHAI
 *
 * `url()` trả đường dẫn thẳng tới object, nên bucket phải cho đọc công khai (bucket policy
 * `s3:GetObject` cho `*`), hoặc đặt CDN phía trước và khai `S3_PUBLIC_URL`. Khoá tệp sinh ngẫu nhiên
 * (`buildStorageKey`) nên không đoán được, nhưng KHÔNG cho phép liệt kê bucket (`s3:ListBucket`).
 * Tệp riêng tư thật sự thì dùng `signedUrl()` (URL hết hạn sau vài phút).
 */
export type S3Config = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Bỏ trống = AWS (`https://s3.<region>.amazonaws.com`). */
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  /** Tên miền CDN đặt trước bucket. Bỏ trống = trỏ thẳng vào bucket. */
  publicUrl?: string;
};

/** Mỗi đoạn của khoá được mã hoá riêng — giữ nguyên dấu `/` phân cấp thư mục. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function createS3Storage(config: S3Config): Storage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
    // Mặc định aws4fetch thử lại 10 lần khi gặp 5xx, mỗi lần chờ gấp đôi — kho sập thì request
    // upload treo gần một phút. 2 lần (~150ms) đủ vượt lỗi chập chờn mà vẫn hỏng nhanh khi kho chết.
    retries: 2,
  });

  const base = bucketBaseUrl(config);
  const objectUrl = (key: string): string => `${base}/${encodeKey(key)}`;

  const publicBase = config.publicUrl?.replace(/\/+$/, "");

  const storage: Storage = {
    async put(data, originalName, options) {
      const key = buildStorageKey(originalName, options.folder);

      const res = await client.fetch(objectUrl(key), {
        method: "PUT",
        body: new Uint8Array(data),
        headers: {
          "Content-Type": options.contentType,
          // Khoá không bao giờ dùng lại cho nội dung khác -> cache vĩnh viễn được, CDN khỏi hỏi lại.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
      if (!res.ok) {
        throw new Error(`S3 PUT ${key} thất bại: HTTP ${res.status} ${await res.text()}`);
      }

      return {
        key,
        url: storage.url(key),
        size: data.byteLength,
        contentType: options.contentType,
      };
    },

    async delete(key) {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      // 404: tệp đã không còn — người gọi muốn nó biến mất, và nó đã biến mất.
      if (!res.ok && res.status !== 404) {
        throw new Error(`S3 DELETE ${key} thất bại: HTTP ${res.status} ${await res.text()}`);
      }
    },

    url(key) {
      return publicBase ? `${publicBase}/${encodeKey(key)}` : objectUrl(key);
    },

    async signedUrl(key, expiresInSeconds) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },

    /*
     * Content-Type nằm TRONG chữ ký: client đổi sang loại khác lúc PUT thì kho từ chối
     * (SignatureDoesNotMatch). Dung lượng thì URL ký sẵn KHÔNG giới hạn được — `fileService` kiểm lại
     * bằng `head()` sau khi client báo xong, quá cỡ là xoá.
     *
     * Trình duyệt PUT thẳng lên bucket nên bucket phải bật CORS cho tên miền của app (xem
     * `.env.example`).
     */
    async presignPut(key, contentType, expiresInSeconds) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      const headers = { "Content-Type": contentType };
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers,
        // aws4fetch mặc định KHÔNG ký Content-Type (nằm trong danh sách "unsignable") — thiếu cờ này
        // thì client xin URL cho video nhưng PUT loại khác lên vẫn lọt.
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers };
    },

    async head(key) {
      const res = await client.fetch(objectUrl(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 HEAD ${key} thất bại: HTTP ${res.status}`);
      return { size: Number(res.headers.get("content-length") ?? 0) };
    },

    async readHead(key, bytes) {
      const res = await client.fetch(objectUrl(key), {
        method: "GET",
        headers: { Range: `bytes=0-${bytes - 1}` },
      });
      if (!res.ok) throw new Error(`S3 GET ${key} thất bại: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };

  return storage;
}
