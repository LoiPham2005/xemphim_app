import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/flutter/gen_api.dart", () => {
  it("phục vụ script Dart với URL openapi.json của chính backend đã điền sẵn", async () => {
    const res = await GET(new Request("http://internal:3000/api/flutter/gen_api.dart"));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    // APP_URL (vitest.config.ts) thắng origin nội bộ của request — sau reverse proxy request.url là localhost.
    expect(body).toContain(
      "const _defaultSchemaUrl = 'http://localhost:3000/api/v1/openapi.json';",
    );
    expect(body).not.toContain("__SCHEMA_URL__");
    expect(body).toContain("void main(List<String> args)");
  });

  describe("thiếu APP_URL", () => {
    afterEach(() => {
      vi.resetModules();
      vi.doUnmock("@/lib/env");
    });

    it("lấy domain thật từ header reverse proxy, không dùng địa chỉ nội bộ của request", async () => {
      vi.resetModules();
      vi.doMock("@/lib/env", () => ({ env: { APP_URL: undefined } }));
      const { GET: getKhongAppUrl } = await import("./route");

      const res = await getKhongAppUrl(
        new Request("https://0.0.0.0:3000/api/flutter/gen_api.dart", {
          headers: { "x-forwarded-host": "next-base.example.vn", "x-forwarded-proto": "https" },
        }),
      );

      expect(await res.text()).toContain(
        "const _defaultSchemaUrl = 'https://next-base.example.vn/api/v1/openapi.json';",
      );
    });
  });
});
