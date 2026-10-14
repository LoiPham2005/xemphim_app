import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_METADATA,
  resolveSeedPermissions,
} from "@/lib/permissions";

/**
 * Đồng bộ danh mục quyền và vai trò hệ thống TỪ CODE xuống database.
 *
 * Chạy được nhiều lần, và PHẢI chạy đầu tiên trong mọi bộ seed — không có vai
 * trò thì không tạo được người dùng nào.
 *
 * ---
 * NGUYÊN TẮC: CHỈ THÊM, KHÔNG GHI ĐÈ
 *
 * Đây là điểm quan trọng nhất của file này. Quyền gán cho vai trò là thứ quản
 * trị viên chỉnh sửa trên giao diện. Nếu seed ghi đè lại theo
 * `DEFAULT_ROLE_PERMISSIONS` thì mỗi lần deploy sẽ xoá sạch công sức cấu hình
 * của khách hàng — và không ai hiểu vì sao phân quyền "tự nhiên quay về như cũ".
 *
 * Nên: quyền còn thiếu thì thêm vào, quyền đã bị gỡ bỏ có chủ đích thì để yên.
 */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  // 1. Danh mục quyền. Nguồn sự thật là hằng PERMISSIONS trong code, nên ở đây
  //    ghi đè phần mô tả là ĐÚNG — đó là dữ liệu của code, không phải của người
  //    dùng.
  for (const key of PERMISSIONS) {
    const meta = PERMISSION_METADATA[key];
    await prisma.permission.upsert({
      where: { key },
      update: { name: meta.name, category: meta.category, description: meta.description },
      create: { key, name: meta.name, category: meta.category, description: meta.description },
    });
  }

  // 2. Vai trò hệ thống.
  for (const seed of DEFAULT_ROLE_PERMISSIONS) {
    const role = await prisma.role.upsert({
      where: { key: seed.key },
      // KHÔNG đụng vào `name`/`description` nếu vai trò đã tồn tại: khách hàng
      // có thể đã đổi tên hiển thị cho hợp ngữ cảnh của họ.
      //
      // `level` thì NGƯỢC LẠI — luôn đồng bộ từ code. Nó không phải nhãn hiển
      // thị mà là ràng buộc bảo mật: bậc của SUPER_ADMIN bị ai đó hạ xuống 5
      // nghĩa là mọi ADMIN đều thao tác được lên tài khoản quản trị tối cao.
      // Thứ như vậy phải có đúng một nguồn sự thật, và nó nằm trong code.
      update: { isSystem: true, level: seed.level },
      create: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        level: seed.level,
        isSystem: true,
      },
      select: { id: true },
    });

    const wanted = resolveSeedPermissions(seed);
    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...wanted] } },
      select: { id: true },
    });

    // `skipDuplicates` là thứ làm cho "chỉ thêm, không ghi đè" thành sự thật:
    // dòng đã có thì bỏ qua, và dòng admin đã gỡ đi thì... vẫn được thêm lại.
    //
    // ⚠️ Đó là giới hạn đã biết: seed không phân biệt được "chưa từng có" với
    // "đã bị gỡ có chủ đích". Nếu dự án của bạn cần giữ nguyên các lần gỡ đó,
    // hãy chỉ chạy `seedRbac` một lần lúc cài đặt, đừng chạy trong mỗi lần
    // deploy.
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }
}
