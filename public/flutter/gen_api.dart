import 'dart:io';

// SINH REST CLIENT FLUTTER TỪ BACKEND — file này do BACKEND phục vụ, phía Flutter không giữ bản nào.
//
// Chạy ở thư mục gốc dự án Flutter, chỉ một lệnh:
//
//   curl -fsSL <BACKEND>/api/flutter/gen_api.dart -o .dart_tool/gen_api.dart && dart run .dart_tool/gen_api.dart
//
// Tải qua `/api/flutter/gen_api.dart` thì URL OpenAPI của chính backend đó đã được điền sẵn, khỏi gõ.
// Tuỳ chọn: --url <openapi.json> (trỏ sang backend khác), --package <tên> (mặc định api_client).
// Có `.fvmrc` thì tự gọi qua fvm, không thì gọi thẳng `flutter`/`dart` trên PATH.
//
// Chỉ dùng dart:io — không cần `pub get` gì cho chính script này.

/// Backend thay chuỗi này bằng URL openapi.json của nó khi phục vụ file (xem route
/// `src/app/api/flutter/gen_api.dart` của xemphim). Tải bản tĩnh thì phải truyền `--url`.
const _defaultSchemaUrl = '__SCHEMA_URL__';

late final String schemaUrl;

/// Có `.fvmrc` / `.fvm` ở thư mục dự án -> chạy mọi lệnh qua `fvm` để đúng phiên bản Flutter của dự án.
late final bool _useFvm;

