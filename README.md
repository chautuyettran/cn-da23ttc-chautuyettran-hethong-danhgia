# Hệ thống đánh giá chất lượng giảng dạy và phản hồi

Ứng dụng tiếng Việt cho bối cảnh sử dụng tại Trường Đại học Trà Vinh (TVU), xây dựng bằng HTML/CSS/JavaScript thuần, Bootstrap 5, Express.js, MongoDB/Mongoose và Chart.js. Dữ liệu TVU thật không được cung cấp kèm theo dự án; dữ liệu gieo mẫu đều được ghi rõ là dữ liệu minh họa.

## Công nghệ và yêu cầu

- Docker Desktop for Windows với Docker Compose v2; cần khởi động Docker Desktop trước khi chạy các lệnh.
- Trình duyệt hiện đại, có thể truy cập jsDelivr để tải Bootstrap 5 và Chart.js.
- Không cần cài MongoDB, Node.js, npm hoặc XAMPP trên Windows để chạy ứng dụng. Docker Compose chạy Node.js/Express và MongoDB 8 trong hai container riêng; MongoDB chạy replica set một nút để hỗ trợ transaction.

## Chạy bằng Docker Compose (khuyến nghị)

Mở PowerShell tại thư mục dự án. Tạo `.env` riêng với thông tin đăng nhập và khóa ngẫu nhiên riêng biệt cho mỗi lần cài đặt:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-LocalEnv.ps1
```

Script tạo usernames và passwords ngẫu nhiên, mật khẩu dạng hex để dùng an toàn trong URI MongoDB, một `JWT_SECRET` và khóa replica set riêng. Nếu `.env` đã tồn tại, script dừng mà không ghi đè. Giữ `.env` an toàn và không chia sẻ hoặc commit tệp này.

Kiểm tra cấu hình và xây dựng/khởi động hai dịch vụ:

```powershell
docker compose --env-file .env config -q
docker compose --env-file .env up --build -d
docker compose --env-file .env ps
```

Compose kết nối ứng dụng tới `mongo` bằng URI nội bộ `mongodb://<app-user>:<app-password>@mongo:27017/teaching_quality?authSource=teaching_quality&replicaSet=rs0`. MongoDB chỉ nằm trong mạng nội bộ Docker, không publish cổng `27017` ra Windows host. Ứng dụng chỉ nhận thông tin tài khoản MongoDB `readWrite`; tài khoản gốc chỉ được dùng cho health check/khởi tạo. Mongo health check khởi động replica set và chờ đến khi nút là primary; ứng dụng phụ thuộc trạng thái healthy đó. Dữ liệu được lưu trong volume `mongo_data`. Mở `http://localhost:3000`.

Trước khi cấp tài khoản quản trị, thêm ba biến sau vào `.env` và tự chọn giá trị mạnh, không dùng email thuộc miền sinh viên/giảng viên:

```powershell
ADMIN_NAME=Quản trị viên
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<mật khẩu mạnh tối thiểu 12 ký tự>
```

Không gửi các giá trị này qua chat và không commit `.env`. Provisioning là lệnh riêng, chỉ kết nối MongoDB sau health check, băm mật khẩu bằng bcrypt cost 12, và không chạy tự động khi ứng dụng khởi động. Chạy lại an toàn: tài khoản admin có sẵn không bị đổi mật khẩu/trạng thái; email đã thuộc role khác sẽ bị từ chối.

```powershell
docker compose --env-file .env run --rm admin-provision
```

Lệnh này sử dụng volume hiện có và không xóa hoặc khởi tạo lại dữ liệu. Đăng nhập tại `http://localhost:3000` bằng email/mật khẩu vừa cấu hình.

Nếu cần khôi phục mật khẩu, thay `ADMIN_PASSWORD` trong `.env` bằng mật khẩu mới dài ít nhất 12 ký tự, rồi chạy lệnh riêng có xác nhận dưới đây. Lệnh chỉ đổi hash mật khẩu của đúng tài khoản admin khớp `ADMIN_EMAIL`; không đổi role/trạng thái và không phải một phần của provisioning thông thường.

