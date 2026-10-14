import { NextResponse, type NextRequest } from "next/server";
import { storageOriginsFromEnv } from "@/lib/storage-origin";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Proxy — tên mới của Middleware kể từ Next.js 16.
 *
 * Làm hai việc: dựng Content-Security-Policy có nonce, và chặn request chưa
 * đăng nhập ngay ở cửa ngõ.
 *
 * Lưu ý quan trọng: đây là lớp phòng thủ THỨ HAI, không phải lớp duy nhất.
 * Proxy không nhìn thấy logic nghiệp vụ, nên mọi Server Action và route
 * handler vẫn phải tự kiểm tra quyền. Xem `src/app/users/actions.ts`.
 */

/** Prefix yêu cầu đã đăng nhập. */
const PROTECTED_PREFIXES = ["/movies", "/watch", "/users", "/roles", "/sessions", "/security"];

/** Trang chỉ dành cho khách; đã đăng nhập rồi thì không cần vào nữa. */
const GUEST_ONLY_PATHS = ["/login", "/register"];

/**
 * Kho tệp S3 nằm ở tên miền khác: thiếu nó trong CSP thì ảnh/video tải lên hiện thành ô vỡ, và
 * trình duyệt chặn `PUT` thẳng lên bucket (tải video trực tiếp). Tính một lần lúc nạp module.
 */
const STORAGE_ORIGINS = storageOriginsFromEnv().join(" ");

function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const storage = STORAGE_ORIGINS ? ` ${STORAGE_ORIGINS}` : "";
  return [
    `default-src 'self'`,
    // 'strict-dynamic' cho phép script đã qua nonce tự nạp script con, đúng
    // với cách Next.js hydrate. Dev cần 'unsafe-eval' cho React Refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Không dùng nonce cho style: toàn bộ UI ở đây dùng thuộc tính style={{}}
    // của React, mà thuộc tính style thì nonce không áp được — chỉ
    // 'unsafe-inline' mới cho qua. Bỏ inline style đi thì siết lại được.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${storage}`,
    `media-src 'self' blob:${storage}`,
    `font-src 'self' data:`,
    `connect-src 'self'${storage}${isDev ? " ws: wss:" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname } = request.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce, isDev);

  const session = await verifySession(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const needsAuth = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsAuth && !session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session && GUEST_ONLY_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/users", request.url));
  }

  // Nonce phải đi vào REQUEST header thì Next.js mới đọc được và gắn vào các
  // thẻ <script> nó tự sinh; đặt mỗi ở response header là không đủ.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // Mã định danh request: tôn trọng giá trị reverse proxy đã gắn, chỉ sinh mới
  // khi chưa có. Nhờ vậy log của ứng dụng nối được với log của Caddy/nginx
  // thay vì mỗi tầng mang một mã riêng.
  //
  // Chỉ áp cho luồng TRANG — proxy cố tình không chạy trên /api, nên phía API
  // việc này do `handleApiError` lo (xem src/lib/request-id.ts).
  const requestId = getRequestId(request);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// Không khai báo `runtime` ở đây: từ Next.js 16, Proxy mặc định chạy trên
// Node.js runtime và việc set `runtime` sẽ khiến build lỗi.
export const config = {
  matcher: [
    /*
     * Bỏ qua:
     *   - asset tĩnh và mọi file có phần mở rộng
     *   - /api/** và /docs — CÓ CHỦ ĐÍCH.
     *
     * Proxy nói chuyện bằng redirect và HTML, còn client API (app Flutter)
     * cần JSON kèm đúng status code. Nếu để /api đi qua đây, một token hết
     * hạn sẽ trả về 307 dẫn tới trang login thay vì 401 — lỗi rất khó nhìn ra
     * từ phía mobile vì nó trông như request thành công.
     *
     * Đổi lại, MỌI route handler trong src/app/api phải tự kiểm quyền bằng
     * `requireApiUser()` / `requireApiAdmin()`. Header bảo mật không mất đi:
     * chúng được set ở next.config.mjs cho toàn bộ đường dẫn.
     */
    "/((?!api/|docs|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