/// Script 1-click tự động sinh code REST Client (Retrofit + Freezed + json_serializable)
/// từ OpenAPI endpoint (hoặc openapi.json).
///
/// TỰ ĐỘNG:
/// - Tạo thư mục package (api_client hoặc api_client2) nếu chưa có
/// - Tự động ghi 3 file cấu hình: pubspec.yaml, build.yaml, openapi_generator.yaml
/// - Tự động chạy `flutter pub get` nếu package mới tạo
/// - Tự động chạy `openapi_retrofit_generator`
/// - Tự động tạo file barrel `lib/api_client.dart` (hoặc `lib/<packageName>.dart`)
/// - Tự động chạy `build_runner build` trong package và root app
void main(List<String> args) async {
  final stopwatch = Stopwatch()..start();
  print('======================================================');
  print('🚀 BẮT ĐẦU TỰ ĐỘNG SINH MÃ NGUỒN REST CLIENT CHO FLUTTER');
  print('   (OpenAPI -> Retrofit + Freezed + json_serializable)');
  print('======================================================\n');

  final rootDir = Directory.current;

  final rootPubspec = File('${rootDir.path}/pubspec.yaml');
  if (!rootPubspec.existsSync() ||
      !rootPubspec.readAsStringSync().contains('sdk: flutter')) {
    print(
      '❌ Hãy chạy lệnh ở THƯ MỤC GỐC dự án Flutter (nơi có pubspec.yaml của app).',
    );
    exit(64);
  }

  final opts = _parseArgs(args);
  final url =
      opts['url'] ??
      (_defaultSchemaUrl.startsWith('__') ? null : _defaultSchemaUrl);
  if (url == null || url.isEmpty) {
    print(
      '❌ Chưa biết lấy OpenAPI ở đâu. Tải script qua <BACKEND>/api/flutter/gen_api.dart '
      '(URL tự điền sẵn) hoặc truyền --url <BACKEND>/api/v1/openapi.json',
    );
    exit(64);
  }
  schemaUrl = url;
  _useFvm =
      File('${rootDir.path}/.fvmrc').existsSync() ||
      Directory('${rootDir.path}/.fvm').existsSync();
  print('🔗 OpenAPI: $schemaUrl${_useFvm ? '  (qua fvm)' : ''}\n');

  // Lấy tên package (mặc định là api_client hoặc thư mục bạn muốn ví dụ api_client2)
  final packageName = opts['package'] ?? 'api_client';
  final apiClientDir = Directory('${rootDir.path}/packages/$packageName');

  // 1. Tự động kiểm tra và khởi tạo thư mục packages/<packageName> & 3 file cấu hình
  final isNewPackage = await _ensureApiClientPackageStructure(
    apiClientDir,
    packageName,
  );

  // Tự động kiểm tra và thêm dependency vào pubspec.yaml của root app nếu chưa có
  final addedToRootPubspec = _ensureRootPubspecDependency(rootDir, packageName);
  // Package cần riverpod_annotation / riverpod_generator để sinh provider (lấy đúng phiên bản app đang dùng)
  final addedRiverpodDeps = _ensurePackageRiverpodDeps(rootDir, apiClientDir);

  if (isNewPackage || addedToRootPubspec || addedRiverpodDeps) {
    print('📦 Đang cài đặt dependencies cho packages/$packageName...');
    final pubGetClient = await _tool([
      'flutter',
      'pub',
      'get',
    ], workingDirectory: apiClientDir.path);
    if (pubGetClient != 0) {
      print('❌ Lỗi: flutter pub get trong packages/$packageName thất bại.');
      exit(pubGetClient);
    }

    print('📦 Đang liên kết packages/$packageName vào dự án chính...');
    await _tool(['flutter', 'pub', 'get'], workingDirectory: rootDir.path);
  }

  // 2. Chạy openapi_retrofit_generator
  await _checkSchemaReachable();
  final genStartedAt = DateTime.now().subtract(const Duration(seconds: 2));
  print('📦 [1/3] Đang tải OpenAPI Spec & sinh @Freezed + @RestApi...');
  final step1 = await _tool([
    'dart',
    'run',
    'openapi_retrofit_generator',
  ], workingDirectory: apiClientDir.path);
  if (step1 != 0) {
    print('❌ Lỗi ở bước 1: openapi_retrofit_generator thất bại.');
    print('💡 Gợi ý: Hãy đảm bảo backend đang chạy và mở được $schemaUrl');
    exit(step1);
  }
  // Generator gặp lỗi (mạng, spec hỏng...) vẫn thoát mã 0 kèm "completed with errors" -> tự kiểm có file mới.
  if (!_hasFreshSources(apiClientDir, genStartedAt)) {
    print(
      '❌ Lỗi ở bước 1: generator không sinh ra file nào trong packages/$packageName/lib/src (xem log phía trên).',
    );
    exit(1);
  }

  // Đổi tên field trùng tên annotation (`override`...) — phải chạy TRƯỚC build_runner
  _renameAnnotationShadowingFields(apiClientDir);

  // Tự động tạo / cập nhật file barrel lib/<packageName>.dart (và cả lib/api_client.dart)
  // Provider Riverpod gọi API — sinh vào package, TRƯỚC barrel để barrel export luôn.
  final hasProviders = _generateRiverpodProviders(rootDir, apiClientDir, packageName);
  // Hướng dẫn gọi API (API_USAGE.md) — bảng mọi endpoint, có cột Riverpod khi có sinh provider.
  _writeUsageDoc(apiClientDir, packageName, withRiverpod: hasProviders);
  if (hasProviders) {
    await _tool(['dart', 'format', 'lib/src/providers'], workingDirectory: apiClientDir.path);
  }

  _generateBarrelFile(apiClientDir, packageName);
  print('✅ [1/3] Hoàn tất sinh file giao diện API & Model.\n');

  // 3. Chạy build_runner trong packages/<packageName>
  print(
    '⚡ [2/3] Đang chạy build_runner trong packages/$packageName (.freezed.dart, .g.dart)...',
  );
  final step2 = await _tool([
    'dart',
    'run',
    'build_runner',
    'build',
    '--delete-conflicting-outputs',
  ], workingDirectory: apiClientDir.path);
  if (step2 != 0) {
    print('❌ Lỗi ở bước 2: build_runner trong packages/$packageName thất bại.');
    exit(step2);
  }
  print('✅ [2/3] Hoàn tất sinh code Serialization & Retrofit.\n');

  // 4. Chạy build_runner ở root app — chỉ khi app có dùng build_runner (vd. provider sinh bằng riverpod_generator).
  if (!rootPubspec.readAsStringSync().contains(
    RegExp(r'^\s*build_runner:', multiLine: true),
  )) {
    print('⏭️  [3/3] App gốc không dùng build_runner — bỏ qua.\n');
    _xong(stopwatch);
    return;
  }
  print(
    '🔄 [3/3] Đang chạy build_runner tại root app (cập nhật api_client_provider)...',
  );
  var step3 = await _tool([
    'dart',
    'run',
    'build_runner',
    'build',
    '--delete-conflicting-outputs',
  ], workingDirectory: rootDir.path);
  if (step3 != 0) {
    // Cache build của app gốc còn nhớ file cũ của package vừa bị xoá/sinh lại -> build_runner sập
    // ("InvalidOutputException ... Tried to delete from package not in the build"). Dọn cache, thử lại 1 lần.
    print('🧹 build_runner lỗi — dọn cache build của app rồi thử lại 1 lần...');
    await _tool([
      'dart',
      'run',
      'build_runner',
      'clean',
    ], workingDirectory: rootDir.path);
    step3 = await _tool([
      'dart',
      'run',
      'build_runner',
      'build',
      '--delete-conflicting-outputs',
    ], workingDirectory: rootDir.path);
  }
  if (step3 != 0) {
    print('❌ Lỗi ở bước 3: build_runner tại root app thất bại.');
    exit(step3);
  }
  print('✅ [3/3] Hoàn tất cập nhật DI Providers.\n');
  _xong(stopwatch);
}

void _xong(Stopwatch stopwatch) {
  stopwatch.stop();
  final elapsed = (stopwatch.elapsedMilliseconds / 1000).toStringAsFixed(2);
  print('======================================================');
  print('🎉 THÀNH CÔNG! Toàn bộ API Client & Freezed Model đã sẵn sàng.');
  print('⏱️  Thời gian thực hiện: ${elapsed}s');
  print('======================================================');
}

/// Tải thử spec TRƯỚC khi chạy generator — để lỗi mạng / sai URL báo rõ ngay, không trôi xuống bước sau.
Future<void> _checkSchemaReachable() async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
  try {
    final res = await (await client.getUrl(
      Uri.parse(schemaUrl),
    )).close().timeout(const Duration(seconds: 30));
    await res.drain<void>();
    if (res.statusCode != 200) {
      print(
        '❌ $schemaUrl trả HTTP ${res.statusCode} — sai URL hoặc backend chưa có endpoint này.',
      );
      exit(1);
    }
  } catch (e) {
    print('❌ Không tải được OpenAPI spec: $schemaUrl\n   $e');
    print(
      '💡 Kiểm tra backend đang chạy và URL đúng (APP_URL của backend, hoặc tham số --url).',
    );
    exit(1);
  } finally {
    client.close(force: true);
  }
}

