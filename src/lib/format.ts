/**
 * Tiện ích format dữ liệu thường dùng trong dự án
 */

/**
 * Format số tiền thành định dạng VNĐ (hoặc ngoại tệ tùy chọn)
 * @example formatCurrency(500000) => "500.000 ₫"
 */
export function formatCurrency(
  amount: number,
  currency: "VND" | "USD" = "VND",
  locale = "vi-VN",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

/**
 * Format ngày tháng năm chuẩn định dạng Việt Nam
 * @example formatDate(new Date()) => "16/08/2026"
 */
export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  },
  locale = "vi-VN",
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, options).format(d);
}

/**
 * Format ngày giờ đầy đủ
 * @example formatDateTime(new Date()) => "17:45 16/08/2026"
 */
export function formatDateTime(date: Date | string | number): string {
  return formatDate(date, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Format số điện thoại hiển thị đẹp mắt
 * @example formatPhoneNumber("0912345678") => "0912 345 678"
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = ("" + phone).replace(/\D/g, "");
  const match = cleaned.match(/^(\d{4})(\d{3})(\d{3})$/);
  if (match) {
    return `${match[1]} ${match[2]} ${match[3]}`;
  }
  return phone;
}

/**
 * Chuyển chuỗi Tiếng Việt có dấu thành slug URL không dấu
 * @example slugify("Áo Thun Nam Đẹp") => "ao-thun-nam-dep"
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/([^0-9a-z-\s])/g, "")
    .replace(/(\s+)/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
