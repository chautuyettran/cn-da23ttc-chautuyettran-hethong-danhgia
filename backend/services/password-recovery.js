const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const svgCaptcha = require('svg-captcha');
const { z } = require('zod');
const { normalizeEmail, studentIdFromEmail, managementPasswordSchema } = require('../validators/account');

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_TTL_MS = 20 * 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const internationalPhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const recoveryIdentitySchema = z.object({
  email: z.string().trim().email().max(255).transform(normalizeEmail)
    .refine((email) => email.endsWith('@st.tvu.edu.vn'), 'Email phải sử dụng miền @st.tvu.edu.vn.'),
  studentId: z.string().trim().regex(/^\d{6,12}$/),
  classCode: z.string().trim().min(1).max(30).transform((code) => code.toUpperCase()),
  phoneNumber: internationalPhoneSchema,
  challengeId: z.string().regex(/^[a-f\d]{64}$/i),
  captcha: z.string().length(6).regex(/^[A-Za-z0-9]{6}$/),
  purpose: z.enum(['recover', 'change'])
});
const passwordChangeSchema = z.object({
  resetToken: z.string().regex(/^[a-f\d]{64}$/i),
  password: managementPasswordSchema,
  confirmPassword: z.string().min(1).max(200)
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Mật khẩu và mật khẩu xác nhận không khớp.',
  path: ['confirmPassword']
});

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createCaptchaText() {
  return Array.from({ length: 6 }, () => CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)]).join('');
}

