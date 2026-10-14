import { describe, expect, it } from "vitest";
import { API_PREFIX, apiPath } from "./version";

describe("apiPath", () => {
  it("ghép tiền tố phiên bản hiện tại — đổi version chỉ sửa MỘT hằng số", () => {
    expect(API_PREFIX).toBe("/api/v1");
    expect(apiPath("/auth/logout")).toBe("/api/v1/auth/logout");
  });
});
