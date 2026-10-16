# Thiết lập máy phát triển mới

Tài liệu này dành cho người được mời vào repository private
`thuanvietdev/cong-van-hanh` và cần tải source về máy Windows hoặc macOS mới.

GitHub chỉ chứa source, migration và tài liệu an toàn. Repository **không chứa**
`.env`, mật khẩu PostgreSQL, token, dữ liệu Cloud SQL, cache build hoặc file nhập
có dữ liệu cá nhân.

## 1. Chủ repository cần cấp quyền

1. Mời đúng GitHub username của người nhận vào repository private. Repo thuộc tài
   khoản cá nhân nên GitHub cấp cho collaborator cả quyền pull và push; không có
   mức collaborator chỉ đọc. Nếu cần chỉ đọc, dùng deploy key read-only hoặc
   chuyển repo vào GitHub Organization để phân quyền chi tiết hơn.
2. Nếu cần chạy app với database dev, cấp quyền Google Cloud theo nguyên tắc tối
   thiểu. Tối thiểu thường cần quyền kết nối Cloud SQL; quyền đọc Secret Manager,
   Cloud Storage hoặc dịch vụ khác chỉ cấp khi đúng module họ phụ trách cần dùng.
3. Cung cấp `.env` dev bằng kênh bảo mật hoặc cho người nhận tự điền các secret
   dev được cấp riêng. Không gửi `.env` qua GitHub, commit, issue hoặc chat công khai.
4. Không cấp secret production chỉ để chạy local. Dùng tài khoản/database dev và
   thu hồi quyền khi không còn cộng tác.

## 2. Phần mềm cần cài trên máy mới

- Git và GitHub CLI (`gh`). Trên macOS có thể cài bằng Homebrew; trên Windows dùng
  Git for Windows và GitHub CLI.
- Node.js `22.16.0` và npm `10.9.2` là bộ phiên bản đã được xác minh với snapshot
  này. Next.js 16.2.11 yêu cầu tối thiểu Node.js 20.9.
- PowerShell 5.1 trở lên trên Windows; macOS dùng Bash có sẵn.
- Google Cloud CLI và Cloud SQL Auth Proxy v2 nếu cần dùng database dev.
- VS Code là tùy chọn. Nếu dùng VS Code, chọn **TypeScript: Use Workspace Version**.

Phiên bản Node khuyến nghị được ghi trong `.nvmrc`. Nếu dùng nvm:

```shell
nvm install 22.16.0
nvm use 22.16.0
node --version
npm --version
```

## 3. Clone và dựng dependency

Sau khi lời mời GitHub đã được chấp nhận, đăng nhập một lần:

```shell
gh auth login --web
```

Trên macOS, có thể clone và dựng toàn bộ source bằng đúng một lệnh:

```shell
(gh auth status >/dev/null 2>&1 || gh auth login --web) && gh repo clone thuanvietdev/cong-van-hanh && cd cong-van-hanh && npm run setup:local
```

Hoặc chạy từng bước trên Windows/macOS:

```shell
gh repo clone thuanvietdev/cong-van-hanh
cd cong-van-hanh
npm run setup:local
```

`setup:local` thực hiện các việc an toàn sau:

- kiểm tra Git, Node và npm;
- tạo `.env` từ `.env.example` nếu chưa có, không ghi đè `.env` hiện hữu;
- chạy `npm ci` đúng theo `package-lock.json`;
- sinh Prisma Client;
- chạy guard danh mục module và test phân quyền;
- báo các biến bắt buộc còn là placeholder mà không in giá trị secret.

`npm ci` có thể báo audit/deprecation từ dependency bắc cầu đang bị khóa trong
snapshot. Không chạy `npm audit fix --force` trong bước onboarding vì lệnh đó có
thể tự ý nâng major version và làm hỏng ứng dụng; xử lý nâng dependency bằng một
nhánh kiểm thử riêng.

Có thể chạy lại mà không cài dependency trên cả hai hệ điều hành:

```shell
npm run setup:local:quick
```

## 4. Cấu hình `.env`

Tối thiểu cần cấu hình:

| Biến | Mục đích |
| --- | --- |
| `DATABASE_URL` | Kết nối PostgreSQL dev, thường qua `127.0.0.1:5433` |
| `AUTH_SESSION_SECRET` | Ký session local, tối thiểu 32 ký tự ngẫu nhiên |
| `APP_URL` | Mặc định local là `http://localhost:3000` |
| `CONFIG_SECRET_ENCRYPTION_KEY` | Mã hóa secret cấu hình trong PostgreSQL |

Các biến tích hợp khác chỉ cần khi làm đúng module tương ứng. `.env.example` là
danh sách mẫu an toàn; tuyệt đối không thay placeholder bằng secret thật rồi commit.

## 5. Kết nối Google Cloud dev

Đăng nhập bằng tài khoản đã được chủ dự án cấp quyền:

```shell
gcloud auth login
gcloud auth application-default login
gcloud config set project tvg-ops-dev
```

Thêm `cloud-sql-proxy` vào `PATH`, hoặc khai báo đường dẫn tùy chỉnh. Windows còn
tự dò `C:\tools\cloud-sql-proxy\cloud-sql-proxy.x86.exe`.

Windows PowerShell:

```powershell
$env:CLOUD_SQL_PROXY_PATH = "D:\tools\cloud-sql-proxy.exe"
```

macOS:

```shell
export CLOUD_SQL_PROXY_PATH="$HOME/tools/cloud-sql-proxy"
```

`npm run dev:local` sẽ chọn `start-dev.ps1` hoặc `start-dev.sh`, tìm proxy và mở
kết nối:

```text
127.0.0.1:5433 -> tvg-ops-dev:asia-southeast1:tvg-postgres-dev
```

Không chạy migration, seed, import hoặc script có hậu tố `--apply` khi chưa xác
nhận đúng database dev và chưa được chủ dự án giao việc đó.

## 6. Chạy ứng dụng

```shell
npm run dev:local
```

Sau đó mở `http://localhost:3000`.

Nếu chỉ cần đọc code, chạy unit test hoặc build mà chưa được cấp Cloud SQL, có thể
bỏ qua proxy. Các màn hình cần database sẽ không hoạt động cho tới khi có kết nối.

Các lệnh xác minh cơ bản:

```shell
npm run check:deploy-modules
npm run test:permissions
npm run build
```

`npm run build` đã có prebuild guard để bảo toàn đủ module trên màn Services.

## 7. Cập nhật source sau này

```shell
git status
git pull --ff-only origin main
npm ci
npm run db:generate
```

Không dùng `git reset --hard` để xử lý thay đổi local chưa rõ nguồn gốc. Nếu cần
gửi code ngược lại, tạo branch riêng và pull request thay vì push thẳng `main`.

## 8. Accounting Worker tùy chọn

Chỉ cài Python worker khi phụ trách module Báo cáo Kế toán. Hướng dẫn nằm tại
`services/accounting-worker/README.md`; virtual environment `.venv` và file env
của worker không được commit.
