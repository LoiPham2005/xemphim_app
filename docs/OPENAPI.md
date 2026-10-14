# Hướng dẫn sử dụng OpenAPI, Scalar UI & Code Generation cho Mobile (Flutter / Dart)

Tài liệu này hướng dẫn cách truy cập, xem tài liệu trực quan trên Web, Import vào Postman và **Tự động sinh mã nguồn (Code Gen) trọn gói cho Flutter/Dart** từ chuẩn **OpenAPI 3.1** của dự án.

---

## 1. Đường dẫn Endpoint OpenAPI & Docs

Khi ứng dụng đang chạy (`pnpm dev` hoặc `make dev`):

- **Trang giao diện trực quan (Dành cho Người xem & Test API trực tiếp):**  
  👉 `http://localhost:3000/docs` _(Giao diện Scalar UI hiện đại, mượt mà, hỗ trợ Dark/Light Mode)_
- **OpenAPI JSON Spec (Dành cho Postman / Tool Code Gen):**  
  👉 `http://localhost:3000/api/v1/openapi.json`
- **File sinh đặc tả từ Backend:** `src/lib/openapi/registry.ts` _(Tự động đồng bộ 100% với Zod Schema trong `src/schemas/*.ts`)_

---

## 2. Cách xem và kiểm thử nhanh (Test API)

### Cách 1: Xem và gọi thử trực tiếp trên Web (`/docs`)

1. Mở trình duyệt vào `http://localhost:3000/docs`.
2. Chọn bất kỳ API nào (ví dụ: `POST /api/v1/auth/login`).
3. Bấm **"Test Request"** / **"Send"** để gửi request trực tiếp trên trình duyệt.

---

### Cách 2: Import vào Postman / Insomnia (1 Click)

1. Mở **Postman** hoặc **Insomnia**.
2. Chọn nút **Import** ở góc trên bên trái.
3. Chọn tab **Link / URL** và dán:
   ```text
   http://localhost:3000/api/v1/openapi.json
   ```
4. Bấm **Import**. Postman sẽ tự động tạo một Collection gồm đầy đủ:
   - Toàn bộ danh sách Endpoint kèm HTTP Method (`GET`, `POST`, `PATCH`, `DELETE`).
   - Request Body mẫu (đầy đủ các trường validate bởi Zod).
   - Header `Authorization: Bearer <token>`.
   - Danh sách Status Code và Error response (`401`, `403`, `422`, `500`).

---

## 3. Tự động sinh mã nguồn (Code Gen) cho Flutter

Dự án hỗ trợ **2 phong cách sinh mã nguồn Client** tùy theo nhu cầu kiến trúc:

| Tiêu chí                 | Cách 1: Retrofit + Freezed (Khuyên dùng)                  | Cách 2: OpenAPI Generator CLI (`dart-dio`)     |
| :----------------------- | :-------------------------------------------------------- | :--------------------------------------------- |
| **Công cụ**              | `openapi_retrofit_generator`                              | `@openapitools/openapi-generator-cli`          |
| **Yêu cầu Java**         | ❌ **Không cần Java** (Chạy bằng Dart/Node thuần)         | ⚠️ **Bắt buộc Java 11+**                       |
| **Model**                | `@Freezed` + `json_serializable` (Khớp 100% Flutter Base) | `built_value` + `built_collection` + `one_of`  |
| **HTTP Client**          | `Retrofit` (`@RestApi`)                                   | Tự chế (`ApiClient` + `Dio`)                   |
| **Tích hợp DI/Riverpod** | Cực kỳ mượt mà (`ref.read(authApiProvider)`)              | Cần adapter chuyển đổi `BuiltList` sang `List` |
| **Cách chạy**            | 1 Lệnh tự động hoàn toàn                                  | Chạy lệnh CLI + `pub get` + `build_runner`     |

---

### 👉 CÁCH 1: Dùng Retrofit + Freezed + json_serializable (Khuyên Dùng Cho Dự Án Này)

Đây là cách tương thích hoàn hảo 100% với kiến trúc `flutter_base2` (Freezed, Retrofit, Riverpod).

#### 1. Chạy 1-Click — có hai cách, kết quả như nhau:

**Cách A — tool nằm trong repo Flutter** (`tools/gen_api.dart`, URL backend đặt ở `schemaUrl` đầu file):

- Đứng từ Backend (`xemphim`): `pnpm gen:flutter` (gọi sang `../flutter_base2`)
- Hoặc đứng từ Flutter (`flutter_base2`): `make gen-api` — PowerShell: `fvm dart run tools/gen_api.dart`

