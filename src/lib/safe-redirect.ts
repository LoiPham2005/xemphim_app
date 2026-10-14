/**
 * Chỉ chấp nhận đường dẫn nội bộ.
 *
 * `//evil.com` là một path hợp lệ về mặt cú pháp nhưng trình duyệt hiểu là
 * protocol-relative URL và sẽ rời khỏi site — đây chính là lỗ hổng open
 * redirect kinh điển trên tham số `?next=`.
 *
 * Dùng cho cả `next` trong form đăng nhập (`(auth)/actions.ts`) lẫn `next`
 * trong luồng OAuth (`api/auth/oauth/[provider]/start`) — cùng một rủi ro,
 * cùng một cách chặn.
 */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
