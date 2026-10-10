const bcrypt = require('bcryptjs');
const { normalizeEmail } = require('../validators/account');

async function authenticateCredentials(UserModel, email, password) {
  const user = await UserModel.findOne({ email: normalizeEmail(email) }).select('+password_hash');
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return null;
  }
  return user;
}

module.exports = { authenticateCredentials };