/// Có file .dart nào trong lib/src vừa được (ghi) sau [since] không.
bool _hasFreshSources(Directory apiClientDir, DateTime since) {
  final src = Directory('${apiClientDir.path}/lib/src');
  if (!src.existsSync()) return false;
  return src
      .listSync(recursive: true)
      .whereType<File>()
      .any(
        (f) => f.path.endsWith('.dart') && f.statSync().modified.isAfter(since),
      );
}

/// Khởi tạo thư mục và ghi 3 file cấu hình nếu chưa có
Future<bool> _ensureApiClientPackageStructure(
  Directory apiClientDir,
  String packageName,
) async {
  bool isNew = false;
  if (!apiClientDir.existsSync()) {
    print('📁 Đang tạo mới thư mục: ${apiClientDir.path}...');
    apiClientDir.createSync(recursive: true);
    isNew = true;
  }

  // 1. File pubspec.yaml
  final pubspecFile = File('${apiClientDir.path}/pubspec.yaml');
  if (!pubspecFile.existsSync()) {
    print('📝 [Auto-Gen] Tạo file packages/$packageName/pubspec.yaml...');
    pubspecFile.writeAsStringSync('''name: $packageName
version: 1.0.0
description: Client REST cho xemphim, sinh từ /api/v1/openapi.json bằng openapi_retrofit_generator
homepage: homepage

environment:
  sdk: ^3.9.0

dependencies:
  dio: ^5.8.0+1
  retrofit: ^4.9.2
  json_annotation: ^4.9.0
  freezed_annotation: ^3.1.0

dev_dependencies:
  openapi_retrofit_generator: ^2.0.4
  build_runner: ^2.4.12
  json_serializable: ^6.8.0
  freezed: ^3.2.3
  retrofit_generator: ^10.2.5
''');
    isNew = true;
  }

  // 2. File openapi_generator.yaml
  final openapiConfigFile = File('${apiClientDir.path}/openapi_generator.yaml');
  if (openapiConfigFile.existsSync()) {
    final content = openapiConfigFile.readAsStringSync();
    final updated = content.replaceFirstMapped(
      RegExp(r'^(\s*schema_url:).*$', multiLine: true),
      (m) => '${m[1]} $schemaUrl',
    );
    if (updated != content) {
      openapiConfigFile.writeAsStringSync(updated);
      print('📝 [Auto-Gen] Cập nhật schema_url → $schemaUrl');
    }
  } else {
    print(
      '📝 [Auto-Gen] Tạo file packages/$packageName/openapi_generator.yaml...',
    );
    openapiConfigFile.writeAsStringSync('''openapi_generator:
  schema_url: $schemaUrl
  output_directory: lib/src
  json_serializer: freezed
''');
  }

  // 3. File build.yaml
  final buildYamlFile = File('${apiClientDir.path}/build.yaml');
  if (!buildYamlFile.existsSync()) {
    print('📝 [Auto-Gen] Tạo file packages/$packageName/build.yaml...');
    buildYamlFile.writeAsStringSync('''global_options:
  freezed:
    runs_before:
      - json_serializable
  json_serializable:
    runs_before:
      - retrofit_generator
''');
  }

  // 4. File .gitignore
  final gitignoreFile = File('${apiClientDir.path}/.gitignore');
  if (!gitignoreFile.existsSync()) {
    print('📝 [Auto-Gen] Tạo file packages/$packageName/.gitignore...');
    gitignoreFile.writeAsStringSync('''# Generated code
**/*.freezed.dart
**/*.g.dart
.dart_tool/
pubspec.lock
build/
''');
  }

  // Kiểm tra .dart_tool
  final dartToolDir = Directory('${apiClientDir.path}/.dart_tool');
  if (!dartToolDir.existsSync()) {
    isNew = true;
  }

  return isNew;
}

/// Field JSON trùng tên annotation của Dart (`override`, `deprecated`) làm hỏng build_runner.
///
/// Freezed sinh field `override` trong class, mà getter của class đó đều gắn `@override` — Dart
/// hiểu `@override` là field vừa sinh chứ không phải annotation của dart:core, nên
/// json_serializable báo "Could not resolve annotation for `String key`". Gặp thật với
/// `PermissionExplanation.override` của xemphim (GET /users/{id}/permissions).
///
/// Đổi tên field trong Dart thành `<tên>Value`, giữ nguyên tên trên JSON bằng `@JsonKey(name:)`.
/// Làm ở đây chứ không sửa tay file model: file đó bị generator ghi đè mỗi lần chạy.
const _annotationNames = ['override', 'deprecated'];

void _renameAnnotationShadowingFields(Directory apiClientDir) {
  final modelsDir = Directory('${apiClientDir.path}/lib/src');
  if (!modelsDir.existsSync()) return;

  final field = RegExp(
    r'^(\s*)(required )?([A-Za-z0-9_<>?, ]+?) (' +
        _annotationNames.join('|') +
        r'),\s*$',
    multiLine: true,
  );

  for (final file in modelsDir.listSync(recursive: true).whereType<File>()) {
    final path = file.path;
    if (!path.endsWith('.dart') ||
        path.endsWith('.g.dart') ||
        path.endsWith('.freezed.dart')) {
      continue;
    }
    final content = file.readAsStringSync();
    final updated = content.replaceAllMapped(
      field,
      (m) =>
          "${m[1]}@JsonKey(name: '${m[4]}') ${m[2] ?? ''}${m[3]} ${m[4]}Value,",
    );
    if (updated != content) {
      file.writeAsStringSync(updated);
      print(
        '🩹 [Auto-Fix] Đổi field trùng tên annotation trong ${path.split('/').last}',
      );
    }
  }
}

