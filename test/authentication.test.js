const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { authenticateCredentials } = require('../backend/services/authentication');
const { provisionStudentAccount } = require('../backend/services/student-provisioning');
const { requireRole } = require('../backend/middleware/auth');
const {
  MANAGEMENT_PASSWORD_MIN_LENGTH, managementPasswordSchema
} = require('../backend/validators/account');

function createUserModel(records) {
  return {
    findOne(filter) {
      const chain = {
        select() {
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve(records.get(filter.email) || null).then(resolve, reject);
        }
      };
      return chain;
    },
    async updateOne(filter, update) {
      let existing = records.get(filter.email);
      const upsertedCount = existing ? 0 : 1;
      if (!existing) {
        existing = { ...update.$setOnInsert, _id: `user-${records.size + 1}` };
        records.set(filter.email, existing);
      }
      return { upsertedCount };
    }
  };
}

test('student provisioning creates one active student using a bcrypt-hashed 9-digit ID', async () => {
  const records = new Map();
  const User = createUserModel(records);
  const { user, created } = await provisionStudentAccount(User, '  110122189@st.tvu.edu.vn ');

  assert.equal(created, true);
  assert.equal(user.email, '110122189@st.tvu.edu.vn');
  assert.equal(user.role, 'student');
  assert.equal(user.is_active, true);
  assert.equal(await bcrypt.compare('110122189', user.password_hash), true);
  assert.notEqual(user.password_hash, '110122189');

  const again = await provisionStudentAccount(User, user.email);
  assert.equal(again.created, false);
  assert.equal(records.size, 1);
  assert.equal(await bcrypt.compare('110122189', again.user.password_hash), true);
});

test('login authenticates valid password, normalizes email and keeps student role', async () => {
  const records = new Map();
  const passwordHash = await bcrypt.hash('110122189', 12);
  records.set('110122189@st.tvu.edu.vn', {
    _id: 'student-1',
    email: '110122189@st.tvu.edu.vn',
    role: 'student',
    is_active: true,
    password_hash: passwordHash
  });
  const User = createUserModel(records);

  const user = await authenticateCredentials(User, ' 110122189@ST.TVU.EDU.VN ', '110122189');
  assert.equal(user.role, 'student');
  assert.equal(user.is_active, true);

  let authorized = false;
  requireRole('student')({ user }, { status() { return this; }, json() {} }, () => { authorized = true; });
  assert.equal(authorized, true);

  let lecturerDenied = false;
  let responseStatus;
  requireRole('lecturer')(
    { user },
    { status(code) { responseStatus = code; return this; }, json() {} },
    () => { lecturerDenied = true; }
  );
  assert.equal(lecturerDenied, false);
  assert.equal(responseStatus, 403);
});

test('login rejects incorrect passwords, nonexistent accounts and disabled accounts', async () => {
  const records = new Map();
  records.set('student@st.tvu.edu.vn', {
    email: 'student@st.tvu.edu.vn',
    role: 'student',
    is_active: true,
    password_hash: await bcrypt.hash('correct-password', 12)
  });
  records.set('disabled@st.tvu.edu.vn', {
    email: 'disabled@st.tvu.edu.vn',
    role: 'student',
    is_active: false,
    password_hash: await bcrypt.hash('correct-password', 12)
  });
  const User = createUserModel(records);

  assert.equal(await authenticateCredentials(User, 'student@st.tvu.edu.vn', 'wrong-password'), null);
  assert.equal(await authenticateCredentials(User, 'missing@st.tvu.edu.vn', 'correct-password'), null);
  assert.equal(await authenticateCredentials(User, 'disabled@st.tvu.edu.vn', 'correct-password'), null);
});

test('management account password policy remains at least 12 characters', () => {
  assert.equal(MANAGEMENT_PASSWORD_MIN_LENGTH, 12);
  assert.equal(managementPasswordSchema.safeParse('short9').success, false);
  assert.equal(managementPasswordSchema.safeParse('twelve-char').success, false);
  assert.equal(managementPasswordSchema.safeParse('valid-password').success, true);
});
