import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { listFilesSchema, type FileKind } from "@/schemas/file.schema";
import { fileService, type PublicFile } from "@/services/file.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploader } from "./file-uploader";
import { FileItemActions } from "./file-item-actions";

export const metadata: Metadata = { title: "Thư viện tệp" };
export const dynamic = "force-dynamic";

const PER_PAGE = 24;

const KIND_LABELS: Record<FileKind, string> = {
  image: "Ảnh",
  document: "Tài liệu",
  audio: "Âm thanh",
  video: "Video",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Xem trước theo nhóm. `preload="none"`: lưới 24 video mà tải trước cả 24 là nghẽn mạng. */
function Preview({ file }: { file: PublicFile }) {
  const box = { width: "100%", height: 140, borderRadius: 8, background: "var(--bg-elevated)" };

  if (file.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ảnh nằm trên kho S3/CDN, không qua next/image
      <img
        src={file.url}
        alt={file.originalName}
        loading="lazy"
        style={{ ...box, objectFit: "cover" }}
      />
    );
  }
  if (file.kind === "video") {
    return <video src={file.url} controls preload="none" style={{ ...box, objectFit: "cover" }} />;
  }
  if (file.kind === "audio") {
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", padding: 8 }}>
        <audio src={file.url} controls preload="none" style={{ width: "100%" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        ...box,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "2rem",
      }}
    >
      📄
    </div>
  );
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Lớp bảo vệ ở tầng trang. Server Action và REST tự kiểm lại — layout KHÔNG phải ranh giới bảo mật.
  const currentUser = await requirePermission("file:manage", "/files");

  const raw = await searchParams;
  // Tham số URL sai (vd. `?kind=abc`) thì bỏ qua bộ lọc đó thay vì báo lỗi cả trang.
  const parsed = listFilesSchema.safeParse({ ...raw, limit: PER_PAGE });
  const query = parsed.success ? parsed.data : listFilesSchema.parse({ limit: PER_PAGE });

  const { items, meta } = await fileService.list(query, {
    userId: currentUser.id,
    canManage: true,
  });

  const linkTo = (page: number) => ({
    pathname: "/files",
    query: {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q ? { q: query.q } : {}),
      page,
    },
  });

  return (
    <>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Link href="/" style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            ← Quay lại trang chủ
          </Link>
          <h1 className="page-title">Thư viện tệp</h1>
        </div>
        <span className="badge badge-primary">Tổng: {meta.total}</span>
      </div>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 16 }}>Tải tệp lên</h2>
        <FileUploader />
      </section>

      <section className="card">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <Input
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Tìm theo tên tệp..."
            style={{ maxWidth: 260 }}
          />
          <select
            name="kind"
            defaultValue={query.kind ?? ""}
            className="h-10 rounded-md border border-line bg-transparent px-3"
          >
            <option value="">Mọi loại</option>
            {(Object.keys(KIND_LABELS) as FileKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Lọc
          </Button>
        </form>

        {items.length === 0 ? (
          <p style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
            Chưa có tệp nào.
          </p>
        ) : (
          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
              listStyle: "none",
              padding: 0,
            }}
          >
            {items.map((file) => (
              <li
                key={file.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <Preview file={file} />
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={file.originalName}
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.originalName}
                </a>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {file.kind ? KIND_LABELS[file.kind] : file.contentType} · {formatSize(file.size)}{" "}
                  · {file.createdAt.toLocaleDateString("vi-VN")}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {file.attached && <span className="badge badge-success">Đang được dùng</span>}
                  {!file.attached && file.retained && (
                    <span className="badge badge-primary">Lưu trong thư viện</span>
                  )}
                  {!file.attached && !file.retained && (
                    <span className="badge badge-warning">Chưa dùng · tự xoá sau 24h</span>
                  )}
                </div>
                <FileItemActions id={file.id} name={file.originalName} attached={file.attached} />
              </li>
            ))}
          </ul>
        )}

        {(meta.page > 1 || meta.hasNext) && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 20,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Trang {meta.page}/{meta.totalPages} · {meta.total} tệp
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {meta.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={linkTo(meta.page - 1)}>← Trước</Link>
                </Button>
              )}
              {meta.hasNext && (
                <Button asChild variant="outline" size="sm">
                  <Link href={linkTo(meta.page + 1)}>Sau →</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
