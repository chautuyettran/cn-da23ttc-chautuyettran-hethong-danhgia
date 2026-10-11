const express = require('express');
const { z } = require('zod');
const defaultModels = require('../models');
const {
  recoveryIdentitySchema, passwordChangeSchema, createPasswordRecovery
} = require('../services/password-recovery');
const { TwilioSmsProvider } = require('../services/sms-provider');
const { createRateLimiter, respondRateLimited } = require('../middleware/rate-limit');

function limit(windowMs, max) {
  return createRateLimiter(max, windowMs, 'Đã có quá nhiều yêu cầu. Vui lòng thử lại sau.');
}

function createRecoveryRouter({
  models = defaultModels,
  smsProvider = new TwilioSmsProvider(),
  secret,
  clock,
  captchaGenerator,
  getClientIp = (req) => req.ip
} = {}) {
  const recovery = createPasswordRecovery({ models, smsProvider, secret, clock, captchaGenerator });
  const router = express.Router();

  router.post('/captcha', limit(15 * 60 * 1000, 12), async (req, res, next) => {
    const parsed = z.object({ purpose: z.enum(['recover', 'change']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Yêu cầu không hợp lệ.' });
    try {
      return res.json(await recovery.createCaptcha(parsed.data.purpose));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/request-otp', limit(15 * 60 * 1000, 8), async (req, res, next) => {
    const parsed = recoveryIdentitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Vui lòng kiểm tra email, MSSV, mã lớp, số điện thoại và CAPTCHA.' });
    try {
      return sendOtpResponse(req, res, await recovery.requestOtp(parsed.data, getClientIp(req)));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/resend-otp', limit(60 * 60 * 1000, 8), async (req, res, next) => {
    const parsed = z.object({ challengeId: z.string().regex(/^[a-f\d]{64}$/i) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Yêu cầu gửi lại mã không hợp lệ.' });
    try {
      return sendOtpResponse(req, res, await recovery.resendOtp(parsed.data.challengeId, getClientIp(req)));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/verify-otp', limit(15 * 60 * 1000, 15), async (req, res, next) => {
    const parsed = z.object({
      challengeId: z.string().regex(/^[a-f\d]{64}$/i),
      otp: z.string().regex(/^\d{6}$/)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Vui lòng nhập mã OTP gồm sáu chữ số.' });
    try {
      const result = await recovery.verifyOtp(parsed.data.challengeId, parsed.data.otp);
      if (result.status !== 'verified') {
        return res.status(400).json({ error: 'Mã OTP không đúng, đã hết hạn hoặc không còn hiệu lực.' });
      }
      return res.json({ resetToken: result.resetToken, message: 'Đã xác minh OTP. Hãy đặt mật khẩu mới.' });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reset-password', limit(15 * 60 * 1000, 10), async (req, res, next) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Mật khẩu mới không hợp lệ.'
      });
    }
    try {
      const changed = await recovery.changePassword(parsed.data.resetToken, parsed.data.password);
      if (!changed) return res.status(400).json({ error: 'Yêu cầu đổi mật khẩu không hợp lệ hoặc đã hết hạn.' });
      return res.json({ message: 'Đã cập nhật mật khẩu. Vui lòng đăng nhập lại.' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function sendOtpResponse(req, res, result) {
  if (result.status === 'invalid_captcha') {
    return res.status(400).json({ error: 'CAPTCHA không đúng, đã hết hạn hoặc đã được sử dụng. Hãy tải mã mới.' });
  }
  if (result.status === 'rate_limited') {
    return respondRateLimited(req, res, 'Đã có quá nhiều yêu cầu. Vui lòng thử lại sau.', result.retryAfterSeconds);
  }
  if (result.status === 'sms_unavailable') {
    return res.status(503).json({ error: 'Dịch vụ SMS chưa được cấu hình. Vui lòng liên hệ bộ phận hỗ trợ.' });
  }
  if (result.status === 'resend_limited') {
    return respondRateLimited(req, res, 'Vui lòng chờ trước khi gửi lại mã OTP.', result.retryAfterSeconds);
  }
  return res.json({
    challengeId: result.challengeId,
    resendAfterSeconds: result.resendAfterSeconds,
    message: 'Nếu thông tin khớp hồ sơ và số điện thoại đã được xác minh, hệ thống sẽ xử lý yêu cầu xác minh.'
  });
}

module.exports = createRecoveryRouter();
module.exports.createRecoveryRouter = createRecoveryRouter;
