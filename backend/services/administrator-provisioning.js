const bcrypt = require('bcryptjs');
const {
  MANAGEMENT_PASSWORD_MIN_LENGTH, normalizeEmail,
  isAdministratorEmailValid
} = require('../validators/account');

function readAdministratorConfiguration(environment) {
  const missing = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']
    .filter((key) => !String(environment[key] || '').trim());
  if (missing.length) {
    throw new Error(
      `Thiếu ${missing.join(', ')} trong tệp .env. Hãy đặt tên, email quản trị ngoài miền @st.tvu.edu.vn/@tvu.edu.vn và mật khẩu tối thiểu ${MANAGEMENT_PASSWORD_MIN_LENGTH} ký tự, rồi chạy lại.`
    );
  }

  const name = String(environment.ADMIN_NAME).trim();
  if (name.length > 150) throw new Error('ADMIN_NAME không được vượt quá 150 ký tự.');
  const { email, password } = readAdministratorPasswordConfiguration(environment);
  return { name, email, password };
}

function readAdministratorPasswordConfiguration(environment) {
  const missing = ['ADMIN_EMAIL', 'ADMIN_PASSWORD']
    .filter((key) => !String(environment[key] || '').trim());
  if (missing.length) {
    throw new Error(`Thiếu ${missing.join(', ')} trong tệp .env.`);
  }
  const email = normalizeEmail(environment.ADMIN_EMAIL);
  const password = String(environment.ADMIN_PASSWORD);
  if (!isAdministratorEmailValid(email)) {
    throw new Error('ADMIN_EMAIL phải là email hợp lệ và không thuộc miền @st.tvu.edu.vn hoặc @tvu.edu.vn.');
  }
  if (password.length < MANAGEMENT_PASSWORD_MIN_LENGTH || password.length > 200) {
    throw new Error(`ADMIN_PASSWORD phải dài từ ${MANAGEMENT_PASSWORD_MIN_LENGTH} đến 200 ký tự.`);
  }
  return { email, password };
}

async function provisionAdministrator(UserModel, environment) {
  const config = readAdministratorConfiguration(environment);
  const existing = await UserModel.findOne({ email: config.email });
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('ADMIN_EMAIL đã được sử dụng bởi tài khoản không phải quản trị viên; không có dữ liệu nào bị thay đổi.');
    }
    return { user: existing, created: false };
  }

  const passwordHash = await bcrypt.hash(config.password, 12);
  try {
    const user = await UserModel.create({
      full_name: config.name,
      email: config.email,
      password_hash: passwordHash,
      role: 'admin',
      is_active: true
    });
    return { user, created: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const racedUser = await UserModel.findOne({ email: config.email });
    if (racedUser?.role === 'admin') return { user: racedUser, created: false };
    throw new Error('ADMIN_EMAIL vừa được cấp cho tài khoản không tương thích; không có dữ liệu nào bị thay đổi.');
  }
}

async function resetAdministratorPassword(UserModel, environment, confirmed) {
  if (confirmed !== true) {
    throw new Error('Đặt lại mật khẩu là thao tác tường minh; chạy lệnh với cờ --confirm.');
  }
  const { email, password } = readAdministratorPasswordConfiguration(environment);
  const existing = await UserModel.findOne({ email });
  if (!existing) throw new Error('Không tìm thấy tài khoản quản trị theo ADMIN_EMAIL; không có dữ liệu nào bị thay đổi.');
  if (existing.role !== 'admin') {
    throw new Error('ADMIN_EMAIL thuộc tài khoản không phải quản trị viên; không có dữ liệu nào bị thay đổi.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await UserModel.updateOne(
    { _id: existing._id, role: 'admin' },
    { $set: { password_hash: passwordHash } }
  );
  if (result.matchedCount !== 1) {
    throw new Error('Tài khoản đã thay đổi trong khi reset; hãy kiểm tra dữ liệu rồi thử lại.');
  }
  return { isActive: existing.is_active };
}

module.exports = {
  readAdministratorConfiguration, provisionAdministrator,
  readAdministratorPasswordConfiguration, resetAdministratorPassword
};