**Cách B — script do backend phục vụ**, đứng ở thư mục gốc dự án Flutter (dùng cho mọi app Flutter,
kể cả app không có tool nào). Script sinh code do **backend phục vụ** (`GET /api/flutter/gen_api.dart`, mã nguồn ở
`public/flutter/gen_api.dart`) — phía Flutter không giữ tool nào, và script luôn khớp với bản API
đang deploy. URL `openapi.json` của chính backend đã được điền sẵn vào script.

```bash
curl -fsSL https://<backend>/api/flutter/gen_api.dart -o .dart_tool/gen_api.dart && dart run .dart_tool/gen_api.dart
```

- `flutter_base2` bọc sẵn thành `make gen-api-server` (đổi backend: `make gen-api-server API=http://localhost:3000`).
- Tuỳ chọn: `--url <openapi.json>` trỏ sang backend khác, `--package <tên>` (mặc định `api_client`).
- Dự án có `.fvmrc` thì script tự gọi qua `fvm`; app không dùng `build_runner` thì bỏ qua bước cuối.
- Windows (PowerShell): `curl.exe -fsSL ... -o .dart_tool\gen_api.dart; dart run .dart_tool\gen_api.dart`

#### 2. Cấu hình tự động (`packages/api_client/openapi_generator.yaml`):

```yaml
openapi_generator:
  schema_url: http://localhost:3000/api/v1/openapi.json
  output_directory: lib/src
  json_serializer: freezed
```

#### 3. Quy trình tự động diễn ra:

1. Tải OpenAPI Spec từ `http://localhost:3000/api/v1/openapi.json`.
2. Sinh Models `@Freezed` và Service Retrofit `@RestApi`.
3. Tự động tạo file `lib/api_client.dart` export tất cả class.
4. Tự động chạy `build_runner` sinh `.freezed.dart` và `.g.dart`.
5. Tự động cập nhật Riverpod Providers (`api_client_provider.g.dart`).

#### 4. Cách gọi trong Flutter:

```dart
import 'package:api_client/api_client.dart';
import 'package:flutter_base2/core/base/di/api_client_provider.dart';

@riverpod
class LoginNotifier extends _$LoginNotifier {
  Future<void> submit(String identifier, String password) async {
    final authApi = ref.read(authApiProvider);
    final res = await authApi.postAuthLogin(
      body: LoginRequest(identifier: identifier, password: password),
    );
    print('Access Token: ${res.data?.accessToken}');
  }
}
```

---

### 👉 CÁCH 2: Dùng OpenAPI Generator CLI (`built_value` + `built_collection` + `one_of`)

