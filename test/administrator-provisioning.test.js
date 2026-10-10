const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
  authenticateCredentials
} = require('../backend/services/authentication');
const {
  readAdministratorConfiguration, provisionAdministrator,
  resetAdministratorPassword
} = require('../backend/services/administrator-provisioning');
const { requireRole } = require('../backend/middleware/auth');
const { isRoleEmailValid } = require('../backend/validators/account');

const validEnvironment = {
  ADMIN_NAME: 'TVU Administrator',
  ADMIN_EMAIL: 'Admin@Example.org',
  ADMIN_PASSWORD: 'a-secure-password'
};

function createUserModel(records = new Map()) {
  return {
    records,
    findOne(filter) {
      const result = records.get(filter.email) || null;
      const query = {
        select() { return query; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
      };
      return query;
    },
    async create(values) {
      if (records.has(values.email)) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      const user = { ...values, _id: `user-${records.size + 1}` };
      records.set(user.email, user);
      return user;
    },
    async updateOne(filter, update) {
      const user = [...records.values()].find((record) =>
        String(record._id) === String(filter._id) && record.role === filter.role
      );
      if (!user) return { matchedCount: 0 };
      Object.assign(user, update.$set);
      return { matchedCount: 1 };
    }
  };
}

test('administrator provisioning creates an active admin with bcrypt hash and normalized email', async () => {
  const User = createUserModel();
  const { user, created } = await provisionAdministrator(User, validEnvironment);

  assert.equal(created, true);
  assert.equal(user.email, 'admin@example.org');
  assert.equal(user.role, 'admin');
  assert.equal(user.is_active, true);
  assert.notEqual(user.password_hash, validEnvironment.ADMIN_PASSWORD);
  assert.equal(await bcrypt.compare(validEnvironment.ADMIN_PASSWORD, user.password_hash), true);
});

test('administrator provisioning is idempotent and never resets an existing password', async () => {
  const User = createUserModel();
  const first = await provisionAdministrator(User, validEnvironment);
  const originalHash = first.user.password_hash;
  first.user.is_active = false;
  const repeat = await provisionAdministrator(User, {
    ...validEnvironment,
    ADMIN_PASSWORD: 'a-different-secure-password'
  });

  assert.equal(repeat.created, false);
  assert.equal(repeat.user.password_hash, originalHash);
  assert.equal(repeat.user.is_active, false);
  assert.equal(User.records.size, 1);
});

test('administrator provisioning rejects an email already owned by a non-admin', async () => {
  const records = new Map([['admin@example.org', {
    email: 'admin@example.org', role: 'student'
  }]]);

  await assert.rejects(
    provisionAdministrator(createUserModel(records), validEnvironment),
    /không phải quản trị viên/
  );
  assert.equal(records.get('admin@example.org').role, 'student');
});

test('administrator password reset requires explicit confirmation and preserves account role and status', async () => {
  const User = createUserModel();
  const original = await provisionAdministrator(User, validEnvironment);
  original.user.is_active = false;
  const nextPassword = 'another-strong-password';

  await assert.rejects(
    resetAdministratorPassword(User, { ...validEnvironment, ADMIN_PASSWORD: nextPassword }, false),
    /--confirm/
  );
  assert.equal(await bcrypt.compare(validEnvironment.ADMIN_PASSWORD, original.user.password_hash), true);

  const result = await resetAdministratorPassword(
    User, { ...validEnvironment, ADMIN_PASSWORD: nextPassword }, true
  );
  assert.equal(result.isActive, false);
  assert.equal(original.user.role, 'admin');
  assert.equal(original.user.is_active, false);
  assert.equal(await bcrypt.compare(nextPassword, original.user.password_hash), true);
  assert.equal(await bcrypt.compare(validEnvironment.ADMIN_PASSWORD, original.user.password_hash), false);
});

test('administrator password reset refuses missing or incompatible accounts', async () => {
  const User = createUserModel(new Map([['admin@example.org', {
    _id: 'student-1', email: 'admin@example.org', role: 'student', is_active: true
  }]]));
  const config = { ...validEnvironment, ADMIN_PASSWORD: 'another-strong-password' };

  await assert.rejects(resetAdministratorPassword(createUserModel(), config, true), /Không tìm thấy/);
  await assert.rejects(resetAdministratorPassword(User, config, true), /không phải quản trị viên/);
  assert.equal(User.records.get('admin@example.org').role, 'student');
});

test('administrator configuration requires all values, an allowed email domain and 12+ character password', () => {
  assert.throws(() => readAdministratorConfiguration({}), /ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD/);
  assert.throws(
    () => readAdministratorConfiguration({ ...validEnvironment, ADMIN_EMAIL: 'person@st.tvu.edu.vn' }),
    /không thuộc miền/
  );
  assert.throws(
    () => readAdministratorConfiguration({ ...validEnvironment, ADMIN_EMAIL: 'person@tvu.edu.vn' }),
    /không thuộc miền/
  );
  assert.throws(
    () => readAdministratorConfiguration({ ...validEnvironment, ADMIN_PASSWORD: 'short' }),
    /12 đến 200/
  );
  assert.equal(readAdministratorConfiguration(validEnvironment).email, 'admin@example.org');
  assert.equal(isRoleEmailValid('admin', 'person@st.tvu.edu.vn'), false);
  assert.equal(isRoleEmailValid('admin', 'person@tvu.edu.vn'), false);
});

test('admin login authenticates bcrypt credentials and only admin receives admin authorization', async () => {
  const User = createUserModel();
  const provisioned = await provisionAdministrator(User, validEnvironment);

  const user = await authenticateCredentials(User, ' ADMIN@EXAMPLE.ORG ', validEnvironment.ADMIN_PASSWORD);
  assert.equal(user.role, 'admin');
  assert.equal(await authenticateCredentials(User, user.email, 'incorrect-password'), null);
  assert.equal(await authenticateCredentials(User, 'missing@example.org', validEnvironment.ADMIN_PASSWORD), null);

  for (const role of ['admin', 'student', 'lecturer']) {
    let authorized = false;
    let responseStatus;
    requireRole('admin')(
      { user: { ...provisioned.user, role } },
      { status(code) { responseStatus = code; return this; }, json() {} },
      () => { authorized = true; }
    );
    assert.equal(authorized, role === 'admin');
    assert.equal(responseStatus, role === 'admin' ? undefined : 403);
  }
});
