import { requireApiUser } from "@/lib/api/auth";
import { apiErrors } from "@/lib/api/response";
import { permissionService } from "@/services/permission.service";
import type { FileViewer } from "@/services/file.service";

/**
 * Người đang gọi API tệp: cần `file:upload` (thao tác trên tệp CỦA MÌNH) hoặc `file:manage` (mọi tệp).
 * Phạm vi "của mình hay của mọi người" do `fileService` áp TRONG câu truy vấn — route chỉ cần biết
 * người gọi có `file:manage` hay không.
 */
export async function requireFileViewer(request: Request): Promise<FileViewer> {
  const session = await requireApiUser(request);
  const [canUpload, canManage] = await Promise.all([
    permissionService.can(session.sub, "file:upload"),
    permissionService.can(session.sub, "file:manage"),
  ]);
  if (!canUpload && !canManage) throw apiErrors.forbidden();

  return { userId: session.sub, canManage };
}