```powershell
docker compose --env-file .env run --rm admin-provision npm run reset-admin-password -- --confirm
```

Để cấp tài khoản sinh viên theo MSSV, chạy provisioning riêng (ví dụ `110122189@st.tvu.edu.vn`). Chỉ khi tài khoản chưa có, lệnh đặt MSSV làm mật khẩu khởi tạo và băm bằng bcrypt; nếu email đã tồn tại, không thay đổi mật khẩu, tên, role hoặc trạng thái.

```powershell
docker compose --env-file .env exec app npm run provision-student -- 110122189@st.tvu.edu.vn
```

Tài khoản này cần được ghi danh vào lớp bởi quản trị viên nếu cần truy cập các khảo sát của lớp. Có thể đặt `SEED_STUDENT_EMAIL` trong `.env` và chạy `npm run seed` để tạo thêm tài khoản và ghi danh vào lớp minh họa; thao tác student account cũng không cập nhật tài khoản hiện có.

Tùy chọn, thêm dữ liệu minh họa:

```powershell
docker compose --env-file .env exec app npm run seed
```

Lệnh này tạo giảng viên, học phần, lớp, phân công, câu hỏi và khảo sát mẫu; không tạo hồ sơ TVU thật, phản hồi khảo sát giả, hay mật khẩu mẫu. Quản trị viên có thể tạo tài khoản giảng viên/sinh viên trong màn hình quản trị và ghi danh sinh viên vào lớp.

Xem logs, dừng và chạy lại:

```powershell
docker compose --env-file .env logs -f app
docker compose --env-file .env logs -f mongo
docker compose --env-file .env stop
docker compose --env-file .env start
docker compose --env-file .env down
```

`down` giữ nguyên volume `mongo_data`. Không dùng `down -v` trừ khi chủ ý xóa vĩnh viễn toàn bộ database. Giữ nguyên `.env` khi sử dụng lại volume hiện có; MongoDB chỉ tạo người dùng ban đầu ở lần khởi tạo volume đầu tiên, và tạo `.env` khác không tự đổi thông tin xác thực đã lưu trong database.


## Cấu hình môi trường

| Biến | Mục đích |
| --- | --- |
| `PORT` | Cổng web (mặc định `3000`). |
| `NODE_ENV` | Compose đặt `production` cho container ứng dụng. |
| `MONGODB_URI` | Compose dựng URI với hostname `mongo`, tài khoản ứng dụng và replica set `rs0`; không cần server MongoDB trên host. |
| `JWT_SECRET` | Khóa ký cookie phiên JWT, tối thiểu 32 ký tự ngẫu nhiên. |
| `COOKIE_SECURE` | Đặt `true` khi truy cập qua HTTPS. |
| `MIN_REPORT_RESPONSES` | Số phản hồi tối thiểu để công bố thống kê (mặc định `5`). |
| `SEED_STUDENT_EMAIL` | (Tùy chọn) Email dạng MSSV `@st.tvu.edu.vn`; seed chỉ tạo nếu chưa có và không đặt lại tài khoản có sẵn. |
| `ADMIN_NAME` | Tên hiển thị cho tài khoản quản trị ban đầu; chỉ dùng trong lệnh provisioning tường minh. |
| `ADMIN_EMAIL` | Email quản trị hợp lệ; không được thuộc `@st.tvu.edu.vn` hoặc `@tvu.edu.vn`. |
| `ADMIN_PASSWORD` | Mật khẩu quản trị, tối thiểu 12 ký tự; tạo mới chỉ khi tài khoản chưa tồn tại, hoặc đổi bằng lệnh reset có `--confirm`. |
| `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` | Tài khoản quản trị MongoDB trong môi trường Compose cục bộ. |
| `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD` | Tài khoản ứng dụng MongoDB; chỉ cấp quyền `readWrite` trên database ứng dụng. |
| `MONGO_REPLICA_KEY` | Khóa nội bộ replica set; tạo giá trị ngẫu nhiên dài và không tái sử dụng khóa JWT. |

