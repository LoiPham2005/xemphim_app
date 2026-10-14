import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  DomainError,
  RefreshTokenReuseError,
  TwoFactorRequiredError,
  type DomainErrorCode,
} from "@/lib/errors";

/**
 * Định dạng response thống nhất cho toàn bộ REST API.
 *
 * Thành công:  { "data": ... }
 * Thất bại:    { "error": { "code": "...", "message": "...", "fields"?: {...} } }
 *
 * `code` là thứ client Flutter nên switch-case, không phải `message`. Message
 * để hiển thị cho người dùng và có thể đổi lời văn bất cứ lúc nào; code là hợp
 * đồng giữa hai bên.
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "ACCOUNT_BANNED"
  | "ACCOUNT_LOCKED"
  | "TWO_FACTOR_REQUIRED"
  | "PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiErrors = {
  unauthenticated: (message = "Cần đăng nhập để truy cập") =>
    new ApiError(401, "UNAUTHENTICATED", message),

  // Trả 403 chứ không phải 404 như bên web. Trang web dùng 404 để giấu sự tồn
  // tại của tài nguyên khỏi trình duyệt; còn API thì client cần phân biệt
  // "chưa đăng nhập" với "đăng nhập rồi nhưng không đủ quyền" để xử lý khác nhau.
  forbidden: (message = "Bạn không có quyền thực hiện thao tác này") =>
    new ApiError(403, "FORBIDDEN", message),

  notFound: (message = "Không tìm thấy tài nguyên") => new ApiError(404, "NOT_FOUND", message),

  conflict: (message: string) => new ApiError(409, "CONFLICT", message),

  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "RATE_LIMITED", `Quá nhiều yêu cầu. Thử lại sau ${retryAfterSeconds} giây.`),

  accountBanned: (message: string) => new ApiError(403, "ACCOUNT_BANNED", message),

  // 423 (Locked) chứ không phải 401/429: đây không phải sai thông tin đăng
  // nhập (401) hay dồn dập request (429) — mật khẩu ĐÚNG nhưng tài khoản đang
  // tạm khoá do trước đó sai quá nhiều lần.
  accountLocked: (message: string) => new ApiError(423, "ACCOUNT_LOCKED", message),

  validation: (fields: Record<string, string[]>) =>
    new ApiError(422, "VALIDATION_ERROR", "Dữ liệu gửi lên không hợp lệ", fields),
};

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/** Alias ngắn gọn của apiSuccess */
export const apiOk = apiSuccess;

/** Parse JSON body theo Zod schema; ném ApiError 422 nếu sai. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Body phải là JSON hợp lệ");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error).fieldErrors;
    throw apiErrors.validation(flattened as Record<string, string[]>);
  }

  return parsed.data;
}

/**
 * Đổi exception thành response JSON.
 *
 * Lỗi nghiệp vụ đã có kiểu rõ ràng ở tầng service được ánh xạ sang status
 * tương ứng; mọi thứ còn lại thành 500 và KHÔNG lộ nội dung lỗi ra ngoài —
 * thông điệp gốc chỉ đi vào log.
 */
/**
 * @param context Ngữ cảnh đưa vào log. Truyền kèm `request` để lấy được mã
 * định danh request — đó là thứ nối dòng log này với các dòng khác của cùng
 * một request, và với log của reverse proxy phía trước.
 */
export function handleApiError(
  error: unknown,
  context?: Record<string, unknown> & { request?: Request },
): NextResponse {
  // Tách `request` ra khỏi phần ghi log: một đối tượng Request đưa thẳng vào
  // JSON.stringify sẽ thành `{}`, mà nó lại mang cả header Authorization.
  const { request, ...logContext } = context ?? {};
  const requestId = request ? getRequestId(request) : undefined;

  return buildErrorResponse(error, requestId, logContext);
}

function buildErrorResponse(
  error: unknown,
  requestId: string | undefined,
  context: Record<string, unknown>,
): NextResponse {
  const response = buildErrorBody(error, context);

  // Trả mã về cho client: người dùng báo lỗi kèm mã này là tìm ra đúng dòng
  // log, thay vì phải mò theo thời điểm và địa chỉ IP.
  if (requestId) response.headers.set(REQUEST_ID_HEADER, requestId);

  return response;
}

/**
 * Lỗi nghiệp vụ → mã HTTP. Bảng này là TOÀN BỘ phần "dịch" giữa hai tầng.
 *
 * Trước đây chỗ này là một cây `if (error instanceof X)` dài, mỗi lớp lỗi một
 * nhánh, và thêm một lỗi mới nghĩa là sửa hai file. Nay mọi lỗi nghiệp vụ đều
 * kế thừa `DomainError` và tự mang `code`, nên bảng dưới đây đủ cho tất cả —
 * kể cả lỗi thêm sau này.
 */
const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACCOUNT_BANNED: 403,
  // 423 Locked: mật khẩu ĐÚNG, nhưng tài khoản đang tạm khoá — khác hẳn 401.
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  // 502: lỗi ở nhà cung cấp bên ngoài, không phải ở request của client.
  PROVIDER_ERROR: 502,
  // 401 nhưng `code` RIÊNG: client phải phân biệt "sai mật khẩu" với "mật khẩu
  // đúng, cần nhập mã 2FA" — hai màn hình khác nhau.
  TWO_FACTOR_REQUIRED: 401,
};

function buildErrorBody(error: unknown, context?: Record<string, unknown>): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof DomainError) {
    // Token đã thu hồi được dùng lại là dấu hiệu tấn công, không phải lỗi
    // thường — phải nhìn thấy được trong log dù response chỉ là 401 khô khan.
    if (error instanceof RefreshTokenReuseError) {
      logger.warn("Phát hiện refresh token bị dùng lại — đã huỷ họ phiên đó", {
        userId: error.userId,
      });
    }

    if (error instanceof TwoFactorRequiredError) {
      logger.info("Đăng nhập cần bước 2FA", { userId: error.userId });
    }

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      { status: DOMAIN_STATUS[error.code] },
    );
  }

  logger.error("Unhandled API error", error, context);

  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Lỗi máy chủ. Vui lòng thử lại." } },
    { status: 500 },
  );
}
