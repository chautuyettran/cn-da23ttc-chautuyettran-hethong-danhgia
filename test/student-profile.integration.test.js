const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config();

test('MongoDB-backed student profiles enforce ownership and persist validated avatar uploads', {
  skip: process.env.MONGODB_INTEGRATION_TESTS !== 'true'
    ? 'Set MONGODB_INTEGRATION_TESTS=true to run against the configured MongoDB database.'
    : false
}, async () => {
  const bcrypt = require('bcryptjs');
  const sharp = require('sharp');
  const { connectDatabase, mongoose } = require('../backend/config/db');
  const models = require('../backend/models');
  const { app } = require('../backend/app');
  const createdUsers = [];
  const createdClasses = [];
  const createdEnrollments = [];
  let server;
  let baseUrl;
  let firstAvatarPath = '';
  let secondAvatarPath = '';

  async function stopServer() {
    if (!server) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  }

  async function startServer() {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  async function cleanup() {
    const studentIds = createdUsers.map((user) => String(user));
    if (studentIds.length) {
      const avatarDirectory = process.env.AVATAR_STORAGE_DIR ||
        path.join(__dirname, '..', 'uploads', 'avatars');
      try {
        const filenames = await fs.readdir(avatarDirectory);
        const ownedNames = filenames.filter((filename) =>
          studentIds.some((id) => filename.startsWith(`student-${id}-`)));
        await Promise.all(ownedNames.map((filename) =>
          fs.unlink(path.join(avatarDirectory, filename)).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          })));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (createdEnrollments.length) {
      await models.Enrollment.deleteMany({ _id: { $in: createdEnrollments } });
    }
    if (createdClasses.length) {
      await models.ClassSection.deleteMany({ _id: { $in: createdClasses } });
    }
    if (createdUsers.length) {
      await models.User.deleteMany({ _id: { $in: createdUsers } });
    }
    await stopServer();
    await mongoose.disconnect();
  }

  try {
    await connectDatabase();
    const marker = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    const password = `Profile-${marker}-Integration`;
    const makeStudentEmail = () =>
      `${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}@st.tvu.edu.vn`;
    const firstEmail = makeStudentEmail();
    const secondEmail = makeStudentEmail();
    const adminEmail = `profile-admin-${marker}@example.test`;
    const firstStudent = await models.User.create({
      full_name: 'Sinh viên kiểm thử hồ sơ',
      email: firstEmail,
      password_hash: await bcrypt.hash(password, 4),
      role: 'student',
      phone_number: '+84901234567',
      phone_verified: true
    });
    const secondStudent = await models.User.create({
      full_name: 'Sinh viên kiểm thử khác',
      email: secondEmail,
      password_hash: await bcrypt.hash(password, 4),
      role: 'student'
    });
    const administrator = await models.User.create({
      full_name: 'Quản trị kiểm thử hồ sơ',
      email: adminEmail,
      password_hash: await bcrypt.hash(password, 4),
      role: 'admin'
    });
    const lecturer = await models.User.create({
      full_name: 'Giảng viên kiểm thử hồ sơ',
      email: `profile-lecturer-${marker}@tvu.edu.vn`,
      password_hash: await bcrypt.hash(password, 4),
      role: 'lecturer'
    });
    createdUsers.push(firstStudent._id, secondStudent._id, administrator._id, lecturer._id);
    const section = await models.ClassSection.create({
      code: `PROF-${marker}`.slice(0, 30),
      name: `Lớp kiểm thử ${marker}`,
      academic_year: '2026-2027',
      semester: 'Kiểm thử'
    });
    createdClasses.push(section._id);
    const enrollment = await models.Enrollment.create({
      class_id: section._id,
      student_id: firstStudent._id
    });
    createdEnrollments.push(enrollment._id);
    await startServer();

    async function request(url, { cookie, method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers
        },
        ...(body instanceof FormData ? { body } : body ? { body: JSON.stringify(body) } : {})
      });
      const contentType = response.headers.get('content-type') || '';
      return {
        response,
        data: contentType.includes('application/json') ? await response.json() : null,
        bytes: contentType.startsWith('image/') ? Buffer.from(await response.arrayBuffer()) : null
      };
    }

    async function login(email) {
      const { response, data } = await request('/api/auth/login', {
        method: 'POST', body: { email, password }
      });
      assert.equal(response.status, 200, JSON.stringify(data));
      const session = response.headers.get('set-cookie')?.match(/session=([^;]+)/)?.[1];
      assert.ok(session);
      return `session=${session}`;
    }

    const firstCookie = await login(firstEmail);
    const secondCookie = await login(secondEmail);
    const adminCookie = await login(adminEmail);
    const lecturerCookie = await login(lecturer.email);

    assert.equal((await request('/api/student/profile')).response.status, 401);
    assert.equal((await request('/api/student/profile', { cookie: adminCookie })).response.status, 403);
    assert.equal((await request('/api/student/profile', { cookie: lecturerCookie })).response.status, 403);

    const initial = await request('/api/student/profile', { cookie: firstCookie });
    assert.equal(initial.response.status, 200, JSON.stringify(initial.data));
    assert.deepEqual(initial.data.profile, {
      fullName: 'Sinh viên kiểm thử hồ sơ',
      classNames: [`Lớp kiểm thử ${marker}`],
      classCodes: [`PROF-${marker}`.slice(0, 30)],
      studentId: firstEmail.split('@')[0],
      email: firstEmail,
      phoneNumber: '+84901234567',
      githubUrl: '',
      avatarUrl: ''
    });
    assert.equal(JSON.stringify(initial.data).includes('password_hash'), false);

    const otherProfile = await request(`/api/student/profile?studentId=${firstEmail}`, {
      cookie: secondCookie
    });
    assert.equal(otherProfile.response.status, 200);
    assert.equal(otherProfile.data.profile.email, secondEmail);
    assert.equal((await request(`/api/student/profile/${firstStudent._id}`, {
      cookie: secondCookie
    })).response.status, 404);
    assert.equal((await request('/api/student/profile/avatar', {
      cookie: secondCookie
    })).response.status, 404);

    const updateBody = {
      full_name: 'Tên sinh viên đã cập nhật',
      phone_number: '+84987654321',
      github_url: 'https://github.com/student-profile'
    };
    const updated = await request('/api/student/profile', {
      cookie: firstCookie, method: 'PATCH', body: updateBody
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.profile.fullName, updateBody.full_name);
    assert.equal(updated.data.profile.phoneNumber, updateBody.phone_number);
    assert.equal(updated.data.profile.githubUrl, updateBody.github_url);
    const savedStudent = await models.User.findById(firstStudent._id).lean();
    assert.equal(savedStudent.phone_verified, false, 'changing the phone must clear the old verification');

    for (const invalid of [
      { ...updateBody, phone_number: '0901234567' },
      { ...updateBody, github_url: 'http://github.com/student-profile' },
      { ...updateBody, github_url: 'https://github.com/user/repository' },
      { ...updateBody, github_url: 'https://github.com/user--name' },
      { ...updateBody, github_url: 'https://evil.example/student-profile' },
      { ...updateBody, role: 'admin' },
      { ...updateBody, email: secondEmail },
      { ...updateBody, is_active: false },
      { ...updateBody, auth_version: 99 }
    ]) {
      assert.equal((await request('/api/student/profile', {
        cookie: firstCookie, method: 'PATCH', body: invalid
      })).response.status, 400, JSON.stringify(invalid));
    }

    async function uploadAvatar(cookie, name, type, bytes) {
      const body = new FormData();
      body.append('avatar', new Blob([bytes], { type }), name);
      return request('/api/student/profile/avatar', { cookie, method: 'POST', body });
    }

    const invalidImage = await uploadAvatar(firstCookie, 'not-image.png', 'image/png', Buffer.from('not a real image'));
    assert.equal(invalidImage.response.status, 415, JSON.stringify(invalidImage.data));
    const oversizedImage = await uploadAvatar(
      firstCookie,
      'large.png',
      'image/png',
      Buffer.alloc(2 * 1024 * 1024 + 1)
    );
    assert.equal(oversizedImage.response.status, 413, JSON.stringify(oversizedImage.data));
    assert.equal((await uploadAvatar(firstCookie, 'wrong.svg', 'image/svg+xml', Buffer.from('<svg/>'))).response.status, 415);
    assert.equal((await request('/api/student/profile/avatar', {
      cookie: adminCookie, method: 'POST', body: new FormData()
    })).response.status, 403);

    const png = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#4477aa' }
    }).png().toBuffer();
    const firstUpload = await uploadAvatar(firstCookie, 'untrusted-original-name.png', 'image/png', png);
    assert.equal(firstUpload.response.status, 201, JSON.stringify(firstUpload.data));
    assert.equal(firstUpload.data.avatarUrl, '/api/student/profile/avatar');
    let storedStudent = await models.User.findById(firstStudent._id).lean();
    assert.match(storedStudent.avatar_filename, new RegExp(`^student-${firstStudent._id}-[a-f\\d-]{36}\\.webp$`));
    assert.equal(storedStudent.avatar_filename.includes('untrusted-original-name'), false);
    firstAvatarPath = path.join(
      process.env.AVATAR_STORAGE_DIR || path.join(__dirname, '..', 'uploads', 'avatars'),
      storedStudent.avatar_filename
    );
    const ownerImage = await request('/api/student/profile/avatar', { cookie: firstCookie });
    assert.equal(ownerImage.response.status, 200);
    assert.equal(ownerImage.response.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(ownerImage.bytes).metadata()).format, 'webp');
    assert.equal((await request('/api/student/profile/avatar', {
      cookie: secondCookie
    })).response.status, 404);

    const secondUpload = await uploadAvatar(firstCookie, 'replacement.webp', 'image/webp', await sharp({
      create: { width: 64, height: 32, channels: 3, background: '#884422' }
    }).webp().toBuffer());
    assert.equal(secondUpload.response.status, 201, JSON.stringify(secondUpload.data));
    storedStudent = await models.User.findById(firstStudent._id).lean();
    secondAvatarPath = path.join(
      process.env.AVATAR_STORAGE_DIR || path.join(__dirname, '..', 'uploads', 'avatars'),
      storedStudent.avatar_filename
    );
    await assert.rejects(fs.access(firstAvatarPath), { code: 'ENOENT' });
    await fs.access(secondAvatarPath);

    await stopServer();
    await startServer();
    const afterRestart = await request('/api/student/profile', { cookie: firstCookie });
    assert.equal(afterRestart.response.status, 200);
    assert.equal(afterRestart.data.profile.githubUrl, updateBody.github_url);
    const avatarAfterRestart = await request('/api/student/profile/avatar', { cookie: firstCookie });
    assert.equal(avatarAfterRestart.response.status, 200);
    assert.equal((await sharp(avatarAfterRestart.bytes).metadata()).format, 'webp');

    await fs.unlink(secondAvatarPath);
    const deleteMissing = await request('/api/student/profile/avatar', {
      cookie: firstCookie, method: 'DELETE'
    });
    assert.equal(deleteMissing.response.status, 200, JSON.stringify(deleteMissing.data));
    assert.equal((await models.User.findById(firstStudent._id).lean()).avatar_filename, '');
    const reuploaded = await uploadAvatar(firstCookie, 'final.png', 'image/png', png);
    assert.equal(reuploaded.response.status, 201);
    const finalStudent = await models.User.findById(firstStudent._id).lean();
    const finalPath = path.join(
      process.env.AVATAR_STORAGE_DIR || path.join(__dirname, '..', 'uploads', 'avatars'),
      finalStudent.avatar_filename
    );
    const deleted = await request('/api/student/profile/avatar', {
      cookie: firstCookie, method: 'DELETE'
    });
    assert.equal(deleted.response.status, 200);
    assert.equal((await models.User.findById(firstStudent._id).lean()).avatar_filename, '');
    await assert.rejects(fs.access(finalPath), { code: 'ENOENT' });
  } finally {
    await cleanup();
  }
});