`scripts/New-LocalEnv.ps1` sinh `.env` từ `.env.example`; không thay bí mật bằng giá trị mặc định. Không đưa bí mật thật vào source code, image hay Git.

## Tài khoản và quy trình sử dụng

Vai trò được kiểm tra phía máy chủ: `admin`, `lecturer`, `student`. Mật khẩu quản trị/giảng viên và tài khoản sinh viên tạo qua màn hình quản trị tối thiểu 12 ký tự. Riêng provisioning sinh viên chuyên biệt (hoặc biến `SEED_STUDENT_EMAIL`) dùng MSSV (6–12 chữ số) làm mật khẩu khởi tạo bcrypt, theo chính sách cấp tài khoản; không nới lỏng chính sách tạo/quản lý các vai trò khác.

1. Chạy `docker compose --env-file .env run --rm admin-provision`, sau đó đăng nhập bằng tài khoản quản trị đã cấu hình.
2. Tạo hồ sơ giảng viên, học phần, lớp, tài khoản giảng viên/sinh viên, câu hỏi và phân công. Email tài khoản sinh viên phải dùng `@st.tvu.edu.vn`, email tài khoản/hồ sơ giảng viên phải dùng `@tvu.edu.vn`; tài khoản quản trị dùng email hợp lệ ngoài hai miền đó. Lớp và phân công có năm học/học kỳ.
3. Ghi danh sinh viên vào lớp, sau đó tạo khảo sát gắn với phân công, khoảng thời gian và câu hỏi. Câu hỏi mẫu bao phủ kiến thức chuyên môn, phương pháp giảng dạy, giao tiếp, tương tác và tổ chức học phần.
4. Sinh viên thuộc lớp xem khảo sát đang mở, chấm mỗi câu theo thang Likert 1–5 và có thể gửi góp ý chữ không bắt buộc. Điểm, câu hỏi và góp ý được kiểm tra ở API.
5. Quản trị viên lọc báo cáo; giảng viên chỉ xem dữ liệu gắn với hồ sơ của mình. Báo cáo có lọc giảng viên, học phần, ngày, năm học và học kỳ; biểu đồ cột tiêu chí, radar, phân bố điểm, tải CSV và chức năng in/lưu PDF qua trình duyệt.
6. Quản trị viên chọn mục **Chính sách đánh giá** để đặt giới hạn gửi theo khảo sát hoặc phân công/học kỳ, số lần gửi/chỉnh sửa tối đa và ngưỡng phản hồi tối thiểu trước khi công bố báo cáo. Không thể đổi phạm vi khi cơ sở dữ liệu đã ghi nhận lượt gửi, nhằm tránh mở lại khả năng gửi trùng.

## Tính ẩn danh và giới hạn

Mỗi lượt gửi được ghi trong transaction MongoDB. `submission_records` lưu mã sinh viên, phạm vi, số lần gửi và tham chiếu đến phản hồi cần cập nhật; `evaluations` lưu điểm/góp ý nhưng không chứa ID, email hay tên người trả lời. Unique index trên phạm vi và sinh viên chặn gửi đồng thời/lặp; nếu còn dữ liệu cũ trong `submission_eligibility`, hệ thống vẫn nhận diện và chặn gửi lại nhưng không thể chỉnh sửa phản hồi cũ vì bản ghi đó không liên kết trực tiếp đến một đánh giá. Khi cho phép gửi lại, cùng khảo sát sẽ cập nhật phản hồi hiện tại; các khảo sát khác trong cùng phạm vi vẫn giữ báo cáo lịch sử riêng.