/// Tự động quét toàn bộ file trong lib/src và tạo file barrel xuất khẩu
void _generateBarrelFile(Directory apiClientDir, String packageName) {
  final srcDir = Directory('${apiClientDir.path}/lib/src');
  if (!srcDir.existsSync()) return;

  final files = srcDir
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .where(
        (f) => !f.path.endsWith('.freezed.dart') && !f.path.endsWith('.g.dart'),
      )
      .toList();

  files.sort((a, b) => a.path.compareTo(b.path));

  final libPath = '${apiClientDir.path}/lib'.replaceAll('\\', '/');

  final buffer = StringBuffer();
  buffer.writeln(
    '/// Client REST cho xemphim — sinh từ /api/v1/openapi.json.',
  );
  buffer.writeln('///');
  buffer.writeln('/// Điểm vào duy nhất nên import: `RestClient`.');
  buffer.writeln('/// Cách gọi (Retrofit / Riverpod) + bảng mọi endpoint: xem `API_USAGE.md` ở gốc package.');
  buffer.writeln('library;\n');

  for (final file in files) {
    final normalizedPath = file.path.replaceAll('\\', '/');
    if (normalizedPath.startsWith('$libPath/')) {
      final relative = normalizedPath.substring('$libPath/'.length);
      buffer.writeln("export '$relative';");
    }
  }

  final libDir = Directory('${apiClientDir.path}/lib');
  if (!libDir.existsSync()) {
    libDir.createSync(recursive: true);
  }

  // Ghi file theo tên package (ví dụ: api_client.dart hoặc api_client2.dart)
  final barrelFile = File('${apiClientDir.path}/lib/$packageName.dart');
  barrelFile.writeAsStringSync(buffer.toString());

  // Nếu package là api_client2 hay tên khác, vẫn ghi thêm api_client.dart nếu cần để tương thích
  if (packageName != 'api_client') {
    final defaultBarrel = File('${apiClientDir.path}/lib/api_client.dart');
    defaultBarrel.writeAsStringSync(buffer.toString());
  }

  print('📄 [Auto-Gen] Đã tự động tạo file export: ${barrelFile.path}');
}

/// Tự động thêm `api_client` (hoặc tên package tuỳ chỉnh) vào pubspec.yaml của root app nếu chưa có
bool _ensureRootPubspecDependency(Directory rootDir, String packageName) {
  final rootPubspecFile = File('${rootDir.path}/pubspec.yaml');
  if (!rootPubspecFile.existsSync()) return false;

  final content = rootPubspecFile.readAsStringSync();
  final depPattern = RegExp(
    r'^\s*' + RegExp.escape(packageName) + r':',
    multiLine: true,
  );

  if (depPattern.hasMatch(content)) {
    return false; // Đã có rồi, không cần thêm
  }

  print(
    '📝 [Auto-Gen] Đang tự động thêm `$packageName` vào pubspec.yaml chính...',
  );

  // Tìm vị trí `dev_dependencies:` hoặc cuối khối `dependencies:` để chèn vào
  final devDepIndex = content.indexOf('dev_dependencies:');
  String updatedContent;

  final snippet = '\n  $packageName:\n    path: packages/$packageName\n\n';

  if (devDepIndex != -1) {
    updatedContent =
        content.substring(0, devDepIndex) +
        snippet +
        content.substring(devDepIndex);
  } else {
    updatedContent = content + snippet;
  }

  rootPubspecFile.writeAsStringSync(updatedContent);
  print(
    '✅ [Auto-Gen] Đã chèn `$packageName` (path: packages/$packageName) vào pubspec.yaml!',
  );
  return true;
}

/// `--url x`, `--url=x`, `--package x`; một tham số trơn (không `--`) = tên package (giữ cách gọi cũ).
Map<String, String> _parseArgs(List<String> args) {
  final out = <String, String>{};
  for (var i = 0; i < args.length; i++) {
    final a = args[i];
    if (a.startsWith('--')) {
      final eq = a.indexOf('=');
      if (eq > 0) {
        out[a.substring(2, eq)] = a.substring(eq + 1);
      } else if (i + 1 < args.length) {
        out[a.substring(2)] = args[++i];
      }
    } else {
      out['package'] = a;
    }
  }
  return out;
}

/// `flutter ...` / `dart ...` — qua fvm nếu dự án dùng fvm.
Future<int> _tool(List<String> command, {required String workingDirectory}) =>
    _useFvm
    ? _runCommand('fvm', command, workingDirectory: workingDirectory)
    : _runCommand(
        command.first,
        command.sublist(1),
        workingDirectory: workingDirectory,
      );

Future<int> _runCommand(
  String executable,
  List<String> arguments, {
  required String workingDirectory,
}) async {
  final isWindows = Platform.isWindows;
  final process = await Process.start(
    executable,
    arguments,
    workingDirectory: workingDirectory,
    runInShell: isWindows,
    mode: ProcessStartMode.inheritStdio,
  );
  return process.exitCode;
}

