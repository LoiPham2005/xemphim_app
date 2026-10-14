# Hướng dẫn chọn hạ tầng: Database, Object Storage, Server

Bối cảnh: tự vận hành nhiều dự án nhỏ (kiểu app booking), mỗi dự án bắt đầu từ
0 người dùng, một số sẽ lớn lên có khách thật. Mục tiêu: rẻ ở giai đoạn thử
nghiệm, không phải đổi hạ tầng khi dự án nào đó thật sự chạy.

## 1. Database

### So sánh

|                          | Free tier                                                                       | Giá vào                             | Mạnh nhất                                                            | Yếu nhất                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Neon**                 | 100 project, mỗi project 0.5GB + 100 compute-hours riêng, scale-to-zero tự động | $0.106/CU-hour, không phí tối thiểu | Nhiều project song song không tranh tài nguyên, rẻ khi mở rộng       | Backup/restore phải tự bật, không tự động kèm sẵn                                           |
| **Supabase**             | Chỉ 2 project, 500MB, 5GB egress                                                | $25/tháng (Pro)                     | Bundle sẵn Auth+Storage+DB, backup 7 ngày tự động không cần cấu hình | Giới hạn 2 project ở free; giá compute leo nhanh khi cần nhiều RAM (Micro $10 → Medium $60) |
| **Prisma Postgres**      | "50 databases" nhưng CHUNG 1 project, chung đúng 500MB + 100k operations        | $10/tháng (Starter)                 | Studio chạy sẵn trên web, giá/operation giảm dần theo tier           | Giá storage đắt gấp 8-16 lần Neon/Supabase                                                  |
| **Tự host (Docker/VPS)** | Không giới hạn, chỉ tốn tiền VPS                                                | Giá VPS                             | Rẻ nhất, toàn quyền kiểm soát                                        | **Không có backup tự động** — phải tự script `pg_dump` + đẩy lên object storage             |

### Quyết định theo giai đoạn

- **Thử nghiệm nhiều ý tưởng, chưa có khách thật** → **Neon free**. Mở bao nhiêu
  project cũng được, mỗi cái có tài nguyên riêng, không cần thẻ tín dụng.
- **Một dự án bắt đầu có khách đặt chỗ/giao dịch thật** → bắt buộc phải có
  backup đáng tin cậy tại đây (mất dữ liệu đặt chỗ = thiệt hại kinh doanh thật,
  không chỉ là bug). Hai lựa chọn:
  - Tự cấu hình restore trên Neon (`$0.20/GB-tháng`, phải chủ động bật), hoặc
  - Chuyển riêng dự án đó sang **Supabase Pro** — backup 7 ngày có sẵn, không
    phải nghĩ tới.
- Không cần áp 1 giải pháp cho toàn bộ — chỉ dự án nào chạm "tiền thật, khách
  thật" mới cần nâng cấp độ an toàn.

## 2. Object Storage (ảnh, video)

**Không bao giờ lưu file trong Postgres hay đĩa VPS** — phình database, không
CDN, VPS chết là mất file.

|                                   | Storage             | Egress                                                                  | Ghi chú                                                                                                                             |
| --------------------------------- | ------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare R2**                 | $0.015/GB           | **$0**                                                                  | Khuyên dùng — app nhiều ảnh (phòng, địa điểm...) bị xem lại nhiều lần, egress mới là khoản tốn tiền thật, không phải dung lượng lưu |
| Backblaze B2                      | $0.006/GB (rẻ nhất) | $0 nếu serve qua Cloudflare CDN, ngược lại $0.01/GB                     | Rẻ hơn R2 về lý thuyết nhưng phải tự nối thêm CDN                                                                                   |
| AWS S3 / GCS                      | ~$0.02/GB           | ~$0.09-0.12/GB                                                          | Egress đắt, tránh cho app nhiều ảnh/video                                                                                           |
| Supabase Storage / Prisma Buckets | Bundled theo gói DB | Tính chung vào pool egress của DB (Supabase) / không công khai (Prisma) | Dùng chung pool egress với DB — rủi ro làm cạn quota DB nhanh hơn                                                                   |

**Chọn: Cloudflare R2**, tách hoàn toàn khỏi DB, dù DB đặt ở Neon/Supabase/tự
host nào cũng dùng chung được.

### Object storage trong nước (Việt Nam)