Đây là tách biệt dữ liệu trong ứng dụng, không phải bảo đảm ẩn danh tuyệt đối: quản trị viên cơ sở dữ liệu có thể truy cập dữ liệu giới hạn gửi; thời điểm nộp, log hạ tầng hoặc nội dung tự ghi danh tính trong góp ý có thể làm suy đoán người gửi. Góp ý chữ không được hiển thị trong báo cáo giảng viên hiện tại. Báo cáo và CSV ẩn cả điểm và số lượng phản hồi chính xác khi số lượng nhỏ hơn ngưỡng chính sách (`MIN_REPORT_RESPONSES` khi chính sách mới được khởi tạo); ngưỡng làm giảm rủi ro nhưng không bảo đảm chống suy luận khi lọc/chia nhóm. Hạn chế quyền MongoDB, bảo vệ log và áp dụng chính sách lưu trữ phù hợp.

## API

- `GET /api/health` — trạng thái kết nối MongoDB.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/overview`, `GET /api/surveys/available`, `GET /api/surveys/:id`, `POST /api/surveys/:id/submit`.
- `GET /api/reports`, `GET /api/reports/export.csv`, `/api/reports/courses`; `/api/reports/lecturers` chỉ cho quản trị viên.
- `/api/admin/*` — danh mục, tài khoản, khảo sát, phân công, ghi danh và `GET/PUT /api/admin/policy`; chỉ quản trị viên.

Mọi API trừ kiểm tra tình trạng yêu cầu phiên xác thực; quyền thao tác được kiểm tra lại tại backend. Mật khẩu được băm bằng bcrypt; cookie JWT là `HttpOnly`, `SameSite=Strict`, hết hạn sau 8 giờ; login có giới hạn tần suất.

## Kiểm tra và xử lý sự cố

```sh
npm run check
npm test
docker compose --env-file .env config -q
```

`npm run check` kiểm tra cú pháp JavaScript; `npm test` chạy kiểm thử đơn vị cho provisioning/authentication admin và sinh viên, chính sách gửi và an toàn CSV. Lệnh kiểm tra Compose xác nhận cấu hình mà không cần khởi động container. Health checks khi `docker compose up` chạy sẽ kiểm tra dịch vụ và primary replica set; mở `http://localhost:3000/api/health` sau khi khởi động để xác nhận trạng thái runtime. Đây là kiểm tra code/configuration; không thay thế chạy ứng dụng để kiểm tra kết nối database.

- Nếu cấu hình Compose báo thiếu biến, chạy script tạo `.env` tại project root.
- Nếu lệnh `admin-provision` báo thiếu `ADMIN_NAME`, `ADMIN_EMAIL` hoặc `ADMIN_PASSWORD`, hãy thêm đủ ba biến vào root `.env` (không cần và không nên gửi mật khẩu ra ngoài), rồi chạy lại lệnh provisioning.
- Nếu MongoDB chưa healthy, xem `docker compose logs -f mongo`; lần khởi động đầu có thể mất thời gian khởi tạo replica set.
- Nếu app chưa kết nối, xác minh user/password ứng dụng khớp `MONGODB_URI` và tài khoản được tạo trong lần khởi tạo volume đầu tiên. Đổi thông tin khởi tạo Mongo trên volume đã tồn tại không tự sửa user trong database.
- Nếu khảo sát không xuất hiện, kiểm tra ghi danh lớp, phân công, trạng thái `open` và giờ bắt đầu/kết thúc.
- Nếu báo cáo không hiện điểm, cần đạt ngưỡng phản hồi cấu hình.
- `docker compose down -v` xóa dữ liệu database; dùng thận trọng.

Kiểm thử end-to-end phụ thuộc Docker/MongoDB sẵn có; kiểm thử đơn vị và cú pháp không thay thế xác minh trên dữ liệu triển khai.
#   c n - d a 2 3 t t c - c h a u t u y e t t r a n - h e t h o n g - d a n h g i a  
 