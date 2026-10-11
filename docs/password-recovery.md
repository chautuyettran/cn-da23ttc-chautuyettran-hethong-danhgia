# Khôi phục mật khẩu sinh viên

## Cấu hình gửi OTP qua SMS

Ứng dụng hỗ trợ Twilio. Đặt các biến sau trong tệp `.env` ở thư mục gốc:

```dotenv
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=<Twilio Account SID>
TWILIO_AUTH_TOKEN=<Twilio Auth Token>
TWILIO_FROM_NUMBER=<số gửi SMS đã được Twilio cấp, định dạng E.164>
```

Compose chuyển các biến này vào container `app`. Sau khi cập nhật `.env`, áp
dụng cấu hình bằng lệnh `docker compose --env-file .env up --build -d app`.
Không commit `.env` hoặc chia sẻ thông tin xác thực. Khi chưa cấu hình đủ bốn
giá trị, API trả về thông báo dịch vụ SMS chưa sẵn sàng; không có OTP thử nghiệm
nào được in ra log.

Tin nhắn chỉ được gửi sau khi Twilio xác nhận yêu cầu. Lỗi gửi được ghi log
không kèm nội dung tin nhắn, OTP, thông tin xác thực hoặc token.

## Hồ sơ sinh viên

Hồ sơ phải là tài khoản sinh viên đang hoạt động có email dạng
`<MSSV>@st.tvu.edu.vn`. MSSV được đối chiếu với phần số trong email, mã lớp phải
đang tồn tại và sinh viên phải được ghi danh vào lớp đó. Tài khoản còn cần có
số điện thoại E.164 (`+...`) đã được xác minh.

Hai trường `phone_number` và `phone_verified` được bổ sung tương thích vào
collection `users`; không cần xóa dữ liệu hoặc chạy migration phá hủy. Các hồ
sơ cũ không có điện thoại vẫn không được xem là đã xác minh. Quản trị viên cần
đăng ký số điện thoại và chỉ đánh dấu xác minh sau khi kiểm tra theo quy trình
được đơn vị phê duyệt, trong trang quản lý tài khoản. Không nhập số điện thoại
người dùng tự khai trong biểu mẫu khôi phục để thay thế bước này.

## Bảo vệ và kiểm thử

CAPTCHA, OTP, quyền đặt lại mật khẩu và giới hạn theo tài khoản/số điện thoại/IP
được lưu trong MongoDB; các giá trị bí mật chỉ được lưu dưới dạng HMAC. CAPTCHA
và OTP hết hạn sau 5 phút, OTP bị giới hạn số lần thử và quyền đặt lại hết hạn
sau 10 phút. Sau khi đổi mật khẩu, các phiên đăng nhập hiện có bị thu hồi.

Chạy bộ kiểm thử nhanh và bộ kiểm thử MongoDB (dùng cơ sở dữ liệu đã cấu hình;
test tự dọn các fixture do nó tạo):

```powershell
npm test
docker compose --env-file .env exec -e MONGODB_INTEGRATION_TESTS=true app npm run test:integration
```

Kiểm thử tích hợp dùng SMS provider giả, không gửi tin nhắn thật. Gửi SMS thật
chỉ có thể được xác nhận sau khi cấu hình thông tin Twilio hợp lệ và kiểm tra
trên một tài khoản/số điện thoại thử nghiệm được cho phép.
