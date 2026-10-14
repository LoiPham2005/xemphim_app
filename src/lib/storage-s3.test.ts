import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createS3Storage, type S3Config } from "./storage-s3";

const BASE: S3Config = {
  bucket: "my-bucket",
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  endpoint: "https://s3.vn-hcm-1.vietnix.cloud",
  region: "vn-hcm-1",
  forcePathStyle: false,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Request mà aws4fetch đã ký rồi chuyển cho `fetch`. */
function sentRequest(): Request {
  return fetchMock.mock.calls[0]?.[0] as Request;
}

describe("createS3Storage", () => {
  it("PUT kiểu virtual-hosted (AWS/R2/Vietnix): bucket nằm ở tên miền con, request được ký", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const storage = createS3Storage(BASE);

    const stored = await storage.put(Buffer.from("abc"), "anh.png", {
      contentType: "image/png",
      folder: "avatars",
    });

    const req = sentRequest();
    expect(req.method).toBe("PUT");
    expect(req.url).toMatch(
      /^https:\/\/my-bucket\.s3\.vn-hcm-1\.vietnix\.cloud\/avatars\/.+\.png$/,
    );
    expect(req.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(stored).toMatchObject({ size: 3, contentType: "image/png" });
    expect(stored.key).toMatch(/^avatars\//);
    expect(stored.url).toBe(req.url);
  });

  it("path-style (MinIO): bucket nằm trong đường dẫn", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const storage = createS3Storage({
      ...BASE,
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });

    await storage.put(Buffer.from("x"), "a.jpg", { contentType: "image/jpeg" });

    expect(sentRequest().url).toMatch(/^http:\/\/localhost:9000\/my-bucket\/.+\.jpg$/);
  });

  it("không khai endpoint thì trỏ về AWS theo region", () => {
    const storage = createS3Storage({ ...BASE, endpoint: undefined, region: "ap-southeast-1" });
    expect(storage.url("a/b.png")).toBe(
      "https://my-bucket.s3.ap-southeast-1.amazonaws.com/a/b.png",
    );
  });

  it("có S3_PUBLIC_URL (CDN) thì URL công khai dùng tên miền CDN", () => {
    const storage = createS3Storage({ ...BASE, publicUrl: "https://cdn.example.vn/" });
    expect(storage.url("avatars/x y.png")).toBe("https://cdn.example.vn/avatars/x%20y.png");
  });

  it("PUT hỏng thì ném lỗi kèm mã HTTP, không trả về như đã lưu", async () => {
    fetchMock.mockResolvedValue(new Response("AccessDenied", { status: 403 }));
    const storage = createS3Storage(BASE);

    await expect(
      storage.put(Buffer.from("x"), "a.png", { contentType: "image/png" }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("DELETE: 404 coi như đã xoá, lỗi khác thì ném", async () => {
    const storage = createS3Storage(BASE);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(storage.delete("a.png")).resolves.toBeUndefined();

    // 5xx được thử lại tối đa 2 lần rồi mới bỏ cuộc — không treo cả phút như mặc định của aws4fetch.
    fetchMock.mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 })));
    await expect(storage.delete("a.png")).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3); // 1 lần 404 ở trên + (1 + 2 lần thử lại)
  });

  it("signedUrl: chữ ký nằm trên query, có thời hạn — không gọi mạng", async () => {
    const storage = createS3Storage(BASE);

    const url = new URL((await storage.signedUrl?.("private/a.pdf", 300)) ?? "");

    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presignPut: chữ ký trên query, Content-Type nằm trong chữ ký — client đổi loại là bị từ chối", async () => {
    const storage = createS3Storage(BASE);

    const signed = await storage.presignPut?.("videos/a.mp4", "video/mp4", 1800);
    const url = new URL(signed?.url ?? "");

    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(signed?.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("head: 404 = chưa có tệp, có thì trả dung lượng thật", async () => {
    const storage = createS3Storage(BASE);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(storage.head?.("a.mp4")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { "Content-Length": "4321" } }),
    );
    await expect(storage.head?.("a.mp4")).resolves.toEqual({ size: 4321 });
  });

  it("readHead: chỉ xin đúng N byte đầu bằng Range — không tải cả video", async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from("ftyp"), { status: 206 }));
    const storage = createS3Storage(BASE);

    const head = await storage.readHead?.("a.mp4", 64);

    expect(sentRequest().headers.get("range")).toBe("bytes=0-63");
    expect(head?.toString()).toBe("ftyp");
  });
});
