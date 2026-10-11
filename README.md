# Hệ thống đánh giá chất lượng giảng dạy và phản hồi

## Cổng giảng viên

Giảng viên đăng nhập bằng tài khoản `@tvu.edu.vn`; sau khi đăng nhập hệ thống chuyển đến `/main/lecturer.html`. Cổng này hiển thị số liệu đánh giá tổng hợp cho các lớp học phần được liên kết với tài khoản giảng viên, cho phép lọc theo môn học, năm học, học kỳ và đợt đánh giá, đồng thời quản lý câu hỏi Likert bổ sung cho các phân công của chính giảng viên đó. Các nhóm chưa đạt `MIN_REPORT_RESPONSES` không hiển thị số liệu. Nội dung góp ý tự do và danh tính người trả lời không được trả về cổng giảng viên.

Tài khoản giảng viên phải được liên kết với hồ sơ giảng viên và phân công giảng dạy trong MongoDB. Để tạo/liên kết tài khoản giảng viên thông thường lần đầu, đặt các giá trị sau trong `.env`:

```dotenv
LECTURER_NAME=
LECTURER_EMAIL=
LECTURER_PASSWORD=
LECTURER_DEPARTMENT=
```

Sau đó chạy provisioning một lần (không tự chạy khi ứng dụng khởi động):

```powershell
docker compose --env-file .env --profile tools run --rm lecturer-provision
```

Lệnh không ghi đè mật khẩu hoặc trạng thái của tài khoản đã tồn tại. Nó dùng `LECTURER_EMAIL` để tạo hồ sơ giảng viên nếu cần và liên kết với user `lecturer`; email phải thuộc miền `@tvu.edu.vn`, mật khẩu phải có ít nhất 12 ký tự. Không lưu thông tin xác thực thật trong Git.

Tài khoản giảng viên kiểm thử `ngocdanthanhtvu@tvu.edu.vn` dùng cấu hình riêng trong `.env`. Nhập mật khẩu cục bộ vào `TEST_LECTURER_PASSWORD` (không chia sẻ hoặc commit giá trị), sau đó chạy:

```powershell
docker compose --env-file .env run --rm app npm run test-lecturer-provision
```

Lệnh dùng cùng MongoDB service/database với ứng dụng, tạo tài khoản nếu chưa có, sửa liên kết hồ sơ nếu cần và bật tài khoản kiểm thử nếu đang bị vô hiệu hóa. Khi tài khoản giảng viên đã tồn tại, lệnh không thay đổi tên, khoa hoặc mật khẩu. Tên và khoa mặc định là “Giảng viên kiểm thử” và “Khoa chưa cập nhật”; có thể đặt `TEST_LECTURER_NAME` và `TEST_LECTURER_DEPARTMENT` trước lần tạo đầu tiên. Nếu email thuộc vai trò khác hoặc hồ sơ đang liên kết không nhất quán, lệnh dừng thay vì đổi vai trò.

Provisioning không đặt lại mật khẩu. Nếu cần reset có chủ đích, cập nhật `TEST_LECTURER_PASSWORD` trong `.env`, rồi chạy lệnh riêng có xác nhận:

```powershell
docker compose --env-file .env --profile tools run --rm test-lecturer-password-reset
```

Lệnh reset tăng `auth_version` để thu hồi phiên hiện tại; chỉ dùng khi chủ động yêu cầu đặt lại.

Giảng viên và sinh viên có thể đổi mật khẩu khi đã đăng nhập từ trang **Thông tin tài khoản**. Máy chủ xác minh mật khẩu hiện tại, áp dụng độ dài tối thiểu 12 ký tự, băm mật khẩu bằng bcrypt và tăng `auth_version` để thu hồi phiên cũ. Tài khoản quản trị không được phép dùng endpoint đổi mật khẩu này.

## Câu hỏi khảo sát

Câu hỏi chung do quản trị viên tạo sẽ được đưa vào mọi khảo sát đang hoạt động, kể cả khảo sát đã tạo trước đó. Câu hỏi chung được quản lý tại **Câu hỏi chung (mọi khảo sát)**; thêm, sửa hoặc xóa câu hỏi chung bị từ chối khi có khảo sát đang mở để không làm thay đổi phiếu đang được trả lời. Không xóa câu hỏi chung đã có câu trả lời được lưu để bảo toàn dữ liệu báo cáo.

Câu hỏi bổ sung do giảng viên tạo chỉ thuộc phân công hoặc khảo sát liên quan. Giảng viên sở hữu câu hỏi và quản trị viên đều có thể sửa hoặc xóa khi không có khảo sát liên quan đang mở. Quản trị viên quản lý chúng tại **Câu hỏi giảng viên**.

## MongoDB credentials

`MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD` are supplied to the MongoDB image as bootstrap credentials for an administrator in `admin`. `MONGO_APP_USERNAME` and `MONGO_APP_PASSWORD` are used by `database/init-mongo.js` to create the application's `readWrite` user in `teaching_quality`; the application connects through `mongo:27017` with `authSource=teaching_quality&replicaSet=rs0`.

The initialization script runs only when the MongoDB data directory is first initialized. Editing `.env` later does not rename users or rotate passwords already stored in `mongo_data`. The MongoDB healthcheck validates the replica-set primary using the application credentials first. If that check fails, it tries the administrator credentials; it initiates `rs0` only when MongoDB reports that the replica set has not yet been initialized. Therefore, do not change stored account credentials based only on `.env` edits. Before any account/password change, verify the existing administrator login and perform an intentional, separately confirmed database operation. Preserve `mongo_data` and keep authentication enabled.