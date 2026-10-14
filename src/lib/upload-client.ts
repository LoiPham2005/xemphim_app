import { API_PREFIX } from "@/lib/api/version";

/**
 * Tải MỘT tệp lên kho từ trình duyệt qua REST `/api/v1/files*` (cookie phiên) — CÙNG luật với app
 * mobile, dùng chung cho thư viện tệp và trang đăng phim:
 *   - ảnh/tài liệu/âm thanh: multipart qua máy chủ (kiểm trọn nội dung).
 *   - video: xin URL ký sẵn -> PUT thẳng lên kho -> báo xong để máy chủ kiểm trên kho.
 *
 * Chỉ chạy phía trình duyệt (XHR). Trả `id` để gắn tệp vào bản ghi nghiệp vụ.
 */

type ApiEnvelope<T> = { data?: T; error?: { message?: string; fields?: Record<string, string[]> } };

export type UploadOptions = {
  folder?: string;
  /** Giữ trong thư viện, không bị dọn sau 24 giờ. Máy chủ chỉ nhận khi có `file:manage`. */
  retain?: boolean;
  onProgress?: (ratio: number) => void;
};

export async function uploadFile(file: File, options: UploadOptions = {}): Promise<{ id: string }> {
  const onProgress = options.onProgress ?? (() => {});

  // Video phải tải thẳng lên kho; máy chủ tự suy nhóm từ Content-Type, client không gửi `kind`.
  if (file.type.startsWith("video/")) {
    const { file: pending, upload } = await postJson<{
      file: { id: string };
      upload: { url: string; method: string; headers: Record<string, string> };
    }>(`${API_PREFIX}/files/uploads`, {
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      folder: options.folder,
      retain: options.retain,
    });

    const put = await send(upload.method, upload.url, file, upload.headers, onProgress);
    if (put.status < 200 || put.status >= 300) {
      throw new Error(`Kho từ chối tệp (HTTP ${put.status}) — kiểm cấu hình CORS của bucket`);
    }
    const done = await postJson<{ file: { id: string } }>(
      `${API_PREFIX}/files/${pending.id}/complete`,
    );
    return done.file;
  }

  const form = new FormData();
  form.append("file", file);
  if (options.folder) form.append("folder", options.folder);
  if (options.retain) form.append("retain", "true");
  const res = await send("POST", `${API_PREFIX}/files`, form, {}, onProgress);
  if (res.status !== 201) throw new Error(readError(res.text, `Lỗi HTTP ${res.status}`));
  const parsed = JSON.parse(res.text) as ApiEnvelope<{ file: { id: string } }>;
  if (!parsed.data) throw new Error("Máy chủ không trả về tệp");
  return parsed.data.file;
}

/**
 * Gửi request có theo dõi tiến độ. Dùng XHR vì `fetch` chưa báo tiến độ TẢI LÊN — với video vài GB,
 * thanh tiến độ là thứ duy nhất cho người dùng biết trang chưa treo.
 */
function send(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress: (ratio: number) => void,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải lên"));
    xhr.send(body);
  });
}

function readError(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as ApiEnvelope<unknown>;
    return parsed.error?.fields?.file?.[0] ?? parsed.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || !parsed.data) {
    throw new Error(
      parsed.error?.fields?.file?.[0] ?? parsed.error?.message ?? `Lỗi HTTP ${res.status}`,
    );
  }
  return parsed.data;
}
