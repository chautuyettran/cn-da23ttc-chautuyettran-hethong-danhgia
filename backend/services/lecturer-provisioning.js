const bcrypt = require('bcryptjs');
const {
  MANAGEMENT_PASSWORD_MIN_LENGTH, normalizeEmail, isRoleEmailValid
} = require('../validators/account');

const TEST_LECTURER_EMAIL = 'ngocdanthanhtvu@tvu.edu.vn';
const TEST_LECTURER_DEFAULT_NAME = 'Giảng viên kiểm thử';
const TEST_LECTURER_DEFAULT_DEPARTMENT = 'Khoa chưa cập nhật';

function readLecturerConfiguration(environment) {
  const required = ['LECTURER_NAME', 'LECTURER_EMAIL', 'LECTURER_PASSWORD', 'LECTURER_DEPARTMENT'];
  const missing = required.filter((key) => !String(environment[key] || '').trim());
  if (missing.length) {
    throw new Error(
      `Thiếu ${missing.join(', ')} trong tệp .env. Cần mật khẩu tối thiểu ${MANAGEMENT_PASSWORD_MIN_LENGTH} ký tự.`
    );
  }
  const name = String(environment.LECTURER_NAME).trim();
  const department = String(environment.LECTURER_DEPARTMENT).trim();
  const email = normalizeEmail(environment.LECTURER_EMAIL);
  const password = String(environment.LECTURER_PASSWORD);
  if (name.length > 150 || department.length > 150) {
    throw new Error('LECTURER_NAME và LECTURER_DEPARTMENT không được vượt quá 150 ký tự.');
  }
  if (!isRoleEmailValid('lecturer', email) || !/^[^\s@]+@tvu\.edu\.vn$/.test(email)) {
    throw new Error('LECTURER_EMAIL phải sử dụng tên miền @tvu.edu.vn.');
  }
  if (password.length < MANAGEMENT_PASSWORD_MIN_LENGTH || password.length > 200) {
    throw new Error(`LECTURER_PASSWORD phải dài từ ${MANAGEMENT_PASSWORD_MIN_LENGTH} đến 200 ký tự.`);
  }
  return { name, department, email, password };
}

function readTestLecturerConfiguration(environment) {
  const password = String(environment.TEST_LECTURER_PASSWORD || '');
  if (!password.trim()) {
    throw new Error('Thiếu TEST_LECTURER_PASSWORD trong .env; hãy nhập mật khẩu thử nghiệm cục bộ rồi chạy lại.');
  }
  if (password.length < MANAGEMENT_PASSWORD_MIN_LENGTH || password.length > 200) {
    throw new Error(`TEST_LECTURER_PASSWORD phải dài từ ${MANAGEMENT_PASSWORD_MIN_LENGTH} đến 200 ký tự.`);
  }
  const name = String(environment.TEST_LECTURER_NAME || TEST_LECTURER_DEFAULT_NAME).trim();
  const department = String(environment.TEST_LECTURER_DEPARTMENT || TEST_LECTURER_DEFAULT_DEPARTMENT).trim();
  if (!name || name.length > 150 || !department || department.length > 150) {
    throw new Error('TEST_LECTURER_NAME và TEST_LECTURER_DEPARTMENT phải có từ 1 đến 150 ký tự.');
  }
  return {
    name,
    department,
    email: normalizeEmail(TEST_LECTURER_EMAIL),
    password
  };
}

async function provisionLecturer(UserModel, LecturerModel, environment) {
  const config = readLecturerConfiguration(environment);
  return provisionLecturerAccount(UserModel, LecturerModel, config);
}

