import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { hash } from "@node-rs/argon2";

/**
 * Tạo tài khoản quản trị đầu tiên.
 *
 * ---
 * VÌ SAO ĐỌC TỪ BIẾN MÔI TRƯỜNG, KHÔNG VIẾT CỨNG
 *
 * Một bộ khung có sẵn `admin@example.com / admin123` trong mã nguồn là một tài
 * khoản mà CẢ THẾ GIỚI biết mật khẩu, và nó sẽ theo dự án lên tận production —
 * đây là một trong những cách bị chiếm quyền phổ biến nhất.
 *
 * Không đặt `ADMIN_EMAIL`/`ADMIN_PASSWORD` thì hàm này bỏ qua, và nói rõ ra.
 */
export async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log(
      "⏭️  Bỏ qua tạo admin: chưa đặt ADMIN_EMAIL/ADMIN_PASSWORD trong .env.\n" +
        "   Sinh mật khẩu mạnh bằng: openssl rand -base64 24",
    );
    return;
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.SUPER_ADMIN },
    select: { id: true },
  });

  // `findFirst`, không phải `findUnique`: `email` được ràng buộc bằng partial
  // unique index (`WHERE deleted_at IS NULL`) viết tay trong migration, nên
  // Prisma không coi nó là khoá duy nhất. Xem ghi chú ở model `User`.
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    // Chỉ đảm bảo vai trò, KHÔNG đặt lại mật khẩu: chạy seed trên production
    // (chuyện bình thường sau mỗi lần deploy) mà reset mật khẩu admin về giá
    // trị trong biến môi trường là một bất ngờ rất khó chịu.
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: role.id } },
      update: {},
      create: { userId: existing.id, roleId: role.id },
    });
    console.log(`✓ Admin đã tồn tại: ${email} (đã đảm bảo vai trò SUPER_ADMIN)`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      password: await hash(password, {
        algorithm: 2,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      // Admin do người vận hành tạo bằng tay: không có ai để gửi thư xác thực,
      // và bắt xác thực sẽ khoá chính người vừa cài đặt hệ thống ra ngoài.
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
      profile: { create: { fullName: "Quản trị hệ thống" } },
      userRoles: { create: { roleId: role.id } },
    },
  });

  console.log(`✓ Đã tạo admin: ${email}`);
}
