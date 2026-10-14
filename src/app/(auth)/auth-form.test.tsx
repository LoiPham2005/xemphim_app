import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthFields, FORM_STYLE, type Field } from "./auth-form";

const fields: Field[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "password", label: "Mật khẩu", type: "password", required: true },
];

function renderFields(props: Partial<Parameters<typeof AuthFields>[0]> = {}) {
  return render(
    <form style={FORM_STYLE}>
      <AuthFields
        fields={fields}
        state={{}}
        isPending={false}
        submitLabel="Đăng nhập"
        pendingLabel="Đang xử lý…"
        {...props}
      />
    </form>,
  );
}

describe("AuthFields", () => {
  it("gắn label đúng với input", () => {
    renderFields();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeEnabled();
  });

  it("hiện lỗi từng field và nối vào input bằng aria-describedby", () => {
    renderFields({ state: { fieldErrors: { email: ["Email không hợp lệ"] } } });

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Email không hợp lệ");
  });

  it("hiện lỗi chung với role=alert để screen reader đọc ngay", () => {
    renderFields({ state: { error: "Email hoặc mật khẩu không chính xác" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Email hoặc mật khẩu không chính xác");
  });

  it("khoá nút và đổi nhãn khi đang gửi", () => {
    renderFields({ isPending: true });

    expect(screen.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
  });

  it("gắn đường dẫn chuyển hướng vào field ẩn", () => {
    const { container } = renderFields({ nextPath: "/users" });

    expect(container.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/users");
  });

  it("không render field ẩn khi không có nextPath", () => {
    const { container } = renderFields();

    expect(container.querySelector('input[name="next"]')).toBeNull();
  });
});
