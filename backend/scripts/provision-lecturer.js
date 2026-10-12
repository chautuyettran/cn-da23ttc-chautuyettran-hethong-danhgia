require('dotenv').config();

const { connectDatabase, closePool } = require('../config/mysql');
const { migrate } = require('./migrate-mysql');
const { User, Lecturer } = require('../models');
const {
  readLecturerConfiguration, provisionLecturer
} = require('../services/lecturer-provisioning');

async function main() {
  readLecturerConfiguration(process.env);
  await migrate();
  await connectDatabase();
  await Promise.all([User.createIndexes(), Lecturer.createIndexes()]);
  const { user, created } = await provisionLecturer(User, Lecturer, process.env);
  if (created) {
    console.log('Đã tạo hoặc liên kết tài khoản giảng viên; mật khẩu được băm bằng bcrypt.');
  } else {
    console.log(`Tài khoản giảng viên đã tồn tại; không thay đổi mật khẩu hoặc trạng thái (${user.is_active ? 'active' : 'inactive'}).`);
  }
}

main()
  .catch((error) => {
    console.error('Không thể provisioning tài khoản giảng viên:', error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
