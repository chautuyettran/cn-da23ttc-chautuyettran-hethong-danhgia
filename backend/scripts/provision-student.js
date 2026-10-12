require('dotenv').config();

const { connectDatabase, closePool } = require('../config/mysql');
const { migrate } = require('./migrate-mysql');
const { User } = require('../models');
const { normalizeEmail, studentIdFromEmail } = require('../validators/account');
const { provisionStudentAccount } = require('../services/student-provisioning');

async function main() {
  const email = normalizeEmail(process.argv[2]);
  if (!studentIdFromEmail(email)) {
    throw new Error('Cách dùng: npm run provision-student -- <MSSV>@st.tvu.edu.vn (MSSV gồm 6–12 chữ số).');
  }
  await migrate();
  await connectDatabase();
  await User.createIndexes();
  const { user, created } = await provisionStudentAccount(User, email);
  if (!created) {
    console.log(`Tài khoản đã tồn tại; không thay đổi mật khẩu hoặc trạng thái: ${user.email} (${user.role}, ${user.is_active ? 'active' : 'inactive'}).`);
    return;
  }
  console.log(`Đã tạo tài khoản sinh viên đang hoạt động: ${user.email}. Mật khẩu khởi tạo là MSSV; mật khẩu đã được băm bằng bcrypt.`);
}

main()
  .catch((error) => {
    console.error('Không thể provisioning tài khoản sinh viên:', error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