// ── Sinh provider Riverpod gọi API ─────────────────────────────────────────────
//
// Đọc các `src/<nhóm>/<nhóm>_client.dart` vừa sinh, viết vào CHÍNH package (`lib/src/providers/`) — không phụ
// thuộc gì vào app, dự án Flutter nào dùng package cũng có:
//   - `restClientProvider`: app ghi đè MỘT lần ở ProviderContainer/ProviderScope gốc (Dio của app: token, interceptor...).
//   - GET  -> `@riverpod Future<T> getXxx(Ref ref, {...})` (family theo tham số) -> `ref.watch(getXxxProvider(...))`.
//   - Ghi  -> `@Riverpod(keepAlive: true) class <Nhóm>Actions` (state = đang chạy / lỗi), lỗi thì ném lại cho nơi
//            gọi (vd. bọc trong `runMutation` của app); thành công thì làm mới mọi provider GET cùng nhóm.
// Thư mục này do script sở hữu: mỗi lần chạy xoá đi sinh lại — đừng sửa tay.

/// Kiểu không băm được / không đáng làm khoá family -> GET có tham số này thì bỏ qua.
const _unsupportedReadTypes = ['MultipartFile', 'CancelToken', 'ProgressCallback', 'File'];

/// App có dùng Riverpod codegen không (đọc pubspec.yaml gốc) — không thì bỏ hẳn phần sinh provider.
bool _appUsesRiverpod(Directory rootDir) {
  final pubspec = File('${rootDir.path}/pubspec.yaml');
  return pubspec.existsSync() &&
      pubspec.readAsStringSync().contains(RegExp(r'^\s+riverpod_generator:', multiLine: true));
}

/// Thêm riverpod_annotation / riverpod_generator vào pubspec của package, lấy ĐÚNG ràng buộc phiên bản app gốc
/// đang dùng (để hai bên giải cùng một bộ). Trả về true nếu có sửa -> cần `pub get`.
bool _ensurePackageRiverpodDeps(Directory rootDir, Directory apiClientDir) {
  if (!_appUsesRiverpod(rootDir)) return false;
  final rootText = File('${rootDir.path}/pubspec.yaml').readAsStringSync();
  final file = File('${apiClientDir.path}/pubspec.yaml');
  var text = file.readAsStringSync();
  var changed = false;

  String constraintOf(String dep, String fallback) {
    final m = RegExp('^\\s+$dep:\\s*([^#\\n]+)', multiLine: true).firstMatch(rootText);
    return m?.group(1)?.trim() ?? fallback;
  }

  void add(String section, String dep, String fallback) {
    if (RegExp('^\\s+$dep:', multiLine: true).hasMatch(text)) return;
    final header = RegExp('^$section:[ \\t]*\\n', multiLine: true).firstMatch(text);
    final line = '  $dep: ${constraintOf(dep, fallback)}\n';
    text = header == null
        ? '${text.trimRight()}\n\n$section:\n$line'
        : text.replaceRange(header.end, header.end, line);
    changed = true;
  }

  add('dependencies', 'riverpod_annotation', '^4.0.2');
  add('dev_dependencies', 'riverpod_generator', '^4.0.3');
  if (changed) {
    file.writeAsStringSync(text);
    print('📝 Đã thêm riverpod_annotation / riverpod_generator vào packages/${apiClientDir.uri.pathSegments.where((s) => s.isNotEmpty).last}/pubspec.yaml');
  }
  return changed;
}

class _ApiParam {
  _ApiParam(this.name, this.type, this.isRequired, this.defaultValue);

  final String name;
  final String type;
  final bool isRequired;
  final String? defaultValue;

  String get declaration =>
      '${isRequired ? 'required ' : ''}$type $name${defaultValue != null ? ' = $defaultValue' : ''}';
}

class _ApiMethod {
  _ApiMethod(this.verb, this.path, this.name, this.returnType, this.params, this.named, this.doc);

  final String verb;
  final String path;
  final String name;
  final String returnType;
  final List<_ApiParam> params;
  final bool named;
  final String? doc;

  String get callArgs =>
      params.map((p) => named ? '${p.name}: ${p.name}' : p.name).join(', ');

  String get declaration {
    if (params.isEmpty) return '';
    if (named) return '{${params.map((p) => p.declaration).join(', ')}}';
    return params.map((p) => '${p.type} ${p.name}').join(', ');
  }
}

