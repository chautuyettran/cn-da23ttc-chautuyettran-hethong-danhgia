require('dotenv').config();

const { connectDatabase, closePool } = require('../config/mysql');
const { migrate } = require('./migrate-mysql');
const { User, Lecturer } = require('../models');
const {
  readTestLecturerConfiguration, provisionTestLecturer
} = require('../services/lecturer-provisioning');

async function main() {
  readTestLecturerConfiguration(process.env);
  await migrate();
  await connectDatabase();
  await Promise.all([User.createIndexes(), Lecturer.createIndexes()]);
  const { created, activated } = await provisionTestLecturer(User, Lecturer, process.env);
  if (created) {
    console.log('Đã tạo tài khoản giảng viên kiểm thử đang hoạt động; mật khẩu được băm bằng bcrypt.');
  } else if (activated) {
    console.log('Đã kích hoạt và kiểm tra liên kết tài khoản giảng viên kiểm thử; mật khẩu hiện tại được giữ nguyên.');
  } else {
    console.log('Tài khoản giảng viên kiểm thử đã tồn tại và đang hoạt động; mật khẩu hiện tại được giữ nguyên.');
  }
}

main()
  .catch((error) => {
    console.error('Không thể provision tài khoản giảng viên kiểm thử:', error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
