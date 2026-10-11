const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPTCHA_TTL_MS,
  OTP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  recoveryIdentitySchema,
  passwordChangeSchema,
  createCaptchaText,
  createOtp,
  captchaSvg,
  digest
} = require('../backend/services/password-recovery');
const { TwilioSmsProvider } = require('../backend/services/sms-provider');

const studentIdentity = {
  email: '110122189@st.tvu.edu.vn',
  studentId: '110122189',
  classCode: 'DA23TTC',
  phoneNumber: '+84901234567',
  challengeId: 'a'.repeat(64),
  captcha: 'aB3dE7',
  purpose: 'recover'
};

test('CAPTCHA generation uses six mixed-case alphanumeric characters and returns an SVG', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const text = createCaptchaText();
    assert.match(text, /^[A-Za-z0-9]{6}$/);
    assert.match(captchaSvg(text), /<svg[\s\S]*<\/svg>/);
    assert.match(captchaSvg(text), /<path\b/);
    assert.doesNotMatch(captchaSvg(text), /<text\b|>[\w]{6}</);
  }
  assert.equal(CAPTCHA_TTL_MS, 5 * 60 * 1000);
  assert.equal(OTP_TTL_MS, 5 * 60 * 1000);
  assert.equal(MAX_OTP_ATTEMPTS, 5);
});

test('OTP is six digits including leading zeroes and recovery digests are keyed', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) assert.match(createOtp(), /^\d{6}$/);
  assert.equal(digest('test-value', 'a'.repeat(32)), digest('test-value', 'a'.repeat(32)));
  assert.notEqual(digest('test-value', 'a'.repeat(32)), digest('test-value', 'b'.repeat(32)));
});

test('student recovery validates the institutional email, matching MSSV shape, class and E.164 phone', () => {
  assert.equal(recoveryIdentitySchema.safeParse(studentIdentity).success, true);
  assert.equal(recoveryIdentitySchema.safeParse({ ...studentIdentity, email: 'student@example.com' }).success, false);
  assert.equal(recoveryIdentitySchema.safeParse({ ...studentIdentity, phoneNumber: '0901234567' }).success, false);
  assert.equal(recoveryIdentitySchema.safeParse({ ...studentIdentity, studentId: 'ABC123' }).success, false);
  assert.equal(recoveryIdentitySchema.safeParse({ ...studentIdentity, purpose: 'admin' }).success, false);
});

test('password recovery requires matching confirmation and the existing 12-character policy', () => {
  const valid = { resetToken: 'f'.repeat(64), password: 'new-secure-password', confirmPassword: 'new-secure-password' };
  assert.equal(passwordChangeSchema.safeParse(valid).success, true);
  assert.equal(passwordChangeSchema.safeParse({ ...valid, confirmPassword: 'different-password' }).success, false);
  assert.equal(passwordChangeSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success, false);
  assert.equal(passwordChangeSchema.safeParse({ ...valid, resetToken: 'not-a-token' }).success, false);
});

test('Twilio provider requires configuration and confirms an accepted SMS without logging its contents', async () => {
  const unconfigured = new TwilioSmsProvider({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(unconfigured.send('+84901234567', 'OTP 123456'), /chưa được cấu hình/);

  let sentRequest;
  const configured = new TwilioSmsProvider({
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'AC-test-account',
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    TWILIO_FROM_NUMBER: '+84987654321'
  }, async (url, options) => {
    sentRequest = { url, options };
    return { ok: true, async json() { return { sid: 'SM-test-message' }; } };
  });
  assert.deepEqual(await configured.send('+84901234567', 'OTP 123456'), { confirmed: true });
  assert.match(sentRequest.url, /Accounts\/AC-test-account\/Messages\.json$/);
  assert.equal(sentRequest.options.method, 'POST');
  assert.equal(sentRequest.options.body.get('To'), '+84901234567');
  assert.equal(sentRequest.options.body.get('From'), '+84987654321');
  assert.equal(sentRequest.options.body.get('Body'), 'OTP 123456');

  const rejected = new TwilioSmsProvider(configured.environment, async () => ({ ok: false }));
  await assert.rejects(rejected.send('+84901234567', 'OTP 123456'), /không xác nhận/);
  const missingReceipt = new TwilioSmsProvider(configured.environment, async () => ({
    ok: true, async json() { return {}; }
  }));
  await assert.rejects(missingReceipt.send('+84901234567', 'OTP 123456'), /không xác nhận/);
});
