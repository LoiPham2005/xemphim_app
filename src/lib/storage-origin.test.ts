import { describe, expect, it } from "vitest";
import { bucketBaseUrl, storageOriginsFromEnv } from "./storage-origin";

describe("bucketBaseUrl", () => {
  it("virtual-hosted: bucket là tên miền con của endpoint", () => {
    expect(
      bucketBaseUrl({
        bucket: "b",
        endpoint: "https://s3.vn-hcm-1.vietnix.cloud",
        region: "vn-hcm-1",
        forcePathStyle: false,
      }),
    ).toBe("https://b.s3.vn-hcm-1.vietnix.cloud");
  });

  it("path-style (MinIO): bucket nằm trong đường dẫn", () => {
    expect(
      bucketBaseUrl({
        bucket: "b",
        endpoint: "http://localhost:9000",
        region: "auto",
        forcePathStyle: true,
      }),
    ).toBe("http://localhost:9000/b");
  });
});

describe("storageOriginsFromEnv — origin mở trong CSP", () => {
  it("không có S3_BUCKET (đĩa cục bộ) thì không mở thêm gì", () => {
    expect(storageOriginsFromEnv({})).toEqual([]);
  });

  it("mở bucket + CDN, chỉ lấy ORIGIN (CSP không nhận đường dẫn kiểu path-style)", () => {
    expect(
      storageOriginsFromEnv({
        S3_BUCKET: "b",
        S3_ENDPOINT: "http://localhost:9000",
        S3_FORCE_PATH_STYLE: "1",
        S3_PUBLIC_URL: "https://cdn.example.vn/media",
      }),
    ).toEqual(["http://localhost:9000", "https://cdn.example.vn"]);
  });

  it("URL cấu hình hỏng thì bỏ qua thay vì làm sập mọi request qua proxy", () => {
    expect(storageOriginsFromEnv({ S3_BUCKET: "b", S3_ENDPOINT: "không-phải-url" })).toEqual([]);
  });
});
