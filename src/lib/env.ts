import { z } from "zod";
import { ProviderNotConfiguredError } from "./errors";
import { featureFlag } from "./feature-flag";

/**
 * Biến môi trường, validate MỘT LẦN lúc load module.
 *
 * Không có lớp này thì `DATABASE_URL` gõ sai chỉ lộ ra ở request đầu tiên chạm
 * database — thường là trên production, vài phút sau khi deploy. Ở đây nó chết
 * ngay lúc khởi động, kèm thông báo chỉ rõ biến nào sai.
 *
 * Trong `next build` không có secret thật, nên đặt `SKIP_ENV_VALIDATION=1` cho
 * bước đó (xem Dockerfile).
 */

/**
 * Coi chuỗi RỖNG như "không khai báo".
 *
 * `.optional()` và `.default()` của Zod chỉ nhảy vào khi giá trị là
 * `undefined`, nhưng có ba đường rất phổ biến đưa chuỗi rỗng vào thay vì
 * `undefined`: dòng `MAIL_FROM=` bỏ trống trong `.env`, `ENV` trong Dockerfile
 * không được truyền giá trị, và `${BIEN:-}` trong docker-compose.
 *
 * Không có lớp này thì app chết lúc khởi động kèm thông báo gây hiểu lầm cho
 * một biến vốn là tuỳ chọn — và chỉ chết trên Docker/CI chứ không chết trên
 * máy dev, nên rất tốn thời gian truy.
 */
