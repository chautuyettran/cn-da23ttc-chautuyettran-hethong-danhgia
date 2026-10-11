const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {
  TEST_LECTURER_EMAIL,
  readTestLecturerConfiguration,
  provisionTestLecturer,
  provisionLecturerAccount,
  resetTestLecturerPassword
} = require('../backend/services/lecturer-provisioning');
const { authenticateCredentials } = require('../backend/services/authentication');

function createProvisioningModels() {
  const users = [];
  const lecturers = [];
  const session = {
    async withTransaction(callback) { return callback(); },
    async endSession() {}
  };
  function makeQuery(value) {
    return {
      session() { return this; },
      then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
    };
  }
  function attachSave(user) {
    user.save = async () => user;
    return user;
  }
  const User = {
    db: { async startSession() { return session; } },
    findOne(filter) {
      return makeQuery(users.find((user) =>
        (filter.email === undefined || user.email === filter.email) &&
        (filter.lecturer_id === undefined || user.lecturer_id === filter.lecturer_id)) || null);
    },
    async create(entries) {
      const values = Array.isArray(entries) ? entries : [entries];
      const result = values.map((entry) => {
        if (users.some((user) => user.email === entry.email)) {
          const error = new Error('duplicate key');
          error.code = 11000;
          throw error;
        }
        const user = attachSave({ ...entry, _id: `user-${users.length + 1}`, auth_version: 0 });
        users.push(user);
        return user;
      });
      return Array.isArray(entries) ? result : result[0];
    },
    async updateOne(filter, update) {
      const user = users.find((entry) => String(entry._id) === String(filter._id) && entry.role === filter.role);
      if (!user) return { matchedCount: 0 };
      Object.assign(user, update.$set || {});
      for (const [key, amount] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + amount;
      return { matchedCount: 1 };
    }
  };
  const Lecturer = {
    findOne(filter) {
      return makeQuery(lecturers.find((lecturer) => lecturer.email === filter.email) || null);
    },
    async create(entries) {
      const values = Array.isArray(entries) ? entries : [entries];
      const result = values.map((entry) => {
        if (lecturers.some((lecturer) => lecturer.email === entry.email)) {
          const error = new Error('duplicate key');
          error.code = 11000;
          throw error;
        }
        const lecturer = { ...entry, _id: `lecturer-${lecturers.length + 1}` };
        lecturers.push(lecturer);
        return lecturer;
      });
      return Array.isArray(entries) ? result : result[0];
    }
  };
  return { User, Lecturer, users, lecturers };
}

function createUserModel(user) {
  return {
    findOne(filter) {
      return Promise.resolve(user?.email === filter.email ? user : null);
    },
    async updateOne(filter, update) {
      if (!user || String(user._id) !== String(filter._id) || user.role !== filter.role) {
        return { matchedCount: 0 };
      }
      Object.assign(user, update.$set || {});
      for (const [key, amount] of Object.entries(update.$inc || {})) {
        user[key] = (user[key] || 0) + amount;
      }
      return { matchedCount: 1 };
    }
  };
}

test('test lecturer configuration uses the fixed normalized identity and requires a strong local password', () => {
  const { scripts } = require('../package.json');
  assert.equal(scripts['test-lecturer-provision'], 'node backend/scripts/provision-test-lecturer.js');
  assert.throws(() => readTestLecturerConfiguration({}), /TEST_LECTURER_PASSWORD/);
  assert.throws(
    () => readTestLecturerConfiguration({ TEST_LECTURER_PASSWORD: 'short' }),
    /12 đến 200/
  );
  const password = `local-${crypto.randomUUID()}`;
  const config = readTestLecturerConfiguration({ TEST_LECTURER_PASSWORD: password });
  assert.equal(config.email, TEST_LECTURER_EMAIL);
  assert.equal(config.name, 'Giảng viên kiểm thử');
  assert.equal(config.department, 'Khoa chưa cập nhật');
  assert.equal(config.password, password);
});

test('test lecturer password reset requires confirmation, hashes the password and revokes old sessions', async () => {
  const originalPassword = `old-${crypto.randomUUID()}`;
  const newPassword = `new-${crypto.randomUUID()}`;
  const originalPasswordHash = await bcrypt.hash(originalPassword, 4);
  const user = {
    _id: 'lecturer-1',
    email: TEST_LECTURER_EMAIL,
    role: 'lecturer',
    is_active: true,
    auth_version: 2,
    password_hash: originalPasswordHash
  };
  const User = createUserModel(user);
  const config = { TEST_LECTURER_PASSWORD: newPassword };

  await assert.rejects(
    resetTestLecturerPassword(User, config, false),
    /--confirm/
  );
  assert.equal(user.password_hash, originalPasswordHash);
  assert.equal(user.auth_version, 2);

  const result = await resetTestLecturerPassword(User, config, true);
  assert.equal(result.isActive, true);
  assert.equal(user.password_hash === config.TEST_LECTURER_PASSWORD, false);
  assert.equal(await bcrypt.compare(config.TEST_LECTURER_PASSWORD, user.password_hash), true);
  assert.equal(user.auth_version, 3);
});

test('test lecturer provisioning creates once, keeps existing credentials and enables disabled test account', async () => {
  const { User, Lecturer, users, lecturers } = createProvisioningModels();
  const password = `test-${crypto.randomUUID()}`;
  const environment = { TEST_LECTURER_PASSWORD: password };

  const created = await provisionTestLecturer(User, Lecturer, environment);
  assert.equal(created.created, true);
  assert.equal(created.user.email, TEST_LECTURER_EMAIL);
  assert.equal(created.user.role, 'lecturer');
  assert.equal(created.user.is_active, true);
  assert.notEqual(created.user.password_hash, password);
  assert.equal(await bcrypt.compare(password, created.user.password_hash), true);
  assert.equal(users.length, 1);
  assert.equal(lecturers.length, 1);

  const originalHash = created.user.password_hash;
  const repeated = await provisionTestLecturer(User, Lecturer, {
    TEST_LECTURER_PASSWORD: `different-${crypto.randomUUID()}`,
    TEST_LECTURER_NAME: 'Do not replace the account name'
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.user.password_hash, originalHash);
  assert.equal(repeated.user.full_name, 'Giảng viên kiểm thử');
  assert.equal(users.length, 1);
  assert.equal(lecturers.length, 1);

  created.user.is_active = false;
  created.user.auth_version = 4;
  const reactivated = await provisionTestLecturer(User, Lecturer, environment);
  assert.equal(reactivated.activated, true);
  assert.equal(reactivated.user.is_active, true);
  assert.equal(reactivated.user.auth_version, 5);
  assert.equal(reactivated.user.password_hash, originalHash);
});

test('provisioning refuses a fixed test email already owned by another role', async () => {
  const { User, Lecturer, lecturers } = createProvisioningModels();
  await User.create([{
    email: TEST_LECTURER_EMAIL,
    role: 'student',
    full_name: 'Existing student',
    password_hash: 'existing-hash',
    is_active: true
  }]);
  await assert.rejects(
    provisionLecturerAccount(User, Lecturer, {
      name: 'Test',
      email: TEST_LECTURER_EMAIL,
      password: `test-${crypto.randomUUID()}`,
      department: 'Test'
    }),
    /không phải giảng viên/
  );
  assert.equal((await User.findOne({ email: TEST_LECTURER_EMAIL })).role, 'student');
  assert.equal(lecturers.length, 0);
});

test('lecturer login normalizes email, checks bcrypt and rejects disabled accounts', async () => {
  const password = `login-${crypto.randomUUID()}`;
  const user = {
    _id: 'lecturer-2',
    email: TEST_LECTURER_EMAIL,
    role: 'lecturer',
    is_active: true,
    password_hash: await bcrypt.hash(password, 4)
  };
  const User = {
    findOne(filter) {
      const query = {
        select() { return query; },
        then(resolve, reject) {
          return Promise.resolve(filter.email === user.email ? user : null).then(resolve, reject);
        }
      };
      return query;
    }
  };

  const authenticated = await authenticateCredentials(
    User, `  ${TEST_LECTURER_EMAIL.toUpperCase()}  `, password
  );
  assert.equal(authenticated.role, 'lecturer');
  assert.equal(await authenticateCredentials(User, TEST_LECTURER_EMAIL, 'wrong-password'), null);
  user.is_active = false;
  assert.equal(await authenticateCredentials(User, TEST_LECTURER_EMAIL, password), null);
});
