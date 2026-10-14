import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `includeUnpublished=true` là cờ do CLIENT gửi — nếu tin nó mà không kiểm `movie:manage` thì mọi
 * tài khoản xem được phim đang ẩn (chưa duyệt) chỉ bằng một tham số URL.
 */

vi.mock("@/lib/api/auth", () => ({
  requireApiPermission: vi.fn().mockResolvedValue({ sub: "u-1", email: "u@test" }),
}));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));
vi.mock("@/services/movie.service", () => ({
  movieService: { list: vi.fn().mockResolvedValue({ items: [], meta: { total: 0 } }) },
}));

import { movieService } from "@/services/movie.service";
import { permissionService } from "@/services/permission.service";
import { GET } from "./route";

const get = (query: string) => GET(new Request(`http://localhost/api/v1/movies${query}`));

beforeEach(() => {
  vi.mocked(movieService.list).mockClear();
});

describe("GET /api/v1/movies", () => {
  it("người KHÔNG có movie:manage gửi includeUnpublished=true vẫn chỉ thấy phim đã xuất bản", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(false);
    const res = await get("?includeUnpublished=true");

    expect(res.status).toBe(200);
    expect(vi.mocked(movieService.list).mock.calls[0]?.[1]).toEqual({ includeUnpublished: false });
  });

  it("người có movie:manage gửi includeUnpublished=true thì thấy cả phim ẩn", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(true);
    await get("?includeUnpublished=true");

    expect(vi.mocked(movieService.list).mock.calls[0]?.[1]).toEqual({ includeUnpublished: true });
  });

  it("người quản lý KHÔNG gửi cờ thì mặc định chỉ phim đã xuất bản, lọc được theo loại", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(true);
    await get("?type=SERIES&genre=hanh-dong");

    const [query, viewer] = vi.mocked(movieService.list).mock.calls[0] ?? [];
    expect(viewer).toEqual({ includeUnpublished: false });
    expect(query).toMatchObject({ type: "SERIES", genre: "hanh-dong" });
  });

  it("loại phim sai -> 422", async () => {
    const res = await get("?type=ABC");
    expect(res.status).toBe(422);
  });
});
