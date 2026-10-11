const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { User } = require('../models');
const { authenticate, requireRole, cookieOptions, clearSessionCookie } = require('../middleware/auth');
const { managementPasswordSchema, normalizeEmail } = require('../validators/account');
const { authenticateCredentials } = require('../services/authentication');
const { createRateLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const loginRateLimiter = createRateLimiter(20, 15 * 60 * 1000, 'Quá nhiều lần thử. Vui lòng thử lại sau.');
const passwordChangeRateLimiter = createRateLimiter(10, 15 * 60 * 1000, 'Quá nhiều lần thử. Vui lòng thử lại sau.');
const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200)
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: managementPasswordSchema,
  confirmPassword: z.string().min(1).max(200)
}).strict().refine((value) => value.newPassword === value.confirmPassword, {
  message: 'Mật khẩu mới và xác nhận không khớp.',
  path: ['confirmPassword']
});

router.post('/login', loginRateLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email hoặc mật khẩu không hợp lệ.' });
  try {
    const email = normalizeEmail(parsed.data.email);
    const user = await authenticateCredentials(User, email, parsed.data.password);
    if (!user) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
    }
    const token = jwt.sign({
      id: String(user._id), role: user.role, lecturerId: user.lecturer_id ? String(user.lecturer_id) : null,
      authVersion: user.auth_version || 0
    }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'teaching-quality-evaluation' });
    res.cookie('session', token, cookieOptions());
    return res.json({ user: { id: String(user._id), name: user.full_name, email: user.email, role: user.role } });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.user.id, is_active: true }).select('full_name email role lecturer_id');
    if (!user) return res.status(401).json({ error: 'Tài khoản không còn hoạt động.' });
    return res.json({
      user: {
        id: String(user._id), name: user.full_name, email: user.email,
        role: user.role, lecturerId: user.lecturer_id ? String(user.lecturer_id) : null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/change-password', passwordChangeRateLimiter, authenticate, requireRole('student', 'lecturer'), async (req, res, next) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Thông tin đổi mật khẩu không hợp lệ.'
    });
  }
  try {
    const user = await User.findOne({
      _id: req.user.id,
      role: { $in: ['student', 'lecturer'] },
      is_active: true
    }).select('+password_hash');
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
    }
    if (await bcrypt.compare(parsed.data.newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
    }
    user.password_hash = await bcrypt.hash(parsed.data.newPassword, 12);
    user.auth_version += 1;
    await user.save();
    clearSessionCookie(res);
    return res.json({ message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('session', { ...cookieOptions(), maxAge: undefined });
  return res.json({ message: 'Đã đăng xuất.' });
});

module.exports = router;
