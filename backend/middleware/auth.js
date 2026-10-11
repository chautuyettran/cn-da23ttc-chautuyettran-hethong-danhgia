const jwt = require('jsonwebtoken');
const { User } = require('../models');

async function authenticate(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'teaching-quality-evaluation' });
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
  try {
    const user = await User.findOne({ _id: payload.id, is_active: true }).select('full_name email role lecturer_id auth_version').lean();
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Tài khoản không còn hoạt động.' });
    }
    if ((payload.authVersion || 0) !== (user.auth_version || 0)) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.' });
    }
    req.user = {
      id: String(user._id), name: user.full_name, email: user.email,
      role: user.role, lecturerId: user.lecturer_id ? String(user.lecturer_id) : null
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    return next();
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  };
}

function clearSessionCookie(res) {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie('session', options);
}

module.exports = { authenticate, requireRole, cookieOptions, clearSessionCookie };
