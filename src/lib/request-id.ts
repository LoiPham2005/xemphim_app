/**
 * Mã định danh request, dùng để nối các dòng log rời rạc lại với nhau.
 *
 * ---
 * VÌ SAO CẦN
 *
 * Logger đã ghi JSON một dòng, đọc được bằng Loki/Datadog. Nhưng khi một
 * request sinh ra nhiều dòng — rate limit chạm ngưỡng, service ném lỗi, handler
 * ghi lỗi cuối cùng — thì không có gì cho biết ba dòng đó thuộc CÙNG MỘT
 * request hay ba request khác nhau xảy ra gần nhau. Trên production lúc đang
 * có sự cố, đó đúng là câu hỏi cần trả lời đầu tiên.
 *
 * ---
 * VÌ SAO ƯU TIÊN HEADER CÓ SẴN
 *
 * Reverse proxy (Caddy, nginx, Cloudflare) và load balancer thường đã gắn sẵn
 * `X-Request-Id`. Tôn trọng giá trị đó thì log của ứng dụng nối được với log
 * của tầng mạng — không có bước này thì mỗi tầng có một mã riêng và việc lần
 * theo một request phải làm thủ công.
 *
 * ⚠️ Giá trị này do CLIENT gửi được, nên KHÔNG BAO GIỜ dùng nó vào việc bảo
 * mật hay làm khoá dữ liệu. Nó chỉ để đọc log.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/** Cắt bớt để một client gửi header dài 10KB không làm phình log. */
const MAX_LENGTH = 128;

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Lấy mã từ header, hoặc sinh mới nếu chưa có. */
export function getRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (!incoming) return generateRequestId();

  // Chỉ giữ ký tự an toàn cho log: chuỗi lạ do client gửi có thể chứa xuống
  // dòng, và một dòng log JSON bị chèn thêm dấu xuống dòng là một dòng log
  // giả mạo được.
  const cleaned = incoming.replace(/[^\w.:-]/g, "").slice(0, MAX_LENGTH);

  return cleaned || generateRequestId();
}
