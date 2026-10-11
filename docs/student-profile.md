# Thông tin tài khoản sinh viên

Trang hồ sơ sinh viên dùng phiên đăng nhập hiện có và các endpoint:

- `GET /api/student/profile`: trả về hồ sơ của sinh viên đang đăng nhập cùng
  các lớp được ghi danh.
- `PATCH /api/student/profile`: cập nhật họ tên, số điện thoại và liên kết
  GitHub. Email, MSSV và lớp không thể sửa qua endpoint này. Nếu số điện thoại
  đổi, cờ xác minh điện thoại được đặt lại.
- `GET /api/student/profile/avatar`: trả ảnh WebP hiện tại của chính sinh viên.
- `POST /api/student/profile/avatar`: nhận multipart `avatar`, tối đa 2 MB;
  máy chủ kiểm tra/giải mã rồi chuẩn hóa ảnh thành WebP 512 px.
- `DELETE /api/student/profile/avatar`: gỡ ảnh khỏi hồ sơ và dọn tệp thuộc hồ
  sơ đó.

Tất cả endpoint chỉ chấp nhận tài khoản sinh viên đang hoạt động và lấy ID từ
phiên xác thực. Quản trị viên, giảng viên và người chưa đăng nhập không được
truy cập endpoint hồ sơ.

Collection `users` được bổ sung `github_url` và `avatar_filename`; tài liệu cũ
được hỗ trợ với giá trị mặc định, không cần migration phá hủy. Ảnh không nằm
trong MongoDB. Docker Compose gắn named volume `student_avatar_data` vào
`/app/uploads/avatars`, vì vậy ảnh còn sau khi container ứng dụng được dựng lại.
Không xóa volume này nếu cần giữ ảnh đại diện. Tệp tải lên không được thêm vào
Git.

Khởi động/cập nhật ứng dụng bằng:

```powershell
docker compose --env-file .env up --build -d
docker compose --env-file .env ps
```

Chạy unit test và kiểm thử API/MongoDB (fixture kiểm thử được dọn sau khi chạy):

```powershell
npm test
docker compose --env-file .env exec -e MONGODB_INTEGRATION_TESTS=true app npm run test:integration
```
