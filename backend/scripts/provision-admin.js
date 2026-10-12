require('dotenv').config();

const { connectDatabase, closePool } = require('../config/mysql');
const { migrate } = require('./migrate-mysql');
const { User } = require('../models');
const {
  readAdministratorConfiguration, provisionAdministrator
} = require('../services/administrator-provisioning');

async function main() {
  readAdministratorConfiguration(process.env);
  await migrate();
  await connectDatabase();
  await User.createIndexes();
  const { user, created } = await provisionAdministrator(User, process.env);
  if (created) {
    console.log('Đã tạo tài khoản quản trị đang hoạt động; mật khẩu đã được băm bằng bcrypt.');
  } else {
    console.log(`Tài khoản quản trị đã tồn tại; không thay đổi mật khẩu hoặc trạng thái (${user.is_active ? 'active' : 'inactive'}).`);
  }
}

main()
  .catch((error) => {
    console.error('Không thể provisioning tài khoản quản trị:', error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
