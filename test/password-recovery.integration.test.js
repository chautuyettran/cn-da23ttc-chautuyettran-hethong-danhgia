const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

test('MongoDB-backed student recovery validates identity, CAPTCHA, SMS OTP, and one-time password reset', {
  skip: process.env.MONGODB_INTEGRATION_TESTS !== 'true'
    ? 'Set MONGODB_INTEGRATION_TESTS=true to run against the configured MongoDB database.'
    : false
}, async () => {
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const { once } = require('node:events');
  const { connectDatabase, mongoose } = require('../backend/config/db');
  const models = require('../backend/models');
  const authRoutes = require('../backend/routes/auth');
  const { createRecoveryRouter } = require('../backend/routes/recovery');
  const { digest, randomToken, CAPTCHA_TTL_MS, OTP_TTL_MS } = require('../backend/services/password-recovery');
  const secret = process.env.JWT_SECRET;
  const records = { users: [], classes: [], enrollments: [] };
  const challengeIds = [];
  let server;
  let requestCount = 0;
  const initialTime = Date.now();
  let currentTime = initialTime;
  const sentMessages = [];
  const testMarker = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
  const ip = `recovery-test-${testMarker}`;
  const password = `Original-${testMarker}-Password`;
  const studentId = String(Math.floor(Math.random() * 1000000000)).padStart(9, '0');
  const email = `${studentId}@st.tvu.edu.vn`;
  const phone = `+849${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
  const classCode = `RC${testMarker}`.slice(0, 30).toUpperCase();

  async function closeServer() {
    if (!server) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  }

  async function cleanup() {
    if (challengeIds.length) {
      await models.RecoveryChallenge.deleteMany({
        token_hash: { $in: challengeIds.map((id) => digest(id, secret)) }
      });
    }
    if (records.enrollments.length) {
      await models.Enrollment.deleteMany({ _id: { $in: records.enrollments } });
    }
    if (records.users.length) {
      await models.User.deleteMany({ _id: { $in: records.users } });
    }
    if (records.classes.length) {
      await models.ClassSection.deleteMany({ _id: { $in: records.classes } });
    }
    const timeWindows = [initialTime, currentTime, currentTime - 60 * 60 * 1000, currentTime + 60 * 60 * 1000];
    const rateKeys = new Set();
    for (const timestamp of timeWindows) {
      const requestWindow = Math.floor(timestamp / (60 * 60 * 1000));
      const ipRequestWindow = Math.floor(timestamp / (15 * 60 * 1000));
      const resendWindow = Math.floor(timestamp / (60 * 60 * 1000));
      for (const address of [email, '111111111@st.tvu.edu.vn']) {
        rateKeys.add(digest(`request-account:${digest(address, secret)}:${requestWindow}`, secret));
      }
      for (const number of [phone, '+84999999999']) {
        rateKeys.add(digest(`request-phone:${digest(number, secret)}:${requestWindow}`, secret));
      }
      rateKeys.add(digest(`request-ip:${digest(ip, secret)}:${ipRequestWindow}`, secret));
      rateKeys.add(digest(`resend-account:${digest(email, secret)}:${resendWindow}`, secret));
      rateKeys.add(digest(`resend-phone:${digest(phone, secret)}:${resendWindow}`, secret));
      rateKeys.add(digest(`resend-ip:${digest(ip, secret)}:${resendWindow}`, secret));
    }
    await models.RecoveryThrottle.deleteMany({ key: { $in: [...rateKeys] } });
    await closeServer();
    await mongoose.disconnect();
  }

  try {
    await connectDatabase();
    const user = await models.User.create({
      full_name: 'Password recovery integration student',
      email,
      password_hash: await bcrypt.hash(password, 4),
      role: 'student',
      phone_number: phone,
      phone_verified: true
    });
    records.users.push(user._id);
    const section = await models.ClassSection.create({
      code: classCode,
      name: `Recovery integration class ${testMarker}`,
      academic_year: '2026-2027',
      semester: 'Integration'
    });
    records.classes.push(section._id);
    const enrollment = await models.Enrollment.create({ class_id: section._id, student_id: user._id });
    records.enrollments.push(enrollment._id);

    const smsProvider = {
      isConfigured: () => true,
      async send(to, message) {
        sentMessages.push({ to, code: message.match(/\b\d{6}\b/)?.[0] });
        return { confirmed: true };
      }
    };
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(require('cookie-parser')());
    app.use('/api/auth', authRoutes);
    app.use('/api/auth/recovery', createRecoveryRouter({
      models,
      smsProvider,
      secret,
      clock: () => currentTime,
      captchaGenerator: () => 'Ab2Cd3',
      getClientIp: () => ip
    }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(path, body, method = 'POST', cookie) {
      requestCount += 1;
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'X-Forwarded-For': `192.0.2.${requestCount}`,
          ...(cookie ? { Cookie: cookie } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return {
        response,
        data: await response.json()
      };
    }

    async function captcha(purpose = 'recover') {
      const result = await request('/api/auth/recovery/captcha', { purpose });
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
      challengeIds.push(result.data.challengeId);
      const solution = 'Ab2Cd3';
      assert.match(solution, /^[A-Za-z0-9]{6}$/);
      assert.doesNotMatch(result.data.image, /<text\b|Ab2Cd3/);
      return { challengeId: result.data.challengeId, solution };
    }

    async function requestCode(overrides = {}) {
      const challenge = await captcha('recover');
      const body = {
        challengeId: challenge.challengeId,
        captcha: challenge.solution,
        purpose: 'recover',
        email,
        studentId,
        classCode,
        phoneNumber: phone,
        ...overrides
      };
      return { challenge, ...(await request('/api/auth/recovery/request-otp', body)) };
    }

    const expiredChallenge = await captcha();
    const beforeExpiry = currentTime;
    currentTime += CAPTCHA_TTL_MS + 1;
    const expiredCaptcha = await request('/api/auth/recovery/request-otp', {
      challengeId: expiredChallenge.challengeId,
      captcha: expiredChallenge.solution,
      purpose: 'recover',
      email,
      studentId,
      classCode,
      phoneNumber: phone
    });
    assert.equal(expiredCaptcha.response.status, 400);
    currentTime = beforeExpiry;

    const oneUse = await captcha();
    const wrongCaptcha = await request('/api/auth/recovery/request-otp', {
      challengeId: oneUse.challengeId,
      captcha: `${oneUse.solution[0] === '0' ? '1' : '0'}${oneUse.solution.slice(1)}`,
      purpose: 'recover',
      email,
      studentId,
      classCode,
      phoneNumber: phone
    });
    assert.equal(wrongCaptcha.response.status, 400);
    const replayCaptcha = await request('/api/auth/recovery/request-otp', {
      challengeId: oneUse.challengeId,
      captcha: oneUse.solution,
      purpose: 'recover',
      email,
      studentId,
      classCode,
      phoneNumber: phone
    });
    assert.equal(replayCaptcha.response.status, 400);

    const invalidEmailDomain = await requestCode({ email: 'person@example.com' });
    assert.equal(invalidEmailDomain.response.status, 400);
    const invalidAdminRecovery = await requestCode({ email: `admin-${testMarker}@example.com` });
    assert.equal(invalidAdminRecovery.response.status, 400);

    const mismatchRequests = [
      { email: `111111111@st.tvu.edu.vn`, studentId },
      { studentId: studentId === '999999999' ? '999999998' : '999999999' },
      { classCode: `${classCode}X` },
      { phoneNumber: '+84999999999' }
    ];
    let genericResponse;
    for (const mismatch of mismatchRequests) {
      const result = await requestCode(mismatch);
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
      if (!genericResponse) genericResponse = result.data;
      else {
        assert.equal(result.data.message, genericResponse.message);
        assert.deepEqual(Object.keys(result.data).sort(), Object.keys(genericResponse).sort());
      }
    }
    assert.equal(sentMessages.length, 0);

    const issued = await requestCode();
    assert.equal(issued.response.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.message, genericResponse.message);
    assert.deepEqual(Object.keys(issued.data).sort(), Object.keys(genericResponse).sort());
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, phone);
    let otp = sentMessages[0].code;
    assert.match(otp, /^\d{6}$/);
    const storedChallenge = await models.RecoveryChallenge.findOne({
      token_hash: digest(issued.challenge.challengeId, secret)
    }).lean();
    assert.notEqual(storedChallenge.otp_hash, otp);
    assert.equal(storedChallenge.captcha_hash, undefined);
    const finalAllowedRequest = await requestCode({ phoneNumber: '+84999999999' });
    assert.equal(finalAllowedRequest.response.status, 200);
    const rateLimitedAccount = await requestCode();
    assert.equal(rateLimitedAccount.response.status, 429);
    assert.match(rateLimitedAccount.response.headers.get('retry-after') || '', /^\d+$/);
    assert.equal(sentMessages.length, 1);

    const wrongOtp = otp === '999999' ? '000000' : '999999';
    assert.equal((await request('/api/auth/recovery/verify-otp', {
      challengeId: issued.challenge.challengeId, otp: wrongOtp
    })).response.status, 400);
    const tooSoon = await request('/api/auth/recovery/resend-otp', {
      challengeId: issued.challenge.challengeId
    });
    assert.equal(tooSoon.response.status, 429);
    currentTime += 61 * 1000;
    const resent = await request('/api/auth/recovery/resend-otp', {
      challengeId: issued.challenge.challengeId
    });
    assert.equal(resent.response.status, 200);
    assert.equal(sentMessages.length, 2);

    currentTime += OTP_TTL_MS + 1;
    assert.equal((await request('/api/auth/recovery/verify-otp', {
      challengeId: issued.challenge.challengeId, otp: sentMessages[1].code
    })).response.status, 400);
    const resentAfterExpiry = await request('/api/auth/recovery/resend-otp', {
      challengeId: issued.challenge.challengeId
    });
    assert.equal(resentAfterExpiry.response.status, 200);
    assert.equal(sentMessages.length, 3);
    otp = sentMessages[2].code;

    const login = await request('/api/auth/login', { email, password });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie')?.match(/session=([^;]+)/)?.[1];
    assert.ok(cookie);

    const verified = await request('/api/auth/recovery/verify-otp', {
      challengeId: issued.challenge.challengeId, otp
    });
    assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
    assert.match(verified.data.resetToken, /^[a-f\d]{64}$/i);
    assert.equal((await request('/api/auth/recovery/verify-otp', {
      challengeId: issued.challenge.challengeId, otp
    })).response.status, 400);

    assert.equal((await request('/api/auth/recovery/reset-password', {
      resetToken: verified.data.resetToken,
      password: 'new-recovery-password',
      confirmPassword: 'different-password'
    })).response.status, 400);
    assert.equal((await request('/api/auth/recovery/reset-password', {
      resetToken: verified.data.resetToken,
      password: 'short',
      confirmPassword: 'short'
    })).response.status, 400);
    const reset = await request('/api/auth/recovery/reset-password', {
      resetToken: verified.data.resetToken,
      password: 'new-recovery-password',
      confirmPassword: 'new-recovery-password'
    });
    assert.equal(reset.response.status, 200, JSON.stringify(reset.data));
    assert.equal(await models.User.countDocuments({ _id: user._id }), 1);
    const savedUser = await models.User.findById(user._id).select('+password_hash').lean();
    assert.equal(await bcrypt.compare('new-recovery-password', savedUser.password_hash), true);
    assert.equal(savedUser.role, 'student');
    assert.equal(savedUser.is_active, true);
    assert.equal(savedUser.phone_number, phone);
    assert.equal(savedUser.phone_verified, true);
    assert.equal(savedUser.auth_version, 1);
    assert.equal((await request('/api/auth/recovery/reset-password', {
      resetToken: verified.data.resetToken,
      password: 'another-password',
      confirmPassword: 'another-password'
    })).response.status, 400);
    assert.equal((await request('/api/auth/me', null, 'GET', `session=${cookie}`)).response.status, 401);

    const newLogin = await request('/api/auth/login', {
      email, password: 'new-recovery-password'
    });
    assert.equal(newLogin.response.status, 200);
    assert.equal((await request('/api/auth/login', { email, password })).response.status, 401);

    currentTime += 60 * 60 * 1000 + 1;
    const limitedOtp = await requestCode();
    assert.equal(limitedOtp.response.status, 200, JSON.stringify(limitedOtp.data));
    const activeOtp = sentMessages.at(-1).code;
    const wrongAttempt = activeOtp === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await request('/api/auth/recovery/verify-otp', {
        challengeId: limitedOtp.challenge.challengeId, otp: wrongAttempt
      })).response.status, 400);
    }
    assert.equal((await request('/api/auth/recovery/verify-otp', {
      challengeId: limitedOtp.challenge.challengeId, otp: activeOtp
    })).response.status, 400, 'the correct OTP must be rejected after the attempt limit');

    const administratorEmail = `recovery-admin-${testMarker}@example.com`;
    const administrator = await models.User.create({
      full_name: 'Password recovery integration administrator',
      email: administratorEmail,
      password_hash: await bcrypt.hash(password, 4),
      role: 'admin'
    });
    records.users.push(administrator._id);
    const administratorChallengeId = randomToken();
    const administratorResetToken = randomToken();
    challengeIds.push(administratorChallengeId);
    await models.RecoveryChallenge.create({
      token_hash: digest(administratorChallengeId, secret),
      stage: 'verified',
      purpose: 'recover',
      user_id: administrator._id,
      reset_token_hash: digest(administratorResetToken, secret),
      reset_expires_at: new Date(currentTime + 10 * 60 * 1000),
      expires_at: new Date(currentTime + 10 * 60 * 1000)
    });
    const blockedAdminReset = await request('/api/auth/recovery/reset-password', {
      resetToken: administratorResetToken,
      password: 'blocked-admin-recovery-password',
      confirmPassword: 'blocked-admin-recovery-password'
    });
    assert.equal(blockedAdminReset.response.status, 400);
    const unchangedAdministrator = await models.User.findById(administrator._id)
      .select('+password_hash').lean();
    assert.equal(await bcrypt.compare(password, unchangedAdministrator.password_hash), true);
  } finally {
    await cleanup();
  }
});
