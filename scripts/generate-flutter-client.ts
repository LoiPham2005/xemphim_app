import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * 1-Click Script tự động sinh mã nguồn Flutter REST Client (Retrofit + Freezed)
 * ngay từ thư mục Next.js backend (chạy bằng `pnpm gen:flutter`).
 */
async function main(): Promise<void> {
  const backendDir = process.cwd();
  const flutterDir = path.resolve(backendDir, "../flutter_base2");
  const genScriptPath = path.join(flutterDir, "tools/gen_api.dart");

  if (!fs.existsSync(genScriptPath)) {
    console.error(`❌ Không tìm thấy script sinh code tại: ${genScriptPath}`);
    process.exitCode = 1;
    return;
  }

  const isWindows = process.platform === "win32";

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("fvm", ["dart", "run", "tools/gen_api.dart"], {
      cwd: flutterDir,
      shell: isWindows,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.warn("\n🎉 Đã đồng bộ API sang dự án Flutter thành công 100%!");
        resolve();
      } else {
        console.error(`\n❌ Quá trình sinh code thất bại với mã lỗi: ${code}`);
        process.exitCode = code ?? 1;
        resolve();
      }
    });

    proc.on("error", (err: Error) => {
      console.error("\n❌ Không thể khởi chạy lệnh:", err.message);
      reject(err);
    });
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n❌ Lỗi:", message);
  process.exitCode = 1;
});