/// Sinh `lib/src/providers/` trong package. Trả về true nếu có sinh (để chạy `dart format`).
bool _generateRiverpodProviders(Directory rootDir, Directory apiClientDir, String packageName) {
  final outDir = Directory('${apiClientDir.path}/lib/src/providers');
  if (outDir.existsSync()) outDir.deleteSync(recursive: true);
  if (!_appUsesRiverpod(rootDir)) {
    print('⏭️  Bỏ qua sinh provider Riverpod: app chưa dùng riverpod_generator.\n');
    return false;
  }

  // Nhóm -> getter trên RestClient (vd. OAuthClient -> oAuth).
  final restClient = File('${apiClientDir.path}/lib/src/rest_client.dart');
  final getters = <String, String>{
    for (final m in RegExp(r'(\w+Client)\s+get\s+(\w+)\s*=>')
        .allMatches(restClient.existsSync() ? restClient.readAsStringSync() : ''))
      m.group(1)!: m.group(2)!,
  };
  if (getters.isEmpty) {
    print('⏭️  Bỏ qua sinh provider Riverpod: không đọc được lib/src/rest_client.dart.\n');
    return false;
  }

  final clientFiles = Directory('${apiClientDir.path}/lib/src')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('_client.dart') && !f.path.endsWith('rest_client.dart'))
      .toList()
    ..sort((a, b) => a.path.compareTo(b.path));

  outDir.createSync(recursive: true);
  const header = '// GENERATED CODE - DO NOT MODIFY BY HAND\n'
      '// Sinh bởi gen_api.dart — chạy lại `make gen-api` là bị ghi đè.\n'
      '// ignore_for_file: type=lint\n';

  File('${outDir.path}/rest_client_provider.dart').writeAsStringSync('''
$header
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../rest_client.dart';

part 'rest_client_provider.g.dart';

/// `RestClient` mà mọi provider sinh sẵn dùng. App GHI ĐÈ một lần ở ProviderContainer/ProviderScope gốc,
/// trỏ về Dio của app (base URL, token, interceptor...):
///
/// ```dart
/// overrides: [restClientProvider.overrideWith((ref) => RestClient(ref.read(dioProvider)))]
/// ```
@Riverpod(keepAlive: true)
RestClient restClient(Ref ref) => throw UnimplementedError(
  'Chưa ghi đè restClientProvider — thêm restClientProvider.overrideWith(...) vào ProviderContainer/ProviderScope gốc của app.',
);
''');

  final usedNames = <String>{};
  var reads = 0, writes = 0;
  final skipped = <String>[];

  for (final file in clientFiles) {
    final source = file.readAsStringSync();
    final clientClass = RegExp(r'abstract class (\w+)').firstMatch(source)?.group(1);
    final getter = clientClass == null ? null : getters[clientClass];
    if (clientClass == null || getter == null) continue;

    final methods = _parseClientMethods(source);
    final readMethods = <_ApiMethod>[];
    final writeMethods = <_ApiMethod>[];
    for (final m in methods) {
      if (m.verb != 'GET') {
        writeMethods.add(m);
      } else if (m.params.any((p) => _unsupportedReadTypes.any(p.type.contains))) {
        skipped.add('$getter.${m.name}');
      } else {
        readMethods.add(m);
      }
    }
    if (readMethods.isEmpty && writeMethods.isEmpty) continue;

    final group = file.uri.pathSegments.last.replaceFirst(RegExp(r'_client\.dart$'), '');
    final groupPascal = clientClass.replaceFirst(RegExp(r'Client$'), '');
    String uniqueName(String name) {
      final n = usedNames.contains(name) ? '$getter${name[0].toUpperCase()}${name.substring(1)}' : name;
      usedNames.add(n);
      return n;
    }

    String docOf(_ApiMethod m, String fallback) => '/// ${m.doc ?? fallback}';

    final needsDio = methods.any((m) => m.params.any((p) => p.type.contains('MultipartFile')));
    final b = StringBuffer()..writeln(header);
    // FutureOr cho build() đồng bộ: Actions sẵn sàng (AsyncData) ngay, không loading một nhịp lúc mới tạo.
    if (writeMethods.isNotEmpty) b..writeln("import 'dart:async';")..writeln();
    if (needsDio) b.writeln("import 'package:dio/dio.dart' show MultipartFile;");
    b
      ..writeln("import 'package:$packageName/$packageName.dart';")
      ..writeln("import 'package:riverpod_annotation/riverpod_annotation.dart';")
      ..writeln()
      ..writeln("part '${group}_providers.g.dart';")
      ..writeln();

    final providerNames = <String>[];
    for (final m in readMethods) {
      final name = uniqueName(m.name);
      providerNames.add('${name}Provider');
      final params = m.declaration;
      b
        ..writeln(docOf(m, 'GET — `$getter.${m.name}`.'))
        ..writeln('@riverpod')
        ..writeln('Future<${m.returnType}> $name(Ref ref${params.isEmpty ? '' : ', $params'}) =>')
        ..writeln('    ref.watch(restClientProvider).$getter.${m.name}(${m.callArgs});')
        ..writeln();
      reads++;
    }

    if (writeMethods.isNotEmpty) {
      final actions = '${groupPascal}Actions';
      final actionsProvider = '${actions[0].toLowerCase()}${actions.substring(1)}Provider';
      b
        ..writeln('/// Thao tác GHI nhóm `$getter`. State = đang chạy / lỗi của lần gọi gần nhất; lỗi được NÉM LẠI cho')
        ..writeln('/// nơi gọi. Thành công thì làm mới mọi provider GET của nhóm.')
        ..writeln('///')
        ..writeln('/// `await ref.read($actionsProvider.notifier).<method>(...)`')
        ..writeln('@Riverpod(keepAlive: true)')
        ..writeln('class $actions extends _\$$actions {')
        ..writeln('  @override')
        ..writeln('  FutureOr<void> build() {}')
        ..writeln()
        ..writeln('  $clientClass get _api => ref.read(restClientProvider).$getter;')
        ..writeln()
        ..writeln('  Future<R> _run<R>(Future<R> Function() call) async {')
        ..writeln('    state = const AsyncLoading();')
        ..writeln('    try {')
        ..writeln('      final result = await call();')
        ..writeln('      if (ref.mounted) {')
        ..writeln('        state = const AsyncData(null);');
      for (final p in providerNames) {
        b.writeln('        ref.invalidate($p);');
      }
      b
        ..writeln('      }')
        ..writeln('      return result;')
        ..writeln('    } catch (e, st) {')
        ..writeln('      if (ref.mounted) state = AsyncError(e, st);')
        ..writeln('      rethrow;')
        ..writeln('    }')
        ..writeln('  }')
        ..writeln();
      for (final m in writeMethods) {
        b
          ..writeln('  ${docOf(m, '${m.verb} — `$getter.${m.name}`.')}')
          ..writeln('  Future<${m.returnType}> ${m.name}(${m.declaration}) =>')
          ..writeln('      _run(() => _api.${m.name}(${m.callArgs}));')
          ..writeln();
        writes++;
      }
      b.writeln('}');
    }

    File('${outDir.path}/${group}_providers.dart').writeAsStringSync(b.toString());
  }

  print('🧩 Đã sinh provider Riverpod vào packages/$packageName/lib/src/providers: $reads GET, $writes thao tác ghi.');
  if (skipped.isNotEmpty) {
    print('   Bỏ qua GET có tham số không làm khoá được: ${skipped.join(', ')}');
  }
  print('   Nhớ ghi đè restClientProvider một lần ở ProviderContainer/ProviderScope gốc của app.\n');
  return true;
}

