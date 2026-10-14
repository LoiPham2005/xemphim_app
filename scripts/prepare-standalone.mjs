import { access, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hoàn thiện output `standalone` sau khi `next build` chạy xong.
 *
 * Next.js cố tình KHÔNG chép `public/` và `.next/static/` vào
 * `.next/standalone/` — nó giả định bạn tự làm bước đó trong quy trình deploy.
 *
 * Hậu quả nếu quên: server vẫn chạy, HTML vẫn trả về 200, nhưng mọi file CSS
 * và JS đều 404. Trang hiện ra trần trụi không style và không có gì báo lỗi —
 * đây là cái bẫy kinh điển khi deploy Next.js standalone lên VPS.
 *
 * Chạy tự động qua script `postbuild`, nên không ai phải nhớ.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(projectRoot, ".next", "standalone");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyInto(source, destination, label) {
  if (!(await exists(source))) {
    console.log(`   bỏ qua ${label} (không tồn tại)`);
    return;
  }

  await cp(source, destination, { recursive: true, force: true });
  console.log(`   ✓ ${label}`);
}

async function main() {
  if (!(await exists(standaloneDir))) {
    // Không phải lỗi: chỉ có nghĩa là next.config đang không bật
    // `output: "standalone"`.
    console.log("prepare-standalone: không có .next/standalone, bỏ qua.");
    return;
  }

  console.log("prepare-standalone: chép asset tĩnh vào bản standalone");

  await copyInto(join(projectRoot, "public"), join(standaloneDir, "public"), "public/");
  await copyInto(
    join(projectRoot, ".next", "static"),
    join(standaloneDir, ".next", "static"),
    ".next/static/",
  );
}

await main();
