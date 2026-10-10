const bcrypt = require('bcryptjs');
const {
  normalizeEmail, studentIdFromEmail, accountEmailError
} = require('../validators/account');

async function provisionStudentAccount(UserModel, email) {
  const normalizedEmail = normalizeEmail(email);
  const studentId = studentIdFromEmail(normalizedEmail);
  if (!studentId) throw new Error(accountEmailError('student') + ' MSSV phải gồm 6–12 chữ số và trùng với phần trước @.');

  const passwordHash = await bcrypt.hash(studentId, 12);
  const result = await UserModel.updateOne(
    { email: normalizedEmail },
    {
      $setOnInsert: {
        full_name: `Sinh viên ${studentId}`,
        email: normalizedEmail,
        password_hash: passwordHash,
        role: 'student',
        is_active: true
      }
    },
    { upsert: true, runValidators: true }
  );
  const user = await UserModel.findOne({ email: normalizedEmail }).select('full_name email role is_active');
  if (!user) throw new Error('Không thể xác nhận tài khoản sinh viên sau khi provisioning.');
  return { user, created: Boolean(result.upsertedCount) };
}

module.exports = { provisionStudentAccount };