List<_ApiMethod> _parseClientMethods(String source) {
  final re = RegExp(
    r"((?:[ \t]*///[^\n]*\n)*)[ \t]*@(GET|POST|PUT|PATCH|DELETE)\(\s*'([^']*)'[^\n]*\)[ \t]*\n"
    r'(?:[ \t]*@\w+(?:\([^\n]*\))?[ \t]*\n)*'
    r'[ \t]*Future<(.+?)>\s+(\w+)\((.*?)\);',
    dotAll: true,
  );
  final result = <_ApiMethod>[];
  for (final m in re.allMatches(source)) {
    final doc = m
        .group(1)!
        .split('\n')
        .map((l) => l.trim().replaceFirst(RegExp(r'^///\s?'), '').trim())
        .firstWhere((l) => l.isNotEmpty && !l.startsWith('['), orElse: () => '');
    var raw = m.group(6)!.trim();
    final named = raw.startsWith('{');
    if (named || raw.startsWith('[')) raw = raw.substring(1, raw.length - 1);
    final params = <_ApiParam>[];
    for (var p in _splitTopLevel(raw)) {
      p = p.replaceAll(RegExp(r'@\w+(\((?:[^()]|\([^()]*\))*\))?'), '').trim();
      if (p.isEmpty) continue;
      final isRequired = p.startsWith('required ');
      if (isRequired) p = p.substring('required '.length).trim();
      String? defaultValue;
      final eq = p.indexOf('=');
      if (eq != -1) {
        defaultValue = p.substring(eq + 1).trim();
        p = p.substring(0, eq).trim();
      }
      final space = p.lastIndexOf(RegExp(r'\s'));
      if (space == -1) continue;
      params.add(_ApiParam(p.substring(space + 1), p.substring(0, space).trim(), isRequired, defaultValue));
    }
    result.add(_ApiMethod(m.group(2)!, m.group(3)!, m.group(5)!, m.group(4)!.trim(), params, named, doc.isEmpty ? null : doc));
  }
  return result;
}

/// Tách theo dấu phẩy ở cấp ngoài cùng (bỏ qua phẩy trong `Map<String, int>`, `@Part(name: 'a')`...).
List<String> _splitTopLevel(String s) {
  final parts = <String>[];
  var depth = 0, start = 0;
  String? quote;
  for (var i = 0; i < s.length; i++) {
    final c = s[i];
    if (quote != null) {
      if (c == quote) quote = null;
      continue;
    }
    if (c == "'" || c == '"') {
      quote = c;
    } else if ('<([{'.contains(c)) {
      depth++;
    } else if ('>)]}'.contains(c)) {
      depth--;
    } else if (c == ',' && depth == 0) {
      parts.add(s.substring(start, i));
      start = i + 1;
    }
  }
  parts.add(s.substring(start));
  return parts.map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
}

// ── Tài liệu cách gọi API ──────────────────────────────────────────────────────