function digest(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function createOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function captchaSvg(text) {
  return svgCaptcha(text, {
    width: 190, height: 54, fontSize: 32, noise: 2,
    color: false, background: '#eef2ff'
  });
}

function createPasswordRecovery({
  models, smsProvider, secret = process.env.JWT_SECRET, clock = Date.now,
  hashPassword = bcrypt.hash, captchaGenerator = createCaptchaText
}) {
  if (!secret || secret.length < 32) throw new Error('A strong secret is required for password recovery.');

  function now() {
    return new Date(clock());
  }

  async function consumeThrottle(scope, value, limit, windowMs) {
    const current = now();
    const windowStart = Math.floor(current.getTime() / windowMs);
    const key = digest(`${scope}:${value}:${windowStart}`, secret);
    try {
      const bucket = await models.RecoveryThrottle.findOneAndUpdate(
        { key },
        { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date((windowStart + 2) * windowMs) } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return {
        allowed: bucket.count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil(((windowStart + 1) * windowMs - current.getTime()) / 1000))
      };
    } catch (error) {
      if (error.code === 11000) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      throw error;
    }
  }

  async function createCaptcha(purpose) {
    const answer = captchaGenerator();
    const challengeId = randomToken();
    const created = now();
    await models.RecoveryChallenge.create({
      token_hash: digest(challengeId, secret),
      stage: 'captcha',
      purpose,
      captcha_hash: digest(answer.toLowerCase(), secret),
      captcha_expires_at: new Date(created.getTime() + CAPTCHA_TTL_MS),
      expires_at: new Date(created.getTime() + CAPTCHA_TTL_MS)
    });
    return { challengeId, image: captchaSvg(answer), expiresInSeconds: CAPTCHA_TTL_MS / 1000 };
  }

  async function consumeCaptcha(challengeId, captcha, purpose) {
    const current = now();
    const challenge = await models.RecoveryChallenge.findOneAndUpdate({
      token_hash: digest(challengeId, secret),
      stage: 'captcha',
      captcha_expires_at: { $gt: current },
      expires_at: { $gt: current }
    }, {
      $set: { stage: 'checking' }
    }, { new: true });
    if (!challenge || challenge.purpose !== purpose) return null;
    const valid = crypto.timingSafeEqual(
      Buffer.from(challenge.captcha_hash, 'hex'),
      Buffer.from(digest(captcha.toLowerCase(), secret), 'hex')
    );
    if (!valid) {
      await models.RecoveryChallenge.deleteOne({ _id: challenge._id, stage: 'checking' });
      return null;
    }
    return challenge;
  }

  async function findEligibleStudent(identity) {
    const studentId = studentIdFromEmail(identity.email);
    if (!studentId || studentId !== identity.studentId) return null;
    const student = await models.User.findOne({
      email: identity.email,
      role: 'student',
      is_active: true,
      phone_number: identity.phoneNumber,
      phone_verified: true
    }).select('_id email phone_number role');
    if (!student) return null;
    const section = await models.ClassSection.findOne({ code: identity.classCode }).select('_id');
    if (!section) return null;
    const enrolled = await models.Enrollment.exists({
      class_id: section._id,
      student_id: student._id
    });
    return enrolled ? student : null;
  }

  async function requestOtp(identity, ipAddress) {
    if (!smsProvider.isConfigured()) {
      return { status: 'sms_unavailable' };
    }
    const challenge = await consumeCaptcha(identity.challengeId, identity.captcha, identity.purpose);
    if (!challenge) return { status: 'invalid_captcha' };
    const current = now();
    const accountKey = digest(identity.email, secret);
    const phoneKey = digest(identity.phoneNumber, secret);
    const ipKey = digest(ipAddress, secret);
    const throttles = await Promise.all([
      consumeThrottle('request-ip', ipKey, 8, 15 * 60 * 1000),
      consumeThrottle('request-account', accountKey, 5, 60 * 60 * 1000),
      consumeThrottle('request-phone', phoneKey, 5, 60 * 60 * 1000)
    ]);
    const blocked = throttles.filter((throttle) => !throttle.allowed);
    if (blocked.length) {
      return {
        status: 'rate_limited',
        retryAfterSeconds: Math.max(...blocked.map((throttle) => throttle.retryAfterSeconds))
      };
    }

    const student = await findEligibleStudent(identity);
    const otp = createOtp();
    const nextChallenge = {
      stage: 'otp',
      otp_hash: digest(`${identity.challengeId}:${otp}`, secret),
      otp_attempts: 0,
      otp_expires_at: new Date(current.getTime() + OTP_TTL_MS),
      next_resend_at: new Date(current.getTime() + RESEND_DELAY_MS),
      expires_at: new Date(current.getTime() + CHALLENGE_TTL_MS),
      email_hash: accountKey,
      phone_hash: phoneKey,
      ip_hash: ipKey
    };
    if (student) nextChallenge.user_id = student._id;
    const challengeUpdate = await models.RecoveryChallenge.updateOne(
      { _id: challenge._id, stage: 'checking' },
      { $set: nextChallenge, $unset: { captcha_hash: '', captcha_expires_at: '' } },
      { runValidators: true }
    );
    if (!challengeUpdate.matchedCount) throw new Error('Password recovery challenge could not be advanced.');

    if (student) {
      try {
        const delivery = await smsProvider.send(identity.phoneNumber, `Mã xác minh TVU là ${otp}. Mã có hiệu lực trong 5 phút.`);
        if (!delivery?.confirmed) throw new Error('SMS provider did not confirm message delivery.');
      } catch (error) {
        console.error('Password recovery SMS delivery failed:', error.name);
        await models.RecoveryChallenge.deleteOne({ _id: challenge._id, stage: 'otp' });
        return { status: 'accepted', challengeId: identity.challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
      }
    }
    return { status: 'accepted', challengeId: identity.challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
  }

  async function resendOtp(challengeId, ipAddress) {
    if (!smsProvider.isConfigured()) return { status: 'sms_unavailable' };
    const current = now();
    const tokenHash = digest(challengeId, secret);
    const challenge = await models.RecoveryChallenge.findOne({
      token_hash: tokenHash,
      stage: 'otp',
      expires_at: { $gt: current }
    });
    if (!challenge || !challenge.user_id) {
      return { status: 'accepted', challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
    }
    if (challenge.next_resend_at > current) {
      return {
        status: 'resend_limited',
        retryAfterSeconds: Math.ceil((challenge.next_resend_at - current) / 1000)
      };
    }
    const throttles = await Promise.all([
      consumeThrottle('resend-ip', digest(ipAddress, secret), 8, 60 * 60 * 1000),
      consumeThrottle('resend-account', challenge.email_hash, 5, 60 * 60 * 1000),
      consumeThrottle('resend-phone', challenge.phone_hash, 5, 60 * 60 * 1000)
    ]);
    const blocked = throttles.filter((throttle) => !throttle.allowed);
    if (blocked.length) {
      return {
        status: 'rate_limited',
        retryAfterSeconds: Math.max(...blocked.map((throttle) => throttle.retryAfterSeconds))
      };
    }
    const student = await models.User.findOne({
      _id: challenge.user_id, role: 'student', is_active: true, phone_verified: true
    }).select('_id phone_number');
    if (!student || digest(student.phone_number, secret) !== challenge.phone_hash) {
      return { status: 'accepted', challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
    }
    const otp = createOtp();
    const updated = await models.RecoveryChallenge.findOneAndUpdate({
      _id: challenge._id,
      stage: 'otp',
      next_resend_at: { $lte: current },
      expires_at: { $gt: current }
    }, {
      $set: {
        otp_hash: digest(`${challengeId}:${otp}`, secret),
        otp_expires_at: new Date(current.getTime() + OTP_TTL_MS),
        next_resend_at: new Date(current.getTime() + RESEND_DELAY_MS)
      }
    }, { new: true });
    if (!updated) return { status: 'resend_limited', retryAfterSeconds: 60 };
    try {
      const delivery = await smsProvider.send(student.phone_number, `Mã xác minh TVU mới là ${otp}. Mã có hiệu lực trong 5 phút.`);
      if (!delivery?.confirmed) throw new Error('SMS provider did not confirm message delivery.');
    } catch (error) {
      console.error('Password recovery SMS delivery failed:', error.name);
      await models.RecoveryChallenge.deleteOne({ _id: challenge._id, stage: 'otp' });
      return { status: 'accepted', challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
    }
    return { status: 'accepted', challengeId, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
  }

  async function verifyOtp(challengeId, otp) {
    const current = now();
    const resetToken = randomToken();
    const challenge = await models.RecoveryChallenge.findOneAndUpdate({
      token_hash: digest(challengeId, secret),
      stage: 'otp',
      otp_hash: digest(`${challengeId}:${otp}`, secret),
      otp_expires_at: { $gt: current },
      expires_at: { $gt: current },
      otp_attempts: { $lt: MAX_OTP_ATTEMPTS },
      user_id: { $exists: true }
    }, {
      $set: {
        stage: 'verified',
        reset_token_hash: digest(resetToken, secret),
        reset_expires_at: new Date(current.getTime() + RESET_TTL_MS)
      },
      $unset: { otp_hash: '' }
    }, { new: true });
    if (!challenge) {
      await models.RecoveryChallenge.updateOne({
        token_hash: digest(challengeId, secret),
        stage: 'otp',
        otp_expires_at: { $gt: current },
        expires_at: { $gt: current },
        otp_attempts: { $lt: MAX_OTP_ATTEMPTS }
      }, { $inc: { otp_attempts: 1 } });
      return { status: 'invalid_otp' };
    }
    return { status: 'verified', resetToken };
  }

  async function changePassword(resetToken, password) {
    const passwordHash = await hashPassword(password, 12);
    const session = await models.User.db.startSession();
    try {
      let updated = false;
      await session.withTransaction(async () => {
        const challenge = await models.RecoveryChallenge.findOneAndUpdate({
          reset_token_hash: digest(resetToken, secret),
          stage: 'verified',
          reset_expires_at: { $gt: now() },
          expires_at: { $gt: now() }
        }, {
          $set: { stage: 'used' },
          $unset: { reset_token_hash: '' }
        }, { new: true, session });
        if (!challenge) return;
        const result = await models.User.updateOne({
          _id: challenge.user_id,
          role: 'student',
          is_active: true
        }, {
          $set: { password_hash: passwordHash },
          $inc: { auth_version: 1 }
        }, { runValidators: true, session });
        if (!result.matchedCount) return;
        updated = true;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      return updated;
    } finally {
      await session.endSession();
    }
  }

  return { createCaptcha, requestOtp, resendOtp, verifyOtp, changePassword };
}

module.exports = {
  CAPTCHA_TTL_MS, OTP_TTL_MS, RESEND_DELAY_MS, MAX_OTP_ATTEMPTS,
  internationalPhoneSchema, recoveryIdentitySchema, passwordChangeSchema,
  createCaptchaText, createOtp, captchaSvg, digest, randomToken, createPasswordRecovery
};
