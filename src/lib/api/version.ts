/**
 * Phiên bản REST API, khai báo một lần.
 *
 * ---
 * CÁI NÀY GIẢI QUYẾT ĐƯỢC GÌ, VÀ KHÔNG GIẢI QUYẾT ĐƯỢC GÌ
 *
 * Trước file này, chuỗi `/api/v1` bị viết cứng ở 5 chỗ trong code — nút OAuth,
 * form đăng xuất, trang `/docs`, URL callback OAuth, và `servers` của đặc tả
 * OpenAPI. Chúng nằm rải rác ở cả `lib/`, `components/` lẫn `app/`, nên rất dễ
 * sửa sót một chỗ. Sót chỗ nào thì chỗ đó gọi vào version đã ngừng phục vụ và
 * hỏng lúc chạy, không phải lúc biên dịch.
 *
 * ⚠️ NHƯNG hằng số này KHÔNG tự chuyển được API sang v2. Thư mục
 * `src/app/api/v1/` mới là thứ quyết định đường dẫn thật — Next.js định tuyến
 * theo hệ thống file, và không có cách nào đặt tên thư mục bằng biến.
 *
 * ---
 * KHI NÀO THẬT SỰ LÊN V2, LÀM THẾ NÀO
 *
 * Điều quan trọng nhất: **v2 ra đời KHÔNG có nghĩa là v1 biến mất**. App đã lên
 * store không ép người dùng cập nhật ngay được, nên hai version phải chạy song
 * song một thời gian. Vì vậy quy trình đúng là THÊM, không phải ĐỔI TÊN:
 *
 *   1. Tạo `src/app/api/v2/` cho những endpoint CÓ thay đổi phá vỡ tương thích.
 *      Endpoint không đổi thì re-export lại handler của v1, đừng chép mã.
 *   2. Đổi `CURRENT_API_VERSION` ở dưới thành `"v2"` — web tự chuyển sang gọi
 *      v2, đúng một dòng.
 *   3. Giữ `src/app/api/v1/` nguyên vẹn cho tới khi số liệu cho thấy không còn
 *      client cũ nào gọi tới.
 *
 * Nói cách khác, hằng số này trả lời câu hỏi "giao diện web của chính hệ thống
 * đang gọi version nào" — và biến câu trả lời đó thành một dòng thay vì năm.
 */
export const CURRENT_API_VERSION = "v1";

/** Tiền tố chung của REST API, ví dụ `/api/v1`. */
export const API_PREFIX = `/api/${CURRENT_API_VERSION}` as const;

/**
 * Dựng đường dẫn tới một endpoint của REST API.
 *
 * @example apiPath("/auth/logout")  // "/api/v1/auth/logout"
 */
export function apiPath(path: `/${string}`): string {
  return `${API_PREFIX}${path}`;
}
