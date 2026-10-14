-- ============================================================
-- TÌM KIẾM THEO TÊN / EMAIL — index trigram
-- ============================================================
--
-- `UserService.list()` tìm bằng `contains` + `mode: insensitive`, tức là
-- `ILIKE '%tu-khoa%'`. Dấu `%` ở ĐẦU chuỗi làm mọi index B-tree thông thường
-- trở nên vô dụng: Postgres buộc phải quét toàn bảng ở MỖI lần gõ vào ô tìm
-- kiếm. Vài nghìn dòng thì không ai thấy; vài trăm nghìn thì thấy ngay.
--
-- `pg_trgm` cắt chuỗi thành các cụm 3 ký tự và đánh index trên chúng, nên
-- `ILIKE '%…%'` dùng được index.
--
-- ============================================================
-- ⚠️ TÁCH THÀNH MIGRATION RIÊNG CÓ CHỦ ĐÍCH
-- ============================================================
--
-- `CREATE EXTENSION` cần quyền cao, và MỘT SỐ nhà cung cấp managed database
-- không cho phép (hoặc bắt bật tay trong bảng điều khiển của họ).
--
-- Nếu `prisma migrate deploy` báo lỗi ở đây:
--   • Neon / Supabase / RDS: bật `pg_trgm` trong bảng điều khiển rồi chạy lại.
--   • Không bật được: XOÁ CẢ THƯ MỤC migration này. Ứng dụng chạy bình thường,
--     chỉ là tìm kiếm quét bảng — chấp nhận được tới vài chục nghìn người dùng.
--
-- Để riêng như vậy thì một lần thất bại ở đây không kéo theo migration init.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_email_trgm_idx"
  ON "users" USING gin ("email" gin_trgm_ops);

CREATE INDEX "users_username_trgm_idx"
  ON "users" USING gin ("username" gin_trgm_ops);

CREATE INDEX "user_profiles_full_name_trgm_idx"
  ON "user_profiles" USING gin ("full_name" gin_trgm_ops);
