const { z } = require('zod');

const EMAIL_DOMAINS = Object.freeze({
  student: '@st.tvu.edu.vn',
  lecturer: '@tvu.edu.vn'
});
const MANAGEMENT_PASSWORD_MIN_LENGTH = 12;
const managementPasswordSchema = z.string()
  .min(MANAGEMENT_PASSWORD_MIN_LENGTH)
  .max(200);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isRoleEmailValid(role, email) {
  if (role === 'admin') return isAdministratorEmailValid(email);
  const domain = EMAIL_DOMAINS[role];
  return Boolean(domain && email.endsWith(domain) && email.length > domain.length);
}

function isAdministratorEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)) &&
    !normalizeEmail(email).endsWith(EMAIL_DOMAINS.student) &&
    !normalizeEmail(email).endsWith(EMAIL_DOMAINS.lecturer);
}

function accountEmailError(role) {
  if (role === 'student') return 'Email sinh viên phải sử dụng tên miền @st.tvu.edu.vn.';
  if (role === 'lecturer') return 'Email giảng viên phải sử dụng tên miền @tvu.edu.vn.';
  return 'Email quản trị phải hợp lệ và không được thuộc miền @st.tvu.edu.vn hoặc @tvu.edu.vn.';
}

function studentIdFromEmail(email) {
  const normalized = normalizeEmail(email);
  if (!isRoleEmailValid('student', normalized)) return null;
  const localPart = normalized.slice(0, -EMAIL_DOMAINS.student.length);
  return /^\d{6,12}$/.test(localPart) ? localPart : null;
}

module.exports = {
  EMAIL_DOMAINS, MANAGEMENT_PASSWORD_MIN_LENGTH, normalizeEmail,
  managementPasswordSchema, isRoleEmailValid, isAdministratorEmailValid,
  accountEmailError, studentIdFromEmail
};