/// Ghi `API_USAGE.md` ở gốc package: cách gọi (Retrofit thẳng / provider Riverpod) + bảng MỌI endpoint với đúng tên
/// method, tham số, kiểu trả về — người hay AI nhìn vào là biết gọi gì, khỏi đọc lại source sinh ra.
void _writeUsageDoc(Directory apiClientDir, String packageName, {required bool withRiverpod}) {
  final restClient = File('${apiClientDir.path}/lib/src/rest_client.dart');
  if (!restClient.existsSync()) return;
  final getters = <String, String>{
    for (final m in RegExp(r'(\w+Client)\s+get\s+(\w+)\s*=>').allMatches(restClient.readAsStringSync()))
      m.group(1)!: m.group(2)!,
  };
  final clientFiles = Directory('${apiClientDir.path}/lib/src')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('_client.dart') && !f.path.endsWith('rest_client.dart'))
      .toList()
    ..sort((a, b) => a.path.compareTo(b.path));

  String cell(String s) => s.replaceAll('|', r'\|').replaceAll('\n', ' ');
  String code(String s) => s.isEmpty ? '' : '`${cell(s)}`';

  final b = StringBuffer()
    ..writeln('# $packageName — cách gọi API')
    ..writeln()
    ..writeln('> SINH TỰ ĐỘNG bởi `gen_api.dart` (`make gen-api`) — đừng sửa tay, chạy lại là bị ghi đè.')
    ..writeln('> Tên method / tham số / kiểu trả về dưới đây khớp đúng code sinh ra: tra ở đây, không cần mở `lib/src`.')
    ..writeln()
    ..writeln('```dart')
    ..writeln("import 'package:$packageName/$packageName.dart';")
    ..writeln('```')
    ..writeln()
    ..writeln('## 1. Gọi thẳng Retrofit (không cần Riverpod — Bloc, GetX, StatefulWidget... đều dùng được)')
    ..writeln()
    ..writeln('```dart')
    ..writeln('final api = RestClient(dio); // Dio của app: base URL, token, interceptor')
    ..writeln('final res = await api.users.getUsers(page: 1, limit: 20);')
    ..writeln('```')
    ..writeln()
    ..writeln('Lỗi HTTP ném `DioException`. Kiểu trả về là model Freezed, đã giải mã sẵn.')
    ..writeln();

  if (withRiverpod) {
    b
      ..writeln('## 2. Riverpod (provider sinh sẵn trong `lib/src/providers/`)')
      ..writeln()
      ..writeln('**Nối Dio một lần** ở ProviderContainer/ProviderScope gốc (thiếu là báo `UnimplementedError`):')
      ..writeln()
      ..writeln('```dart')
      ..writeln('overrides: [restClientProvider.overrideWith((ref) => RestClient(ref.read(dioProvider)))]')
      ..writeln('```')
      ..writeln()
      ..writeln('**Đọc (GET)** — mỗi endpoint một provider `get...Provider`, family theo tham số, autoDispose:')
      ..writeln()
      ..writeln('```dart')
      ..writeln('final users = ref.watch(getUsersProvider(page: 1, limit: 20)); // AsyncValue<UsersListResponse>')
      ..writeln('ref.invalidate(getUsersProvider);                                // tải lại mọi trang')
      ..writeln('final user = await ref.read(getUsersIdProvider(id: id).future);  // lấy 1 lần trong code')
      ..writeln('```')
      ..writeln()
      ..writeln('**Ghi (POST/PUT/PATCH/DELETE)** — mỗi nhóm một `<Nhóm>Actions` (keepAlive):')
      ..writeln()
      ..writeln('```dart')
      ..writeln('await ref.read(usersActionsProvider.notifier).deleteUsersId(id: id);')
      ..writeln('final busy = ref.watch(usersActionsProvider).isLoading; // đang ghi?')
      ..writeln('```')
      ..writeln()
      ..writeln('- Thành công → tự `invalidate` mọi provider GET **cùng nhóm** (danh sách tự tải lại).')
      ..writeln('- Lỗi → **ném lại** cho nơi gọi (bắt bằng try/catch, hoặc bọc trong `runMutation` của notifier app).')
      ..writeln()
      ..writeln('```dart')
      ..writeln('// Trong notifier có BaseNotifier (toast tự động, cập nhật lạc quan):')
      ..writeln('Future<void> delete(String id) => runMutation(')
      ..writeln('  action: () => ref.read(usersActionsProvider.notifier).deleteUsersId(id: id),')
      ..writeln("  successMessage: 'Đã xoá',")
      ..writeln(');')
      ..writeln('```')
      ..writeln();
  }

  b
    ..writeln('## ${withRiverpod ? 3 : 2}. Danh sách endpoint')
    ..writeln()
    ..writeln('Tham số ghi đúng chữ ký Dart (`required` = bắt buộc, `= x` = mặc định). '
        'Retrofit: `api.<nhóm>.<method>(...)`.')
    ..writeln();

  final usedNames = <String>{};
  for (final file in clientFiles) {
    final source = file.readAsStringSync();
    final clientClass = RegExp(r'abstract class (\w+)').firstMatch(source)?.group(1);
    final getter = clientClass == null ? null : getters[clientClass];
    if (clientClass == null || getter == null) continue;
    final methods = _parseClientMethods(source);
    if (methods.isEmpty) continue;

    final actions = '${clientClass.replaceFirst(RegExp(r'Client$'), '')}Actions';
    final actionsProvider = '${actions[0].toLowerCase()}${actions.substring(1)}Provider';
    final hasWrites = methods.any((m) => m.verb != 'GET');
    b
      ..writeln('### `$getter` — `api.$getter`'
          '${withRiverpod && hasWrites ? ' · ghi: `$actionsProvider.notifier`' : ''}')
      ..writeln()
      ..writeln(withRiverpod
          ? '| HTTP | Path | Mô tả | Method | Tham số | Trả về | Riverpod |'
          : '| HTTP | Path | Mô tả | Method | Tham số | Trả về |')
      ..writeln(withRiverpod ? '|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|');
    for (final m in methods) {
      var riverpod = '';
      if (withRiverpod) {
        if (m.verb != 'GET') {
          riverpod = 'Actions.${m.name}';
        } else if (m.params.any((p) => _unsupportedReadTypes.any(p.type.contains))) {
          riverpod = '(chỉ Retrofit)';
        } else {
          // Cùng luật đặt tên với _generateRiverpodProviders: trùng tên giữa các nhóm thì thêm tiền tố nhóm.
          final n = usedNames.contains(m.name) ? '$getter${m.name[0].toUpperCase()}${m.name.substring(1)}' : m.name;
          usedNames.add(n);
          riverpod = '${n}Provider';
        }
      }
      final row = [
        m.verb,
        code(m.path),
        cell(m.doc ?? ''),
        code(m.name),
        code(m.declaration),
        code(m.returnType),
        if (withRiverpod) riverpod.startsWith('(') ? riverpod : code(riverpod),
      ];
      b.writeln('| ${row.join(' | ')} |');
    }
    b.writeln();
  }

  File('${apiClientDir.path}/API_USAGE.md').writeAsStringSync(b.toString());
  print('📘 Đã ghi hướng dẫn gọi API: packages/$packageName/API_USAGE.md');
}
