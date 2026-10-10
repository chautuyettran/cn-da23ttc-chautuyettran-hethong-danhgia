const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { User } = require('../models');
const { authenticate, cookieOptions } = require('../middleware/auth');
const { normalizeEmail } = require('../validators/account');
const { authenticateCredentials } = require('../services/authentication');

const router = express.Router();
const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200)
});

router.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email hoặc mật khẩu không hợp lệ.' });
  try {
    const email = normalizeEmail(parsed.data.email);
    const user = await authenticateCredentials(User, email, parsed.data.password);
    if (!user) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
    }
    const token = jwt.sign({
      id: String(user._id), role: user.role, lecturerId: user.lecturer_id ? String(user.lecturer_id) : null
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

router.post('/logout', (req, res) => {
  res.clearCookie('session', { ...cookieOptions(), maxAge: undefined });
  return res.json({ message: 'Đã đăng xuất.' });
});

module.exports = router;
