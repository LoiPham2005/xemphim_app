import { isProduction } from "./env";
import { captureException } from "./observability";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

/** Key có tên nằm trong danh sách này sẽ bị che trước khi ghi log. */
const REDACTED_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "sessionsecret",
  "authorization",
  "cookie",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redact(item, depth + 1);
  }
  return output;
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    error: {
      name: error.name,
      message: error.message,
      // Stack chỉ có ích khi debug; trên production nó là rác log và có thể lộ path.
      ...(isProduction ? {} : { stack: error.stack }),
    },
  };
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as LogContext) : {}),
  };

  // JSON một dòng: đọc được bằng mắt, và parse được bởi Loki/Datadog/CloudWatch.
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  // Đây là điểm ghi log duy nhất của ứng dụng, nên nó được phép dùng
  // console.log — chỗ khác thì không.
  // eslint-disable-next-line no-console
  else console.log(line);
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (!isProduction) emit("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, error?: unknown, context?: LogContext) {
    emit("error", message, { ...context, ...(error === undefined ? {} : serializeError(error)) });

    /*
     * Đẩy luôn ra hệ thống giám sát bên ngoài.
     *
     * Đặt ở ĐÂY chứ không bắt từng nơi gọi tự nhớ: `logger.error` đã là điểm
     * duy nhất mà mọi lỗi đi qua, nên nối vào đây là phủ được toàn bộ ứng
     * dụng bằng một dòng — thay vì rải `Sentry.captureException` khắp nơi rồi
     * quên vài chỗ.
     *
     * Chưa cắm nhà cung cấp thì đây là hàm rỗng, không tốn gì.
     */
    captureException(error ?? new Error(message), { message, ...context });
  },
};
