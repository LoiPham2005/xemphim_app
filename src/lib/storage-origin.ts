/**
 * Địa chỉ gốc của bucket S3 — hàm THUẦN, không đọc env, không `server-only`, để dùng chung cho:
 *   - `storage-s3.ts`: dựng URL từng object.
 *   - `src/proxy.ts`: mở CSP cho trình duyệt hiện ảnh/video từ bucket và `PUT` thẳng lên bucket.
 *
 * Hai nơi dựng địa chỉ bằng hai đoạn code riêng là có ngày lệch nhau — và CSP lệch thì ảnh vỡ mà
 * không có lỗi nào ngoài console trình duyệt.
 */
export type BucketAddress = {
  bucket: string;
  /** Bỏ trống = AWS (`https://s3.<region>.amazonaws.com`). */
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
};

/** `https://<bucket>.<endpoint>` (virtual-hosted) hoặc `https://<endpoint>/<bucket>` (path-style). */
export function bucketBaseUrl(address: BucketAddress): string {
  const endpoint = new URL(address.endpoint || `https://s3.${address.region}.amazonaws.com`);
  return address.forcePathStyle
    ? `${endpoint.origin}/${address.bucket}`
    : `${endpoint.protocol}//${address.bucket}.${endpoint.host}`;
}

/**
 * Các origin mà trình duyệt cần tới khi kho là S3: bucket (xem + PUT) và CDN (`S3_PUBLIC_URL`) nếu có.
 * Đọc thẳng `process.env` vì proxy chạy trước khi app nạp `env.ts`. Không có `S3_BUCKET` = tệp nằm
 * cùng tên miền (đĩa cục bộ ở dev) -> không cần mở thêm gì.
 */
export function storageOriginsFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (!env.S3_BUCKET) return [];

  const origins = new Set<string>();
  try {
    const base = bucketBaseUrl({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || "auto",
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
    });
    origins.add(new URL(base).origin);
    if (env.S3_PUBLIC_URL) origins.add(new URL(env.S3_PUBLIC_URL).origin);
  } catch {
    // URL cấu hình sai: `env.ts` sẽ báo lỗi rõ ràng lúc app khởi động — proxy không chặn request vì nó.
  }
  return [...origins];
}