function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Kết nối trực tiếp, bỏ qua pooler. Chỉ cần khi dùng PgBouncer/Neon/Supabase. */
  DIRECT_DATABASE_URL: optionalString(z.string().min(1).optional()),

  /**
   * Khoá ký cookie phiên trên web (JWT HS256).
   *
   * Tách khỏi `ENCRYPTION_KEY`: khoá này KÝ (một chiều, xoay được bất cứ lúc
   * nào — chỉ tốn việc mọi người phải đăng nhập lại), còn `ENCRYPTION_KEY`
   * MÃ HOÁ (xoay là hỏng vĩnh viễn mọi bí mật 2FA đã lưu). Dùng chung một khoá
   * cho hai việc có hậu quả khác nhau như vậy là tự đặt bẫy.
   */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET phải dài tối thiểu 32 ký tự (dùng: openssl rand -base64 48)"),

  /** Hạn của cookie phiên trên web. */
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().max(365).default(7),

  /**
   * Máy chủ WebSocket (`realtime/`).
   *
   * App Next.js KHÔNG tự gọi sang realtime, nên biến này không đổi hành vi của
   * request nào. Nó tồn tại để `docker-compose.yml` và `ecosystem.config.cjs`
   * biết có dựng tiến trình đó không, và để `/api/health` phân biệt được "chưa
   * bật bao giờ" với "đã bật mà chết".
   */
  REALTIME_ENABLED: featureFlag(true),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL là bắt buộc")
    .refine(
      (value) =>
        value.startsWith("postgresql://") ||
        value.startsWith("postgres://") ||
        value.startsWith("prisma+postgres://"),
      "DATABASE_URL phải là chuỗi kết nối PostgreSQL (postgresql://, postgres://, prisma+postgres://...)",
    ),

  /**
   * URL công khai của ứng dụng — dùng dựng link trong email và redirect_uri
   * của OAuth.
   *
   * Không có giá trị mặc định `localhost`: một email đặt lại mật khẩu chứa
   * link localhost là email vô dụng, mà người dùng thì đã nhận rồi.
   */
  APP_URL: optionalString(z.string().url("APP_URL phải là URL tuyệt đối").optional()),

  /**
   * URL công khai của chính API. Dùng dựng `redirect_uri` cho OAuth.
   *
   * Bỏ trống thì lấy theo `APP_URL` — đúng khi web và API nằm sau CÙNG một tên
   * miền (reverse proxy chuyển tiếp `/api/*` sang API).
   *
   * ⚠️ BẮT BUỘC phải đặt khi API ở tên miền RIÊNG (`api.example.com` trong
   * `Caddyfile` mẫu). Không đặt thì `redirect_uri` trỏ vào tên miền web, nơi
   * không có route callback nào — và lỗi đó chỉ lộ ra khi có người bấm nút
   * "Đăng nhập bằng Google" thật.
   */
  API_PUBLIC_URL: optionalString(z.string().url("API_PUBLIC_URL phải là URL tuyệt đối").optional()),

  /**
   * Tên sản phẩm, hiển thị trong app xác thực (Google Authenticator…) và làm
   * `issuer` của URI TOTP.
   */
  APP_NAME: z.string().default("Xem Phim"),

  /**
   * Khoá mã hoá bí mật lưu trong database (hiện dùng cho khoá TOTP).
   *
   * Sinh bằng: openssl rand -base64 32
   *
   * Bỏ trống thì 2FA không bật được (báo lỗi rõ ràng), phần còn lại của hệ
   * thống chạy bình thường.
   *
   * ⚠️ ĐỔI GIÁ TRỊ NÀY SAU KHI ĐÃ CÓ DỮ LIỆU = làm hỏng mọi bí mật đã mã hoá.
   * Người dùng phải cài lại 2FA từ đầu. Đặt một lần rồi giữ nguyên, và sao lưu
   * cùng chỗ với các secret khác.
   */
  ENCRYPTION_KEY: optionalString(z.string().min(16).optional()),

  // --- Passkey / WebAuthn ---------------------------------------------------

  /**
   * "Relying Party ID" — TÊN MIỀN mà passkey gắn vào.
   *
   * Bỏ trống = lấy hostname của `APP_URL`. Đúng cho phần lớn dự án.
   *
   * ⚠️ Đây là thứ tạo ra khả năng chống phishing, nên nó rất khắt khe:
   *
   *   • Passkey đăng ký ở `app.example.com` KHÔNG dùng được ở `example.com`
   *     nếu RP ID là `app.example.com`.
   *   • Đặt RP ID là `example.com` thì passkey dùng được ở MỌI tên miền con —
   *     tiện, nhưng cũng có nghĩa là một tên miền con bị chiếm sẽ xin được chữ
   *     ký. Chỉ làm vậy khi bạn kiểm soát toàn bộ tên miền con.
   *   • ĐỔI giá trị này sau khi đã có người đăng ký = mọi passkey cũ chết.
   */
  WEBAUTHN_RP_ID: optionalString(z.string().min(1).optional()),

  /**
   * Danh sách origin được chấp nhận, phân tách bằng dấu phẩy.
   *
   * Bỏ trống = lấy origin của `APP_URL`. Cần khai thêm khi app mobile cũng
   * dùng passkey — Android gửi origin dạng `android:apk-key-hash:...`, iOS gửi
   * `https://<domain>` theo Associated Domains.
   */
  WEBAUTHN_ORIGINS: optionalString(z.string().min(1).optional()),

  // --- Hạn của các loại token --------------------------------------------

  /**
   * Hạn access token. Ngắn có chủ đích: JWT đã ký thì KHÔNG thu hồi được, nên
   * thứ giới hạn thiệt hại khi lộ token chính là hạn của nó. Việc giữ đăng
   * nhập lâu dài do refresh token đảm nhiệm.
   */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
  /** Hạn refresh token. Thu hồi được vì nó nằm trong database. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  /**
   * Hạn link xác thực email. Dài hơn hẳn link đặt lại mật khẩu vì mức thiệt
   * hại khác nhau: link xác thực bị lộ chỉ giúp kẻ khác xác nhận hộ một địa
   * chỉ, còn link đặt lại mật khẩu bị lộ là mất tài khoản.
   */
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().max(168).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(60),
  /** Hạn mã OTP gửi qua SMS. Rất ngắn — OTP chỉ có 6 chữ số. */
  PHONE_OTP_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(5),

  // --- Xác thực số điện thoại (SMS) ---------------------------------------
  //
  // ⚠️ KHÁC EMAIL Ở MỘT ĐIỂM QUYẾT ĐỊNH: MỖI TIN NHẮN TỐN TIỀN THẬT.
  //
  // Vì vậy luồng này mặc định TẮT, và khi bật thì có ba lớp chặn lạm dụng —
  // rate limit theo IP, giãn cách giữa hai lần gửi, và trần theo NGÀY trên
  // từng số điện thoại. Thiếu lớp thứ ba là mở cửa cho "SMS bombing": kẻ tấn
  // công xoay IP, nhắm vào một số, và bạn trả hoá đơn.

  /**
   * Bật luồng xác thực số điện thoại. `0` = endpoint trả lỗi "chưa bật".
   *
   * Mặc định TẮT vì nó là tính năng duy nhất trong bộ khung có chi phí trực
   * tiếp trên mỗi lần dùng.
   */
  PHONE_VERIFICATION_ENABLED: featureFlag(false),

  /**
   * Số SMS tối đa gửi tới MỘT số điện thoại trong 24 giờ.
   *
   * Đây là lớp chặn quan trọng nhất về mặt chi phí: rate limit theo IP không
   * cản được kẻ xoay vòng IP, mà thuê một dải IP dân cư rẻ hơn nhiều so với
   * hoá đơn SMS họ tạo ra cho bạn.
   */
  PHONE_OTP_MAX_PER_DAY: z.coerce.number().int().positive().max(50).default(5),

  /** Giãn cách tối thiểu giữa hai lần gửi tới cùng một số. */
  PHONE_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().max(3600).default(60),

  /**
   * Số lần nhập SAI tối đa cho một mã dùng-một-lần (OTP, mã khôi phục 2FA),
   * tính trên chính mã đó.
   *
   * Đây là chốt chặn ĐỘC LẬP với rate limit theo IP: rate limit chặn một IP dò
   * nhiều tài khoản, còn ngưỡng này chặn việc dò một mã 6 chữ số bằng nhiều IP.
   * Chạm ngưỡng thì mã bị huỷ, buộc phải xin mã mới.
   */
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),

  // --- Chính sách lưu trữ (job dọn dẹp hằng ngày chạy theo) ---------------

  /**
   * Giữ nhật ký kiểm toán bao nhiêu ngày.
   *
   * Bảng này CHỈ TĂNG. Không dọn thì sau vài năm nó lớn tới mức không ai tra
   * nổi — tức là mất luôn tác dụng. 365 ngày là mức thường gặp; hãy đối chiếu
   * với quy định áp dụng cho ngành của bạn trước khi hạ xuống.
   */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(365),

  /**
   * Thu hồi TỨC THÌ mọi access token cũ khi mật khẩu đổi.
   *
   * JWT đã ký thì không thu hồi được — đó là lý do hạn của nó ngắn (15 phút).
   * Nhưng 15 phút vẫn là 15 phút mà kẻ đã chiếm tài khoản còn thao tác được
   * SAU KHI chủ thật đã đổi mật khẩu. Bật cờ này thì `JwtAuthGuard` đối chiếu
   * `iat` của token với `passwordChangedAt`, và cửa sổ đó biến mất.
   *
   * Cái giá: một lần đọc CACHE ở mỗi request đã xác thực (RAM nếu chưa có
   * Redis). Tắt đi nếu bạn đo được nó thành nút thắt — nhưng hãy đo trước.
   */
  SESSION_STRICT_REVOCATION: featureFlag(true),

  /**
   * Xoá thiết bị không hoạt động quá bao nhiêu ngày.
   *
   * FCM từ chối token quá cũ, và giữ chúng lại chỉ làm chậm MỌI lần gửi push —
   * Firebase còn coi việc gửi tới token chết là tín hiệu xấu và hạ uy tín gửi.
   */
  DEVICE_STALE_DAYS: z.coerce.number().int().positive().max(3650).default(180),

  /**
   * Hạn của "vé" 2FA — token trung gian cấp sau khi mật khẩu đúng nhưng chưa
   * nhập mã xác thực.
   *
   * Ngắn có chủ đích: nó chứng minh "vừa nhập đúng mật khẩu", nên để lâu là
   * kéo dài cửa sổ mà một máy bị chiếm có thể hoàn tất đăng nhập.
   */
  TWO_FACTOR_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().max(30).default(5),

  // --- Chống brute-force theo TÀI KHOẢN ------------------------------------
  // Bổ sung cho rate-limit theo IP: rate-limit chặn một IP dò nhiều tài khoản,
  // cặp giá trị này chặn nhiều IP cùng dò một tài khoản.
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().max(1440).default(15),

  // --- Redis: cache, rate limit, hàng đợi ----------------------------------

  /**
   * Bỏ trống = cache và rate limit chạy trong RAM của từng tiến trình. Đủ cho
   * MỘT instance; từ instance thứ hai trở đi mỗi bản đếm riêng, nên ngưỡng
   * thực tế bị nhân lên theo số instance — và mỗi lần deploy là bộ đếm về 0.
   */
  REDIS_URL: optionalString(z.string().min(1).optional()),

  /**
   * Hàng đợi job nền (BullMQ + apps/worker).
   *
   * `0` = `enqueue()` chạy handler NGAY trong request. Việc vẫn xong đủ, chỉ
   * đổi CHỖ chạy — đổi lại là không cần Redis, không cần dựng worker.
   *
   * ⚠️ Cái mất khi tắt: THỬ LẠI TỰ ĐỘNG. Đang bật hàng đợi, một lần SMTP nghẽn
   * chỉ làm job lùi vài giây rồi chạy lại. Tắt đi thì lỗi đó bung thẳng ra
   * request — người dùng đăng ký hỏng vì máy chủ mail hắt hơi.
   */
  QUEUE_ENABLED: featureFlag(true),

  // --- Email ---------------------------------------------------------------

  /** Địa chỉ người gửi, ví dụ `"Hệ thống <no-reply@example.com>"`. */
  MAIL_FROM: optionalString(z.string().min(1).optional()),

  /**
   * Cấu hình SMTP. Thiếu `SMTP_HOST` thì mailer mặc định chỉ ghi ra log ở dev
   * và NÉM LỖI ở production — xem `infra/mailer.ts`.
   */
  SMTP_HOST: optionalString(z.string().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_SECURE: featureFlag(false),
  SMTP_USER: optionalString(z.string().min(1).optional()),
  SMTP_PASSWORD: optionalString(z.string().min(1).optional()),

  // --- Kho tệp (S3 / MinIO / R2) -------------------------------------------
  S3_ENDPOINT: optionalString(z.string().url().optional()),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optionalString(z.string().min(1).optional()),
  S3_ACCESS_KEY_ID: optionalString(z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY: optionalString(z.string().min(1).optional()),
  /**
   * `true` với MinIO và một số nhà cung cấp trong nước (bucket nằm trong
   * đường dẫn thay vì tên miền con).
   */
  S3_FORCE_PATH_STYLE: featureFlag(false),
  /** Tên miền CDN đặt trước bucket, nếu có. */
  S3_PUBLIC_URL: optionalString(z.string().url().optional()),
  /**
   * Tiền tố đứng trước MỌI khoá tệp, vd. `xemphim` -> `xemphim/movies/...`. Dùng khi nhiều app chung
   * một bucket. Đổi giá trị này sau khi đã có tệp thì tệp cũ VẪN đọc được (khoá cũ lưu trong DB),
   * chỉ tệp mới đi vào tiền tố mới.
   */
  STORAGE_KEY_PREFIX: optionalString(
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9/_-]*$/i, "Chỉ chữ, số, gạch ngang, gạch dưới và /")
      .optional(),
  ),

  // --- OAuth ---------------------------------------------------------------
  // Mỗi provider độc lập: thiếu cặp CLIENT_ID/SECRET của provider nào thì
  // riêng provider đó báo "chưa cấu hình", không làm sập app.
  GOOGLE_CLIENT_ID: optionalString(z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: optionalString(z.string().min(1).optional()),
  GITHUB_CLIENT_ID: optionalString(z.string().min(1).optional()),
  GITHUB_CLIENT_SECRET: optionalString(z.string().min(1).optional()),
  FACEBOOK_CLIENT_ID: optionalString(z.string().min(1).optional()),
  FACEBOOK_CLIENT_SECRET: optionalString(z.string().min(1).optional()),
  /**
   * Apple không dùng client secret tĩnh: secret là một JWT tự ký bằng private
   * key (.p8), hết hạn tối đa 6 tháng. Bốn biến này là nguyên liệu để tự sinh
   * JWT đó lúc chạy — xem `auth/oauth/apple-client-secret.ts`.
   */
  APPLE_CLIENT_ID: optionalString(z.string().min(1).optional()),
  APPLE_TEAM_ID: optionalString(z.string().min(1).optional()),
  APPLE_KEY_ID: optionalString(z.string().min(1).optional()),
  APPLE_PRIVATE_KEY: optionalString(z.string().min(1).optional()),

  // --- Tài khoản quản trị đầu tiên (dùng cho db:seed) ----------------------
  ADMIN_EMAIL: optionalString(z.string().email("ADMIN_EMAIL không hợp lệ").optional()),
  ADMIN_PASSWORD: optionalString(z.string().min(8, "ADMIN_PASSWORD tối thiểu 8 ký tự").optional()),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Giá trị giả cho bước `docker build` / `next build`, nơi chưa có secret thật.
 * Đặt `SKIP_ENV_VALIDATION=1` để dùng.
 */
const buildTimePlaceholders: Partial<Record<keyof Env, string>> = {
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  SESSION_SECRET: "build-time-placeholder-secret-not-used-at-runtime",
};

function loadEnv(): Env {
  const source =
    process.env.SKIP_ENV_VALIDATION === "1"
      ? { ...buildTimePlaceholders, ...process.env }
      : process.env;

  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(`Cấu hình môi trường không hợp lệ:\n${details}\n\nĐối chiếu với .env.example.`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

/**
 * Dựng URL tuyệt đối trỏ về ứng dụng.
 *
 * Ném lỗi khi thiếu `APP_URL` thay vì đoán bừa `localhost` — xem lý do ở phần
 * khai báo biến.
 */
export function appUrl(path: string): string {
  if (!env.APP_URL) {
    throw new Error(
      "Thiếu APP_URL — không dựng được link tuyệt đối (email xác thực, callback OAuth). " +
        "Đặt biến này trong .env trước khi bật các luồng đó.",
    );
  }

  return new URL(path, env.APP_URL).toString();
}

/**
 * Dựng URL tuyệt đối trỏ về chính API này.
 *
 * Lùi về `APP_URL` khi chưa đặt `API_PUBLIC_URL` — xem ghi chú ở phần khai báo
 * biến để biết khi nào bắt buộc phải tách hai giá trị.
 */
/**
 * `rpID` và danh sách `origin` cho WebAuthn, dẫn xuất từ `APP_URL` khi không
 * khai tường minh.
 *
 * Ném lỗi thay vì đoán bừa: một passkey đăng ký với `rpID` sai sẽ đăng ký
 * THÀNH CÔNG rồi không bao giờ đăng nhập được — lỗi chỉ lộ ra ở lần thử thứ
 * hai, trên máy người dùng.
 */
export function webAuthnConfig(): { rpID: string; rpName: string; origins: string[] } {
  const explicitOrigins = env.WEBAUTHN_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (env.WEBAUTHN_RP_ID && explicitOrigins?.length) {
    return { rpID: env.WEBAUTHN_RP_ID, rpName: env.APP_NAME, origins: explicitOrigins };
  }

  if (!env.APP_URL) {
    /*
     * `ProviderNotConfiguredError` chứ không phải `Error` thường.
     *
     * Đây là lỗi CẤU HÌNH, và nó phải đi tới người vận hành với nguyên văn
     * cách sửa. Ném `Error` thường thì `handleApiError` xếp nó vào nhánh cuối
     * và trả 500 "Lỗi máy chủ. Vui lòng thử lại." — client cứ thử lại mãi
     * trong khi thứ cần làm là sửa một dòng trong `.env`.
     *
     * Đặt ở ĐÂY, nguồn duy nhất của cấu hình, thay vì kiểm lại trước mỗi lần
     * gọi: mỗi nơi gọi tự canh là sớm muộn cũng có một nơi quên.
     */
    throw new ProviderNotConfiguredError(
      "passkey (thiếu APP_URL, hoặc cả WEBAUTHN_RP_ID lẫn WEBAUTHN_ORIGINS)",
    );
  }

  const appUrlParsed = new URL(env.APP_URL);

  return {
    rpID: env.WEBAUTHN_RP_ID ?? appUrlParsed.hostname,
    rpName: env.APP_NAME,
    origins: explicitOrigins ?? [appUrlParsed.origin],
  };
}

/** `true` khi đủ điều kiện chạy passkey — dùng để ẩn/hiện nút trên giao diện. */
export function isWebAuthnConfigured(): boolean {
  try {
    webAuthnConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Bí danh của `APP_URL` cho mã chạy PHÍA TRÌNH DUYỆT.
 *
 * Next chỉ nhúng vào bundle những biến có tiền tố `NEXT_PUBLIC_`. Server thì
 * dùng `env.APP_URL` — cùng một giá trị, khai một lần.
 */
export const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? env.APP_URL ?? "";

export function apiUrl(path: string): string {
  const base = env.API_PUBLIC_URL ?? env.APP_URL;

  if (!base) {
    throw new Error(
      "Thiếu API_PUBLIC_URL (và cả APP_URL) — không dựng được redirect_uri cho OAuth.",
    );
  }

  return new URL(path, base).toString();
}
