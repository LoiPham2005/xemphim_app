import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDateTime, formatPhoneNumber, slugify } from "./format";

/**
 * Vì sao file tiện ích này cần test dù nó rất đơn giản.
 *
 * `format.ts` từng nằm im không nơi nào gọi tới. Code không ai dùng thì hỏng
 * trong im lặng — đúng như 6 component `ui/` vừa bị xoá: chúng mang một lỗi
 * giao diện suốt nhiều tháng mà không ai biết, vì chưa từng chạy lần nào.
 *
 * Test là thứ giữ cho một tiện ích chưa dùng tới vẫn còn ĐÚNG vào ngày cần
 * dùng. Các hàm ở đây đều thuần, không chạm database, nên cái giá gần bằng 0.
 *
 * ⚠️ `Intl` cho ra ký tự khoảng trắng khác nhau tuỳ phiên bản Node/ICU — dấu
 * phân cách nhóm và khoảng trắng trước ký hiệu tiền tệ có thể là NBSP
 * (U+00A0) chứ không phải dấu cách thường. Vì vậy các khẳng định dưới đây
 * kiểm PHẦN CHẮC CHẮN (chữ số, ký hiệu) thay vì so khớp nguyên chuỗi — nếu
 * không, test sẽ đỏ trên máy khác mà code không hề sai.
 */

describe("formatCurrency", () => {
  it("định dạng VNĐ, không lấy phần thập phân", () => {
    const result = formatCurrency(500000);

    expect(result).toContain("500.000");
    expect(result).toContain("₫");
    // VNĐ không dùng hào — hiện ",00" là sai về nghiệp vụ, không chỉ xấu.
    expect(result).not.toContain(",00");
  });

  it("giữ 2 chữ số thập phân cho USD", () => {
    const result = formatCurrency(1234.5, "USD", "en-US");

    expect(result).toContain("1,234.50");
    expect(result).toContain("$");
  });

  it("xử lý được số 0 và số âm", () => {
    expect(formatCurrency(0)).toContain("0");
    expect(formatCurrency(-50000)).toContain("50.000");
  });
});

describe("formatDate", () => {
  it("định dạng ngày/tháng/năm kiểu Việt Nam", () => {
    expect(formatDate(new Date("2026-08-16T00:00:00"))).toBe("16/08/2026");
  });

  it("nhận cả chuỗi lẫn timestamp", () => {
    expect(formatDate("2026-01-05T00:00:00")).toBe("05/01/2026");
    expect(formatDate(new Date("2026-01-05T00:00:00").getTime())).toBe("05/01/2026");
  });

  it("trả chuỗi rỗng khi ngày không hợp lệ, không ném lỗi", () => {
    // Quan trọng: dữ liệu bẩn phải làm một ô hiển thị trống, không được làm
    // sập cả trang đang render danh sách.
    expect(formatDate("khong-phai-ngay")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("có cả giờ phút lẫn ngày tháng năm", () => {
    const result = formatDateTime(new Date("2026-08-16T17:45:00"));

    expect(result).toContain("17:45");
    expect(result).toContain("16/08/2026");
  });
});

describe("formatPhoneNumber", () => {
  it("tách số di động 10 chữ số thành 3 nhóm", () => {
    expect(formatPhoneNumber("0912345678")).toBe("0912 345 678");
  });

  it("bỏ qua ký tự thừa trước khi tách nhóm", () => {
    expect(formatPhoneNumber("0912-345-678")).toBe("0912 345 678");
  });

  it("trả nguyên bản khi không khớp dạng 10 số", () => {
    // Số cố định, số quốc tế, hay chuỗi rác đều không khớp. Trả nguyên bản
    // vẫn hơn là bịa ra một cách tách nhóm sai.
    expect(formatPhoneNumber("+84912345678")).toBe("+84912345678");
    expect(formatPhoneNumber("123")).toBe("123");
  });
});

describe("slugify", () => {
  it("bỏ dấu tiếng Việt", () => {
    expect(slugify("Áo Thun Nam Đẹp")).toBe("ao-thun-nam-dep");
  });

  it("xử lý đúng chữ đ/Đ — chữ này không phải dấu, NFD không tách được", () => {
    // `normalize("NFD")` tách được dấu sắc/huyền/hỏi/ngã/nặng, nhưng "đ" là
    // một chữ cái riêng. Thiếu bước thay riêng thì nó bị regex sau đó xoá mất.
    expect(slugify("Đường Đi Đẹp")).toBe("duong-di-dep");
  });

  it("gộp khoảng trắng thừa và cắt gạch nối ở hai đầu", () => {
    expect(slugify("  Sản   phẩm  mới  ")).toBe("san-pham-moi");
  });

  it("loại ký tự đặc biệt nhưng giữ chữ số", () => {
    expect(slugify("iPhone 15 Pro Max (2024)!")).toBe("iphone-15-pro-max-2024");
  });
});
