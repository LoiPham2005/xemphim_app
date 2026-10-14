import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { hash } from "@node-rs/argon2";

/**
 * Dữ liệu mẫu cho môi trường DEV.
 *
 * KHÔNG BAO GIỜ chạy trên production — mật khẩu ở đây nằm công khai trong mã
 * nguồn. `seed.ts` chặn điều đó bằng `NODE_ENV`.
 */
const DEV_PASSWORD = "matkhau123";

/**
 * Tài khoản mẫu cho dev VÀ cho bộ E2E (`e2e/*.spec.ts` đăng nhập bằng đúng các tài khoản này).
 * Đổi email/mật khẩu/username ở đây thì sửa theo bên E2E — CI từng đỏ hai tháng vì hai bên lệch nhau.
 * `username` để E2E kiểm được đăng nhập bằng tên đăng nhập (cùng ô với email).
 */
const DEV_USERS = [
  {
    email: "admin@dev.local",
    username: "devadmin",
    fullName: "Quản trị viên Dev",
    role: SYSTEM_ROLES.ADMIN,
  },
  {
    email: "manager@dev.local",
    username: "devmanager",
    fullName: "Quản lý Dev",
    role: SYSTEM_ROLES.MANAGER,
  },
  {
    email: "staff@dev.local",
    username: "devstaff",
    fullName: "Nhân viên Dev",
    role: SYSTEM_ROLES.STAFF,
  },
  {
    email: "user@dev.local",
    username: "devuser",
    fullName: "Người dùng Dev",
    role: SYSTEM_ROLES.USER,
  },
];

export async function seedDev(prisma: PrismaClient): Promise<void> {
  // Băm MỘT LẦN rồi dùng lại cho cả bốn tài khoản: Argon2id cố tình tốn ~100ms
  // mỗi lần, và ở đây tất cả đều dùng chung một mật khẩu nên băm lại là lãng
  // phí thuần tuý.
  const password = await hash(DEV_PASSWORD, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const item of DEV_USERS) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: item.role },
      select: { id: true },
    });

    // `upsert` cần một khoá DUY NHẤT mà Prisma biết, nhưng `email` được ràng
    // buộc bằng partial unique index viết tay (xem model `User`). Nên: tìm
    // trước, tạo sau.
    const existing = await prisma.user.findFirst({
      where: { email: item.email, deletedAt: null },
      select: { id: true },
    });

    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email: item.email,
          username: item.username,
          password,
          emailVerifiedAt: new Date(),
          status: "ACTIVE",
          profile: { create: { fullName: item.fullName } },
        },
        select: { id: true },
      }));

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  console.log(`✓ Đã tạo ${DEV_USERS.length} tài khoản dev (mật khẩu chung: ${DEV_PASSWORD})`);
}