| Nhà cung cấp               | Giá storage                                        | Ghi chú                                                                     |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **vHost**                  | ~480đ/GB/tháng (≈ $0.019/GB)                       | Gần bằng giá R2, kèm **miễn phí 1TB băng thông** — quá 1TB thì cần hỏi thêm |
| **VNDATA**                 | Từ ~500đ/GB/tháng (≈ $0.02/GB)                     | S3-compatible                                                               |
| **FPT S3 Storage**         | ~1.000đ/GB/tháng cho gói lưu trữ lạnh (≈ $0.04/GB) | Đắt hơn R2 ~2.7 lần, hướng doanh nghiệp                                     |
| **Vietnix S3, PA Vietnam** | Chưa có giá công khai rõ ràng                      | S3-compatible, cần liên hệ trực tiếp                                        |

Điểm khác biệt so với R2: các hãng trong nước có server đặt tại Việt Nam nên
**độ trễ thấp hơn khi phục vụ chính người dùng Việt Nam** trực tiếp từ origin
(không qua cache). Nhưng R2 dùng mạng CDN của Cloudflare — vốn cũng có điểm
edge tại Việt Nam — nên với ảnh/video được cache, tốc độ thực tế cho người
dùng cuối thường không chênh lệch nhiều. Egress $0 của R2 vẫn khó hãng nội địa
nào địch lại được ở dung lượng lớn, trừ vHost (miễn phí 1TB — cần tính xem có
đủ hay không cho quy mô dự án).

