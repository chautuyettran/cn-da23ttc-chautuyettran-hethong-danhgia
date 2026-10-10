require('dotenv').config();

const { connectDatabase, mongoose } = require('../config/db');
const { User } = require('../models');
const {
  readAdministratorPasswordConfiguration, resetAdministratorPassword
} = require('../services/administrator-provisioning');

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Đặt lại mật khẩu là thao tác tường minh; chạy lệnh với cờ --confirm.');
  }
  readAdministratorPasswordConfiguration(process.env);
  await connectDatabase();
  await resetAdministratorPassword(User, process.env, process.argv.includes('--confirm'));
  console.log('Đã đặt lại mật khẩu cho tài khoản quản trị; mật khẩu đã được băm bằng bcrypt.');
}

main()
  .catch((error) => {
    console.error('Không thể đặt lại mật khẩu quản trị:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
