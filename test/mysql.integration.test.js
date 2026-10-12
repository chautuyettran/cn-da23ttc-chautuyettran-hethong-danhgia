const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('MySQL-backed API persistence, authorization, evaluation limits, and anonymity', {
  skip: process.env.MYSQL_INTEGRATION_TESTS !== 'true'
    ? 'Set MYSQL_INTEGRATION_TESTS=true and use a dedicated *_test database.'
    : false
}, async () => {
  if (!/_test$/i.test(process.env.MYSQL_DATABASE || '')) {
    throw new Error('Integration tests refuse to run unless MYSQL_DATABASE ends in _test.');
  }
  const bcrypt = require('bcryptjs');
  const { connectDatabase, closePool } = require('../backend/config/mysql');
  const { migrate } = require('../backend/scripts/migrate-mysql');
  const models = require('../backend/models');
  const { app } = require('../backend/app');
  const created = {
    users: [], lecturers: [], courses: [], classes: [], assignments: [], questions: [],
    lecturerQuestions: [], surveys: [], enrollments: []
  };
  let server;
  let baseUrl;

  async function cleanup() {
    const avatarDirectory = process.env.AVATAR_STORAGE_DIR ||
      path.join(__dirname, '..', 'uploads', 'avatars');
    try {
      const filenames = await fs.readdir(avatarDirectory);
      const ownedPrefixes = created.users.flatMap((id) => [`student-${id}-`, `lecturer-${id}-`]);
      await Promise.all(filenames.filter((filename) =>
        ownedPrefixes.some((prefix) => filename.startsWith(prefix))).map((filename) =>
        fs.unlink(path.join(avatarDirectory, filename)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        })));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (created.surveys.length) {
      await Promise.all([
        models.Evaluation.deleteMany({ survey_id: { $in: created.surveys } }),
        models.SubmissionRecord.deleteMany({ survey_id: { $in: created.surveys } }),
        models.SubmissionEligibility.deleteMany({ survey_id: { $in: created.surveys } })
      ]);
    }
    if (created.assignments.length) {
      await models.SubmissionRecord.deleteMany({ assignment_id: { $in: created.assignments } });
      await models.SubmissionEligibility.deleteMany({ assignment_id: { $in: created.assignments } });
    }
    if (created.enrollments.length) {
      await models.Enrollment.deleteMany({ _id: { $in: created.enrollments } });
    }
    const removals = [
      ['LecturerQuestion', created.lecturerQuestions],
      ['SurveyPeriod', created.surveys],
      ['TeachingAssignment', created.assignments],
      ['SurveyQuestion', created.questions],
      ['ClassSection', created.classes],
      ['Course', created.courses],
      ['User', created.users],
      ['Lecturer', created.lecturers]
    ];
    for (const [modelName, ids] of removals) {
      if (ids.length) await models[modelName].deleteMany({ _id: { $in: ids } });
    }
    await stopServer();
    await closePool();
  }

  async function startServer() {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  async function stopServer() {
    if (!server) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  }

  try {
    await migrate();
    await connectDatabase();
    await startServer();
    const token = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    const password = `Integration-${token}-Password`;
    const studentEmail = `${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}@st.tvu.edu.vn`;
    const {
      provisionLecturer, provisionLecturerAccount
    } = require('../backend/services/lecturer-provisioning');

    async function request(path, { cookie, method = 'GET', body } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = response.status === 204 ? {} : await response.json();
      return { response, data };
    }

    async function login(email, loginPassword = password) {
      const { response, data } = await request('/api/auth/login', {
        method: 'POST', body: { email, password: loginPassword }
      });
      assert.equal(response.status, 200, JSON.stringify(data));
      const session = response.headers.get('set-cookie')?.match(/session=([^;]+)/)?.[1];
      assert.ok(session, 'login must issue an HTTP-only session cookie');
      return `session=${session}`;
    }

    const health = await request('/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.data.database, 'connected');
    assert.equal((await request('/api/admin/courses')).response.status, 401);

    const admin = await models.User.create({
      full_name: 'Integration Admin', email: `integration-${token}@example.test`,
      password_hash: await bcrypt.hash(password, 4), role: 'admin'
    });
    created.users.push(admin._id);
    const lecturer = await models.Lecturer.create({
      full_name: 'Integration Lecturer', department: 'Integration',
      email: `integration-${token}@tvu.edu.vn`
    });
    created.lecturers.push(lecturer._id);
    const lecturerUser = await models.User.create({
      full_name: lecturer.full_name, email: lecturer.email,
      password_hash: await bcrypt.hash(password, 4), role: 'lecturer', lecturer_id: lecturer._id
    });
    created.users.push(lecturerUser._id);
    const provisionedLecturer = await provisionLecturer(models.User, models.Lecturer, {
      LECTURER_NAME: 'Provisioned Integration Lecturer',
      LECTURER_EMAIL: `provisioned-${token}@tvu.edu.vn`,
      LECTURER_PASSWORD: password,
      LECTURER_DEPARTMENT: 'Integration'
    });
    created.users.push(provisionedLecturer.user._id);
    created.lecturers.push(provisionedLecturer.user.lecturer_id);
    assert.equal(provisionedLecturer.created, true);
    const repeatedProvisioning = await provisionLecturer(models.User, models.Lecturer, {
      LECTURER_NAME: 'Changed Name Must Not Apply',
      LECTURER_EMAIL: `provisioned-${token}@tvu.edu.vn`,
      LECTURER_PASSWORD: `Different-${token}-password`,
      LECTURER_DEPARTMENT: 'Changed Department Must Not Apply'
    });
    assert.equal(repeatedProvisioning.created, false);
    assert.equal(repeatedProvisioning.user.full_name, 'Provisioned Integration Lecturer');
    const originalTestAccountHash = repeatedProvisioning.user.password_hash;
    await models.User.updateOne({ _id: repeatedProvisioning.user._id }, { $set: { is_active: false } });
    const reactivatedProvisioning = await provisionLecturerAccount(
      models.User,
      models.Lecturer,
      {
        name: 'Must not overwrite the existing profile',
        email: `provisioned-${token}@tvu.edu.vn`,
        password: `Another-${token}-secure`,
        department: 'Must not overwrite'
      },
      { activateExisting: true }
    );
    assert.equal(reactivatedProvisioning.created, false);
    assert.equal(reactivatedProvisioning.activated, true);
    assert.equal(reactivatedProvisioning.user.is_active, true);
    assert.equal(reactivatedProvisioning.user.full_name, 'Provisioned Integration Lecturer');
    assert.equal(reactivatedProvisioning.user.password_hash, originalTestAccountHash);
    const student = await models.User.create({
      full_name: 'Integration Student', email: studentEmail,
      password_hash: await bcrypt.hash(password, 4), role: 'student'
    });
    created.users.push(student._id);
    await assert.rejects(
      provisionLecturerAccount(models.User, models.Lecturer, {
        name: 'Wrong role',
        email: studentEmail,
        password,
        department: 'Integration'
      }),
      /không phải giảng viên/
    );
    const outsider = await models.User.create({
      full_name: 'Integration Outsider',
      email: `${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}@st.tvu.edu.vn`,
      password_hash: await bcrypt.hash(password, 4), role: 'student'
    });
    created.users.push(outsider._id);

    const course = await models.Course.create({
      code: `IT-${token}`.slice(0, 30), title: `Integration course ${token}`
    });
    created.courses.push(course._id);
    const otherLecturer = await models.Lecturer.create({
      full_name: 'Other Integration Lecturer', department: 'Integration',
      email: `other-${token}@tvu.edu.vn`
    });
    created.lecturers.push(otherLecturer._id);
    const otherLecturerUser = await models.User.create({
      full_name: otherLecturer.full_name, email: otherLecturer.email,
      password_hash: await bcrypt.hash(password, 4), role: 'lecturer', lecturer_id: otherLecturer._id
    });
    created.users.push(otherLecturerUser._id);
    const otherCourse = await models.Course.create({
      code: `IO-${token}`.slice(0, 30), title: `Other integration course ${token}`
    });
    created.courses.push(otherCourse._id);
    const section = await models.ClassSection.create({
      code: `IC-${token}`.slice(0, 30), name: `Integration class ${token}`,
      academic_year: '2026-2027', semester: 'Integration'
    });
    created.classes.push(section._id);
    const otherSection = await models.ClassSection.create({
      code: `IX-${token}`.slice(0, 30), name: `Other integration class ${token}`,
      academic_year: '2026-2027', semester: 'Integration'
    });
    created.classes.push(otherSection._id);
    const assignment = await models.TeachingAssignment.create({
      lecturer_id: lecturer._id, course_id: course._id, class_id: section._id,
      academic_year: '2026-2027', semester: 'Integration'
    });
    created.assignments.push(assignment._id);
    const otherAssignment = await models.TeachingAssignment.create({
      lecturer_id: otherLecturer._id, course_id: otherCourse._id, class_id: otherSection._id,
      academic_year: '2026-2027', semester: 'Integration'
    });
    created.assignments.push(otherAssignment._id);
    const question = await models.SurveyQuestion.create({
      text: 'Integration test question?', category: 'Integration'
    });
    created.questions.push(question._id);
    const survey = await models.SurveyPeriod.create({
      assignment_id: assignment._id, title: `Integration survey ${token}`,
      starts_at: new Date(Date.now() - 60_000), ends_at: new Date(Date.now() + 60 * 60_000),
      status: 'open', questions: [{ question_id: question._id, position: 1 }]
    });
    created.surveys.push(survey._id);
    const enrollment = await models.Enrollment.create({ class_id: section._id, student_id: student._id });
    created.enrollments.push(enrollment._id);

    const adminCookie = await login(admin.email);
    const lecturerCookie = await login(lecturerUser.email);
    const studentCookie = await login(student.email);
    const outsiderCookie = await login(outsider.email);
    const lateGlobalQuestion = await models.SurveyQuestion.create({
      text: `Global question added later ${token}`, category: 'Global integration'
    });
    created.questions.push(lateGlobalQuestion._id);
    const blockedGlobalQuestionChange = await request('/api/admin/questions', {
      cookie: adminCookie, method: 'POST',
      body: { text: `Blocked global question ${token}`, category: 'Global integration', is_active: true }
    });
    assert.equal(blockedGlobalQuestionChange.response.status, 409);
    const normalizedLecturerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ` ${lecturerUser.email.toUpperCase()} `, password }
    });
    assert.equal(normalizedLecturerLogin.response.status, 200);
    assert.equal(normalizedLecturerLogin.data.user.role, 'lecturer');
    assert.equal(
      (await request('/api/auth/login', {
        method: 'POST',
        body: { email: lecturerUser.email, password: 'incorrect-password' }
      })).response.status,
      401
    );
    await models.User.updateOne({ _id: lecturerUser._id }, { $set: { is_active: false } });
    assert.equal(
      (await request('/api/auth/login', { method: 'POST', body: { email: lecturerUser.email, password } })).response.status,
      401
    );
    await models.User.updateOne({ _id: lecturerUser._id }, { $set: { is_active: true } });
    assert.equal((await request('/api/admin/courses', { cookie: studentCookie })).response.status, 403);

    const apiSurvey = await request('/api/admin/surveys', {
      cookie: adminCookie, method: 'POST',
      body: {
        assignment_id: String(assignment._id), title: `API survey ${token}`,
        starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        ends_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        status: 'draft', question_ids: [String(question._id)]
      }
    });
    assert.equal(apiSurvey.response.status, 201, JSON.stringify(apiSurvey.data));
    created.surveys.push(apiSurvey.data.id);
    const surveyList = await request('/api/admin/surveys/list', { cookie: adminCookie });
    assert.ok(surveyList.data.items.some((item) => item.id === apiSurvey.data.id));

    const invalidCourse = await request('/api/admin/courses', {
      cookie: adminCookie, method: 'POST', body: { code: '', title: '' }
    });
    assert.equal(invalidCourse.response.status, 400);
    const createdCourse = await request('/api/admin/courses', {
      cookie: adminCookie, method: 'POST',
      body: { code: `CRUD-${token}`.slice(0, 30), title: `CRUD verification ${token}` }
    });
    assert.equal(createdCourse.response.status, 201, JSON.stringify(createdCourse.data));
    const managedCourseId = createdCourse.data.id;
    created.courses.push(managedCourseId);
    const adminCourses = await request('/api/admin/courses', { cookie: adminCookie });
    assert.ok(adminCourses.data.items.some((item) => item.id === managedCourseId));
    assert.ok(adminCourses.data.items.every((item) => !Object.hasOwn(item, 'password_hash')));
    const updatedCourse = await request(`/api/admin/courses/${managedCourseId}`, {
      cookie: adminCookie, method: 'PUT',
      body: { code: `CRUD-${token}`.slice(0, 30), title: `Updated verification ${token}` }
    });
    assert.equal(updatedCourse.response.status, 200);
    const storedCourse = await models.Course.findById(managedCourseId).lean();
    assert.equal(storedCourse.title, `Updated verification ${token}`);
    const deletedCourse = await request(`/api/admin/courses/${managedCourseId}`, {
      cookie: adminCookie, method: 'DELETE'
    });
    assert.equal(deletedCourse.response.status, 200);
    assert.equal(await models.Course.exists({ _id: managedCourseId }), null);

    const persistentCourse = await request('/api/admin/courses', {
      cookie: adminCookie, method: 'POST',
      body: { code: `RESTART-${token}`.slice(0, 30), title: `Restart persistence ${token}` }
    });
    assert.equal(persistentCourse.response.status, 201, JSON.stringify(persistentCourse.data));
    created.courses.push(persistentCourse.data.id);
    await stopServer();
    await startServer();
    const afterRestart = await request('/api/admin/courses', { cookie: adminCookie });
    assert.ok(afterRestart.data.items.some((item) => item.id === persistentCourse.data.id));
    const removePersistentCourse = await request(`/api/admin/courses/${persistentCourse.data.id}`, {
      cookie: adminCookie, method: 'DELETE'
    });
    assert.equal(removePersistentCourse.response.status, 200);

    const available = await request('/api/surveys/available', { cookie: studentCookie });
    assert.ok(available.data.surveys.some((item) => item.id === String(survey._id)));
    const eligibleSurvey = await request(`/api/surveys/${survey._id}`, { cookie: studentCookie });
    assert.equal(eligibleSurvey.response.status, 200);
    assert.equal(eligibleSurvey.data.survey.id, String(survey._id));
    assert.equal(eligibleSurvey.data.questions[0].id, String(question._id));
    assert.ok(eligibleSurvey.data.questions.some((item) => item.id === String(lateGlobalQuestion._id)));
    assert.equal((await request(`/api/surveys/${survey._id}`, { cookie: outsiderCookie })).response.status, 404);
    const answers = eligibleSurvey.data.questions.map((item) => ({ questionId: item.id, score: 4 }));
    const invalidEvaluation = await request(`/api/surveys/${survey._id}/submit`, {
      cookie: studentCookie, method: 'POST',
      body: { answers: [{ ...answers[0], score: 6 }] }
    });
    assert.equal(invalidEvaluation.response.status, 400);
    const deniedEvaluation = await request(`/api/surveys/${survey._id}/submit`, {
      cookie: outsiderCookie, method: 'POST', body: { answers }
    });
    assert.equal(deniedEvaluation.response.status, 403);

    const policy = await models.EvaluationPolicy.findOne({ key: 'global' }).lean();
    assert.ok(policy, 'evaluation policy must be initialized');
    for (let attempt = 0; attempt < policy.max_submissions; attempt += 1) {
      const result = await request(`/api/surveys/${survey._id}/submit`, {
        cookie: studentCookie, method: 'POST', body: { answers, feedback: `Attempt ${attempt + 1}` }
      });
      assert.equal(result.response.status, 201, JSON.stringify(result.data));
      assert.equal(result.data.attemptsUsed, attempt + 1);
      assert.equal(result.data.attemptsRemaining, policy.max_submissions - attempt - 1);
    }
    const blockedAttempt = await request(`/api/surveys/${survey._id}/submit`, {
      cookie: studentCookie, method: 'POST', body: { answers }
    });
    assert.equal(blockedAttempt.response.status, 409);
    assert.equal(await models.Evaluation.countDocuments({ survey_id: survey._id }), policy.max_submissions);
    const storedEvaluation = await models.Evaluation.findOne({ survey_id: survey._id }).lean();
    assert.equal(Object.hasOwn(storedEvaluation, 'student_id'), false);
    assert.equal(await models.SubmissionRecord.countDocuments({
      survey_id: survey._id, student_id: student._id
    }), 1);

    const lecturerCourses = await request('/api/reports/courses', { cookie: lecturerCookie });
    assert.ok(lecturerCourses.data.courses.some((item) => item.id === String(course._id)));
    assert.equal(lecturerCourses.data.courses.some((item) => item.id === String(otherCourse._id)), false);
    const report = await request(`/api/reports?courseId=${course._id}`, { cookie: lecturerCookie });
    assert.equal(report.response.status, 200);
    assert.equal(JSON.stringify(report.data).includes(student.email), false);
    assert.equal(JSON.stringify(report.data).includes(String(student._id)), false);

    assert.equal((await request('/api/lecturer/analytics', { cookie: studentCookie })).response.status, 403);
    assert.equal((await request('/api/lecturer/analytics')).response.status, 401);
    const lecturerAssignments = await request('/api/lecturer/assignments', { cookie: lecturerCookie });
    assert.equal(lecturerAssignments.response.status, 200);
    assert.ok(lecturerAssignments.data.assignments.some((item) => item.assignmentId === String(assignment._id)));
    assert.equal(lecturerAssignments.data.assignments.some((item) => item.assignmentId === String(otherAssignment._id)), false);
    const lecturerSurveys = await request('/api/lecturer/surveys', { cookie: lecturerCookie });
    assert.ok(lecturerSurveys.data.surveys.some((item) => item.id === String(survey._id)));

    const lecturerAnalytics = await request(`/api/lecturer/analytics?courseId=${course._id}`, { cookie: lecturerCookie });
    assert.equal(lecturerAnalytics.response.status, 200, JSON.stringify(lecturerAnalytics.data));
    assert.equal(lecturerAnalytics.data.summary.courseCount, 1);
    assert.ok(lecturerAnalytics.data.periods.length >= 1);
    assert.equal(JSON.stringify(lecturerAnalytics.data).includes(student.email), false);
    assert.equal(JSON.stringify(lecturerAnalytics.data).includes(String(student._id)), false);
    const crossCourseAnalytics = await request(`/api/lecturer/analytics?courseId=${otherCourse._id}`, { cookie: lecturerCookie });
    assert.equal(crossCourseAnalytics.response.status, 404);

    const lecturerProfile = await request('/api/lecturer/profile', { cookie: lecturerCookie });
    assert.equal(lecturerProfile.response.status, 200);
    assert.equal(lecturerProfile.data.profile.department, 'Integration');
    assert.equal(lecturerProfile.data.profile.studentId, '');
    assert.equal((await request('/api/lecturer/profile', { cookie: studentCookie })).response.status, 403);
    const invalidLecturerProfileUpdate = await request('/api/lecturer/profile', {
      cookie: lecturerCookie, method: 'PATCH',
      body: { full_name: 'Changed Lecturer', phone_number: '', github_url: '', role: 'admin' }
    });
    assert.equal(invalidLecturerProfileUpdate.response.status, 400);
    const lecturerProfileUpdate = await request('/api/lecturer/profile', {
      cookie: lecturerCookie, method: 'PATCH',
      body: { full_name: 'Updated Integration Lecturer', phone_number: '', github_url: '' }
    });
    assert.equal(lecturerProfileUpdate.response.status, 200);
    assert.equal(lecturerProfileUpdate.data.profile.department, 'Integration');
    assert.equal((await models.Lecturer.findById(lecturer._id).lean()).full_name, 'Updated Integration Lecturer');
    const sharp = require('sharp');
    const avatarData = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#447799' }
    }).png().toBuffer();
    const avatarForm = new FormData();
    avatarForm.append('avatar', new Blob([avatarData], { type: 'image/png' }), 'untrusted.png');
    const avatarUpload = await fetch(`${baseUrl}/api/lecturer/profile/avatar`, {
      method: 'POST', headers: { Cookie: lecturerCookie }, body: avatarForm
    });
    const avatarResult = await avatarUpload.json();
    assert.equal(avatarUpload.status, 201, JSON.stringify(avatarResult));
    assert.equal(avatarResult.avatarUrl, '/api/lecturer/profile/avatar');
    const storedAvatar = await fetch(`${baseUrl}${avatarResult.avatarUrl}`, {
      headers: { Cookie: lecturerCookie }
    });
    assert.equal(storedAvatar.status, 200);
    assert.match(storedAvatar.headers.get('content-type'), /image\/webp/);
    const avatarDelete = await request('/api/lecturer/profile/avatar', {
      cookie: lecturerCookie, method: 'DELETE'
    });
    assert.equal(avatarDelete.response.status, 200);

    const additionalQuestion = await request('/api/lecturer/questions', {
      cookie: lecturerCookie, method: 'POST',
      body: {
        assignmentId: String(assignment._id), text: `Lecturer question ${token}`,
        category: 'Additional', description: 'Integration question', required: true
      }
    });
    assert.equal(additionalQuestion.response.status, 201, JSON.stringify(additionalQuestion.data));
    created.lecturerQuestions.push(additionalQuestion.data.question.id);
    const lecturerQuestionUpdate = await request(
      `/api/lecturer/questions/${additionalQuestion.data.question.id}`,
      {
        cookie: lecturerCookie, method: 'PUT',
        body: {
          text: `Updated lecturer question ${token}`,
          category: 'Additional updated',
          description: 'Updated integration question',
          required: true
        }
      }
    );
    assert.equal(lecturerQuestionUpdate.response.status, 200, JSON.stringify(lecturerQuestionUpdate.data));
    const adminManagedQuestion = await models.LecturerQuestion.create({
      lecturer_id: otherLecturer._id,
      assignment_id: otherAssignment._id,
      text: `Admin managed lecturer question ${token}`,
      category: 'Admin managed',
      is_active: true
    });
    created.lecturerQuestions.push(adminManagedQuestion._id);
    const adminLecturerQuestions = await request('/api/admin/lecturer-questions', { cookie: adminCookie });
    assert.ok(adminLecturerQuestions.data.items.some((item) => item.id === String(adminManagedQuestion._id)));
    const adminQuestionUpdate = await request(
      `/api/admin/lecturer-questions/${adminManagedQuestion._id}`,
      {
        cookie: adminCookie, method: 'PUT',
        body: {
          text: `Admin updated lecturer question ${token}`,
          category: 'Admin updated',
          description: 'Changed by administrator',
          is_required: true,
          is_active: true
        }
      }
    );
    assert.equal(adminQuestionUpdate.response.status, 200, JSON.stringify(adminQuestionUpdate.data));
    const adminQuestionDelete = await request(
      `/api/admin/lecturer-questions/${adminManagedQuestion._id}`,
      { cookie: adminCookie, method: 'DELETE' }
    );
    assert.equal(adminQuestionDelete.response.status, 200, JSON.stringify(adminQuestionDelete.data));
    const listedQuestions = await request(`/api/lecturer/questions?courseId=${course._id}`, { cookie: lecturerCookie });
    assert.equal(listedQuestions.response.status, 200);
    assert.ok(listedQuestions.data.questions.some((item) => item.id === additionalQuestion.data.question.id));
    const forbiddenQuestionUpdate = await request(
      `/api/lecturer/questions/${additionalQuestion.data.question.id}/status`,
      { cookie: await login(otherLecturerUser.email), method: 'PATCH', body: { active: false } }
    );
    assert.equal(forbiddenQuestionUpdate.response.status, 404);
    const questionDeactivation = await request(
      `/api/lecturer/questions/${additionalQuestion.data.question.id}/status`,
      { cookie: lecturerCookie, method: 'PATCH', body: { active: false } }
    );
    assert.equal(questionDeactivation.response.status, 200);
    const draftSurvey = await models.SurveyPeriod.create({
      assignment_id: assignment._id,
      title: `Draft integration survey ${token}`,
      starts_at: new Date(Date.now() + 60 * 60_000),
      ends_at: new Date(Date.now() + 2 * 60 * 60_000),
      status: 'draft',
      questions: [{ question_id: question._id, position: 1 }]
    });
    created.surveys.push(draftSurvey._id);
    const scopedQuestion = await request('/api/lecturer/questions', {
      cookie: lecturerCookie, method: 'POST',
      body: {
        assignmentId: String(assignment._id),
        surveyId: String(draftSurvey._id),
        text: `Required lecturer survey question ${token}`,
        category: 'Supplemental',
        required: true
      }
    });
    assert.equal(scopedQuestion.response.status, 201, JSON.stringify(scopedQuestion.data));
    created.lecturerQuestions.push(scopedQuestion.data.question.id);
    draftSurvey.status = 'open';
    draftSurvey.starts_at = new Date(Date.now() - 60_000);
    await draftSurvey.save();
    const surveyWithAdditional = await request(`/api/surveys/${draftSurvey._id}`, { cookie: studentCookie });
    assert.equal(surveyWithAdditional.response.status, 200, JSON.stringify(surveyWithAdditional.data));
    assert.ok(surveyWithAdditional.data.questions.some((item) =>
      item.id === scopedQuestion.data.question.id && item.required));
    const changingQuestionDuringSurvey = await request(
      `/api/lecturer/questions/${scopedQuestion.data.question.id}/status`,
      { cookie: lecturerCookie, method: 'PATCH', body: { active: false } }
    );
    assert.equal(changingQuestionDuringSurvey.response.status, 409);
    const missingRequiredQuestion = await request(`/api/surveys/${draftSurvey._id}/submit`, {
      cookie: studentCookie, method: 'POST', body: { answers }
    });
    assert.equal(missingRequiredQuestion.response.status, 400);

    const invalidChange = await request('/api/auth/change-password', {
      cookie: studentCookie, method: 'POST',
      body: { currentPassword: 'wrong-password', newPassword: `New-${token}-secure`, confirmPassword: `New-${token}-secure` }
    });
    assert.equal(invalidChange.response.status, 400);
    const shortPassword = await request('/api/auth/change-password', {
      cookie: studentCookie, method: 'POST',
      body: { currentPassword: password, newPassword: 'short', confirmPassword: 'short' }
    });
    assert.equal(shortPassword.response.status, 400);
    const adminPasswordChange = await request('/api/auth/change-password', {
      cookie: adminCookie, method: 'POST',
      body: { currentPassword: password, newPassword: `New-${token}-secure`, confirmPassword: `New-${token}-secure` }
    });
    assert.equal(adminPasswordChange.response.status, 403);
    const changedPassword = `New-${token}-secure`;
    const passwordChange = await request('/api/auth/change-password', {
      cookie: studentCookie, method: 'POST',
      body: { currentPassword: password, newPassword: changedPassword, confirmPassword: changedPassword }
    });
    assert.equal(passwordChange.response.status, 200, JSON.stringify(passwordChange.data));
    assert.equal((await request('/api/auth/me', { cookie: studentCookie })).response.status, 401);
    const newStudentCookie = await login(student.email, changedPassword);
    assert.equal((await request('/api/auth/me', { cookie: newStudentCookie })).response.status, 200);
    const storedStudent = await models.User.findById(student._id).select('+password_hash').lean();
    assert.equal(await bcrypt.compare(changedPassword, storedStudent.password_hash), true);

    const changedLecturerPassword = `Lecturer-${token}-new`;
    const lecturerPasswordChange = await request('/api/auth/change-password', {
      cookie: lecturerCookie, method: 'POST',
      body: {
        currentPassword: password,
        newPassword: changedLecturerPassword,
        confirmPassword: changedLecturerPassword
      }
    });
    assert.equal(lecturerPasswordChange.response.status, 200, JSON.stringify(lecturerPasswordChange.data));
    assert.equal((await request('/api/auth/me', { cookie: lecturerCookie })).response.status, 401);
    const newLecturerCookie = await login(lecturerUser.email, changedLecturerPassword);
    assert.equal((await request('/api/auth/me', { cookie: newLecturerCookie })).response.status, 200);
  } finally {
    await cleanup();
  }
});