Nguồn: [Vietnix S3 Object Storage](https://vietnix.vn/s3-object-storage/),
[vHost Object Storage](https://vhost.vn/cloud/object-storage/),
[FPT S3 Storage](https://cloudfpt.com.vn/dich-vu/fpt-s3-storage/)

## 3. Server (chạy app Next.js)

⚠️ Bảng dưới đã sửa lại theo **giá thật kiểm tra trực tiếp trên trang/giỏ hàng
của từng hãng** (trước đó có bản nháp dùng số liệu tổng hợp từ tìm kiếm, bị
sai vì gói rẻ nhất đang hết hàng / không phải giá vào cửa thật).

|                                   | Giá thật (~2 vCPU/2GB)                                     | Bandwidth kèm                                                                                 | Ghi chú                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **VinaHost** (Cheap-SSD2)         | **~119.213đ/tháng** (chưa VAT) — **rẻ nhất đã kiểm chứng** | 40GB SSD, 100Mbps trong nước, **chỉ 1-10Mbps quốc tế**                                        | Giá đọc trực tiếp từ vinahost.vn/thue-vps-gia-re. Giảm thêm 5-15% nếu đóng 6-36 tháng                                                        |
| **BKNS** (Cloud VPS-VM02)         | **153.000đ/tháng**                                         | 30GB SSD, cổng 10Gbps, **500Mbps download/200Mbps upload**, backup tự động hàng tuần miễn phí | Giá đọc trực tiếp từ bkns.vn/cloud-server/cloud-vps.html. ⚠️ Trang không ghi rõ tốc độ outbound QUỐC TẾ riêng — cần hỏi thẳng trước khi chọn |
| **Vietnix** (VPS SSD 1)           | ~178.000đ/tháng (12 tháng, chưa VAT)                       | Không giới hạn dung lượng, 200Mbps trong nước, chỉ **10Mbps quốc tế**                         | Giá lấy trực tiếp từ giỏ hàng thật portal.vietnix.vn                                                                                         |
| **Hetzner** (Regular Performance) | €11.99/tháng (~330.000đ) — gói €5.99 đang hết hàng         | Chỉ 0.5TB kèm, thêm €1/TB                                                                     | Giá kiểm tra trực tiếp trên hetzner.com/cloud                                                                                                |
| DigitalOcean                      | ~$24/tháng (~610.000đ)                                     | 2TB, sau đó $0.01/GB, **tốc độ quốc tế đầy đủ, không bị giới hạn riêng**                      | Hệ sinh thái đầy đủ (Managed DB, Spaces, App Platform) cùng 1 dashboard                                                                      |

**Kết luận đã cập nhật: VinaHost rẻ nhất trong nhóm đã kiểm chứng thật**
(119.213đ so với 153.000đ của BKNS và 178.000đ của Vietnix) — nhưng dính đúng
nhược điểm giống Vietnix: **quốc tế chỉ 1-10Mbps**. Đây có vẻ là mẫu số chung
của VPS nội địa giá rẻ (bù lại bằng băng thông trong nước rộng rãi).

⚠️ **Điểm quan trọng riêng cho project này**: `xemphim` vừa được
thêm đăng nhập OAuth (Google/Github/Facebook/Apple) — mỗi lần user đăng nhập,
server phải tự gọi ra **API quốc tế** của các hãng đó để đổi authorization
code lấy token (xem `src/lib/oauth/client.ts`). Nếu sau này gửi email qua
dịch vụ ngoài (Resend, SendGrid...) hoặc gọi Stripe/OpenAI, tất cả đều là
traffic quốc tế. Với VPS chỉ 1-10Mbps quốc tế (VinaHost, Vietnix), các lệnh
gọi này có thể bị chậm rõ rệt dưới tải cao — không ảnh hưởng user đọc trang
web bình thường (traffic đó là trong nước), nhưng ảnh hưởng trực tiếp tốc độ
đăng nhập OAuth/gửi email.

### VPS trong nước khác (Việt Nam) — chưa kiểm chứng đầy đủ

| Nhà cung cấp              | Đặc điểm                                                             | Hợp với                                                                                                          |
| ------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **iNET**                  | ~240.000đ/tháng gói cơ bản (thường có khuyến mãi 50%, còn ~120.000đ) | Chưa xác nhận được cấu hình/tốc độ quốc tế chính xác qua trang giá — cần tự kiểm tra trên inet.vn trước khi chọn |
| **Viettel IDC**           | Datacenter chuẩn Tier III, ổn định nhất trong nhóm                   | Hệ thống cần độ tin cậy cao (tài chính, tổ chức lớn)                                                             |
| **FPT Cloud**             | 1 trong "4 trụ cột" hạ tầng cloud nội địa (cùng Viettel, VNG, CMC)   | Doanh nghiệp/ngân hàng — giá cao hơn mặt bằng chung, không hợp startup nhỏ                                       |
| **VNG Cloud / CMC Cloud** | Cũng thuộc nhóm "4 trụ cột", tương tự FPT Cloud                      | Doanh nghiệp vừa/lớn                                                                                             |
| **AZDIGI / TinoHost**     | Rẻ nhất trong nhóm, từ ~43.000-55.000đ/tháng                         | Dự án nhỏ, ngân sách hạn chế, chấp nhận hỗ trợ cơ bản hơn                                                        |

⚠️ Giá các hãng ở bảng này **chưa được kiểm chứng trực tiếp** qua giỏ hàng như
VinaHost/BKNS/Vietnix/Hetzner ở trên (trang iNET không tải được pricing table
qua công cụ đọc web tự động lúc kiểm tra) — chỉ mang tính tham khảo, tự vào
giỏ hàng kiểm tra trước khi quyết.

Nguồn: [TND — so sánh VPS Việt Nam 2026](https://www.tnd.vn/top-vps-viet-nam-gia-re-2026-so-sanh-7-nha-cung-cap-12925/),
[AZDIGI Blog](https://azdigi.com/blog/kien-thuc-vps/top-nha-cung-cap-vps-viet-nam),
giá VinaHost/BKNS/Hetzner/Vietnix lấy trực tiếp từ vinahost.vn, bkns.vn, hetzner.com/cloud và portal.vietnix.vn

## Tổng kết: bộ hạ tầng đề xuất

```
Server:   BKNS Cloud VPS-VM02 (153.000đ/tháng) — chạy Next.js qua Docker
          Compose / scripts/deploy-vps.sh. Trước khi đặt: hỏi thẳng BKNS
          tốc độ outbound QUỐC TẾ (trang giá không ghi rõ). Nếu quốc tế cũng
          bị giới hạn thấp như VinaHost/Vietnix, đổi sang DigitalOcean
          Singapore (~610.000đ/tháng, không giới hạn quốc tế) — đắt hơn
          nhưng cần thiết vì project có OAuth + có thể có email/API ngoài.
Database: Neon (free lúc thử nghiệm) → thêm backup hoặc chuyển Supabase Pro
          khi dự án có khách thật
Storage:  Cloudflare R2 (ảnh/video, tách riêng khỏi DB ngay từ đầu)
```

**Vì sao không chọn thẳng VinaHost dù rẻ nhất (119.213đ)**: cùng nhược điểm
1-10Mbps quốc tế như Vietnix, mà project này giờ có OAuth (gọi API quốc tế
mỗi lần đăng nhập) — rẻ hơn giá không đáng nếu tính năng chính bị chậm. BKNS
đắt hơn VinaHost 1 chút nhưng CHƯA XÁC NHẬN được điểm yếu đó có tồn tại hay
không — đáng thử hỏi trước khi loại nó.

Xem thêm [HUONG_DAN_DUNG_DBEAVER_VA_PRISMA_STUDIO.md](./HUONG_DAN_DUNG_DBEAVER_VA_PRISMA_STUDIO.md)
để biết cách xem/quản lý dữ liệu trên các database này, và
[HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md](./HUONG_DAN_CAI_COOLIFY_QUAN_LY_NHIEU_DU_AN.md)
để biết cách deploy nhiều dự án trên cùng 1 VPS.