async function provisionLecturerAccount(UserModel, LecturerModel, config, options = {}) {
  const session = await UserModel.db.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      let user = await UserModel.findOne({ email: config.email }).session(session);
      let lecturer = await LecturerModel.findOne({ email: config.email }).session(session);
      if (user && user.role !== 'lecturer') {
        throw new Error('LECTURER_EMAIL đã được sử dụng bởi tài khoản không phải giảng viên; không có dữ liệu nào bị thay đổi.');
      }
      if (!lecturer) {
        lecturer = await LecturerModel.create([{
          full_name: config.name,
          department: config.department,
          email: config.email
        }], { session }).then(([created]) => created);
      }
      if (user?.lecturer_id && String(user.lecturer_id) !== String(lecturer._id)) {
        throw new Error('Tài khoản và hồ sơ giảng viên hiện liên kết không nhất quán; không có dữ liệu nào bị thay đổi.');
      }
      const linkedUser = await UserModel.findOne({ lecturer_id: lecturer._id }).session(session);
      if (linkedUser && (!user || String(linkedUser._id) !== String(user._id))) {
        throw new Error('Hồ sơ giảng viên đã được liên kết với một tài khoản khác; không có dữ liệu nào bị thay đổi.');
      }
      let created = false;
      if (!user) {
        user = await UserModel.create([{
          full_name: config.name,
          email: config.email,
          password_hash: await bcrypt.hash(config.password, 12),
          role: 'lecturer',
          lecturer_id: lecturer._id,
          is_active: true
        }], { session }).then(([createdUser]) => createdUser);
        created = true;
      } else if (!user.lecturer_id) {
        user.lecturer_id = lecturer._id;
        await user.save({ session });
        created = true;
      }
      const activated = Boolean(options.activateExisting && !user.is_active);
      if (activated) {
        user.is_active = true;
        user.auth_version = (user.auth_version || 0) + 1;
        await user.save({ session });
      }
      outcome = { user, created, activated };
    });
    return outcome;
  } catch (error) {
    if (error.code !== 11000) throw error;
    const [user, lecturer] = await Promise.all([
      UserModel.findOne({ email: config.email }),
      LecturerModel.findOne({ email: config.email })
    ]);
    if (!user || user.role !== 'lecturer' || !lecturer ||
        String(user.lecturer_id || '') !== String(lecturer._id)) {
      throw new Error('Email hoặc hồ sơ giảng viên vừa được tạo bởi một tài khoản khác; hãy kiểm tra dữ liệu rồi chạy lại.');
    }
    const linkedUser = await UserModel.findOne({ lecturer_id: lecturer._id });
    if (!linkedUser || String(linkedUser._id) !== String(user._id)) {
      throw new Error('Hồ sơ giảng viên vừa được liên kết với tài khoản khác; hãy kiểm tra dữ liệu rồi chạy lại.');
    }
    let activated = false;
    if (options.activateExisting && !user.is_active) {
      const result = await UserModel.updateOne(
        { _id: user._id, role: 'lecturer', is_active: false },
        { $set: { is_active: true }, $inc: { auth_version: 1 } },
        { runValidators: true }
      );
      if (result.matchedCount !== 1) {
        throw new Error('Không thể kích hoạt tài khoản giảng viên kiểm thử; hãy kiểm tra dữ liệu rồi thử lại.');
      }
      user.is_active = true;
      user.auth_version = (user.auth_version || 0) + 1;
      activated = true;
    }
    return { user, created: false, activated };
  } finally {
    await session.endSession();
  }
}

async function provisionTestLecturer(UserModel, LecturerModel, environment) {
  const config = readTestLecturerConfiguration(environment);
  return provisionLecturerAccount(UserModel, LecturerModel, config, { activateExisting: true });
}

async function resetTestLecturerPassword(UserModel, environment, confirmed) {
  if (confirmed !== true) {
    throw new Error('Đặt lại mật khẩu là thao tác tường minh; chạy lệnh với cờ --confirm.');
  }
  const config = readTestLecturerConfiguration(environment);
  const user = await UserModel.findOne({ email: config.email });
  if (!user) throw new Error('Không tìm thấy tài khoản giảng viên kiểm thử; hãy chạy provisioning trước.');
  if (user.role !== 'lecturer') {
    throw new Error('Email tài khoản kiểm thử thuộc vai trò khác giảng viên; không có dữ liệu nào bị thay đổi.');
  }
  const passwordHash = await bcrypt.hash(config.password, 12);
  const result = await UserModel.updateOne(
    { _id: user._id, role: 'lecturer' },
    { $set: { password_hash: passwordHash }, $inc: { auth_version: 1 } },
    { runValidators: true }
  );
  if (result.matchedCount !== 1) {
    throw new Error('Tài khoản thay đổi trong khi đặt lại mật khẩu; hãy kiểm tra dữ liệu rồi thử lại.');
  }
  return { isActive: user.is_active };
}

module.exports = {
  TEST_LECTURER_EMAIL,
  readLecturerConfiguration,
  readTestLecturerConfiguration,
  provisionLecturer,
  provisionLecturerAccount,
  provisionTestLecturer,
  resetTestLecturerPassword
};
