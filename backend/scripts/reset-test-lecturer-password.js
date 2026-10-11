require('dotenv').config();

const { connectDatabase, mongoose } = require('../config/db');
const { User } = require('../models');
const {
  readTestLecturerConfiguration, resetTestLecturerPassword
} = require('../services/lecturer-provisioning');

async function main() {
  const confirmed = process.argv.includes('--confirm');
  readTestLecturerConfiguration(process.env);
  if (!confirmed) {
    throw new Error('Để đặt lại mật khẩu, chạy lệnh với cờ --confirm.');
  }
  await connectDatabase();
  await User.createIndexes();
  const result = await resetTestLecturerPassword(User, process.env, confirmed);
  console.log(`Đã đặt lại mật khẩu tài khoản giảng viên kiểm thử. Trạng thái tài khoản: ${result.isActive ? 'active' : 'inactive'}.`);
}

main()
  .catch((error) => {
    console.error('Không thể đặt lại mật khẩu tài khoản giảng viên kiểm thử:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