Nếu bạn muốn dùng công cụ chính thức của tổ chức OpenAPI Tools ([openapi-generator](https://github.com/OpenAPITools/openapi-generator)):

#### 1. Yêu cầu môi trường:

- Máy tính phải cài đặt sẵn **Java Runtime Environment (JRE / JDK 11+)** (kiểm tra bằng `java -version`).
- `pnpm` hoặc `npx`.

#### 2. Lệnh sinh mã nguồn:

Mở terminal tại thư mục gốc backend `xemphim` (đảm bảo backend đang chạy `pnpm dev`):

- **Trên Linux / macOS (Bash / Zsh):**

  ```bash
  pnpm dlx @openapitools/openapi-generator-cli generate \
    -i http://localhost:3000/api/v1/openapi.json \
    -g dart-dio \
    -o ../flutter_base_v2/packages/api_client \
    --additional-properties=pubName=api_client
  ```

- **Trên Windows (PowerShell):**

  ```powershell
  pnpm dlx @openapitools/openapi-generator-cli generate `
    -i http://localhost:3000/api/v1/openapi.json `
    -g dart-dio `
    -o ../flutter_base_v2/packages/api_client `
    --additional-properties=pubName=api_client
  ```

- **Trên Windows (CMD):**
  ```cmd
  pnpm dlx @openapitools/openapi-generator-cli generate ^
    -i http://localhost:3000/api/v1/openapi.json ^
    -g dart-dio ^
    -o ../flutter_base_v2/packages/api_client ^
    --additional-properties=pubName=api_client
  ```

#### 3. Chạy build_runner cho package built_value:

Sau khi lệnh CLI chạy xong, chuyển vào thư mục package để sinh các file `.g.dart` của `built_value`:

```bash
cd ../flutter_base_v2/packages/api_client
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
```

#### 4. Cách gọi trong Flutter (BuiltValue):

```dart
import 'package:api_client/api_client.dart';

void main() async {
  final client = ApiClient(basePathOverride: 'http://localhost:3000');

  // Tạo request thông qua Builder của built_value
  final request = (LoginRequestBuilder()
    ..identifier = 'admin@example.com'
    ..password = '12345678'
  ).build();

  final res = await client.getAuthApi().postAuthLogin(loginRequest: request);
  print('Token: ${res.data?.data?.accessToken}');
}
```

---

## 4. Tự động sinh TypeScript Types (Dành cho Web Client / React / Vue)

Nếu bạn có một dự án Web Frontend khác muốn dùng chung API này:

```bash
pnpm dlx openapi-typescript http://localhost:3000/api/v1/openapi.json -o ./src/types/api-schema.d.ts
```

Lệnh này chạy giống nhau ở macOS, Linux và Windows vì nó nằm gọn trên một dòng.

---

## 5. Bảng tra cứu lỗi thường gặp khi sinh Code

| Thông báo bạn thấy                                             | Nguyên nhân                                                  | Cách khắc phục                                                |
| :------------------------------------------------------------- | :----------------------------------------------------------- | :------------------------------------------------------------ |
| `Error: Unable to access jarfile` / `'java' is not recognized` | Chưa cài Java khi chạy **Cách 2** (`dart-dio`).              | Cài JDK 17 hoặc chuyển sang dùng **Cách 1** (không cần Java). |
| `ECONNREFUSED` / `connect ECONNREFUSED 127.0.0.1:3000`         | Server Next.js chưa được bật.                                | Mở terminal chạy `pnpm dev` trước khi gen code.               |
| `404` khi tải `openapi.json`                                   | Sai đường dẫn spec.                                          | Kiểm tra lại URL phải có `/v1`: `/api/v1/openapi.json`.       |
| Sinh code xong nhưng thiếu endpoint mới                        | Đặc tả sinh tự động từ Zod Schema.                           | Khởi động lại `pnpm dev` rồi chạy lại lệnh gen.               |
| `InvalidOutputException` khi chạy `build_runner`               | Cache `.dart_tool/build` bị xung đột do xóa/tạo lại package. | Chạy `fvm dart run build_runner clean` rồi chạy lại lệnh.     |

---

## 6. Bảng tổng hợp các Endpoint REST API (`/api/v1/**`)

| Nhóm API     | Endpoint                            |   Quyền hạn   | Mô tả                                               |
| :----------- | :---------------------------------- | :-----------: | :-------------------------------------------------- |
| **Auth**     | `POST /api/v1/auth/register`        |    Public     | Đăng ký tài khoản mới                               |
|              | `POST /api/v1/auth/login`           |    Public     | Đăng nhập lấy access & refresh token                |
|              | `POST /api/v1/auth/refresh`         |    Public     | Cấp lại access token từ refresh token               |
|              | `GET /api/v1/auth/me`               | Bearer Token  | Lấy thông tin user hiện tại                         |
|              | `POST /api/v1/auth/change-password` | Bearer Token  | Đổi mật khẩu                                        |
|              | `POST /api/v1/auth/forgot-password` |    Public     | Yêu cầu gửi link đặt lại mật khẩu                   |
|              | `POST /api/v1/auth/reset-password`  |    Public     | Đặt lại mật khẩu với token                          |
|              | `POST /api/v1/auth/logout`          | Bearer Token  | Đăng xuất và thu hồi token                          |
| **Users**    | `GET /api/v1/users`                 |  `user:read`  | Lấy danh sách người dùng (hỗ trợ phân trang cursor) |
|              | `POST /api/v1/users`                | `user:create` | Tạo người dùng mới                                  |
|              | `GET /api/v1/users/[id]`            |  `user:read`  | Xem chi tiết người dùng                             |
|              | `DELETE /api/v1/users/[id]`         | `user:delete` | Xóa mềm người dùng                                  |
|              | `PATCH /api/v1/users/[id]/status`   | `user:update` | Khóa/Mở khóa tài khoản                              |
|              | `POST /api/v1/users/[id]/unlock`    | `user:update` | Mở khóa sớm tài khoản bị khóa tạm                   |
| **Hệ thống** | `GET /api/health`                   |    Public     | Kiểm tra sức khỏe hệ thống (Health check)           |
