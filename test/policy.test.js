const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, isRoleEmailValid } = require('../backend/validators/account');
const { evaluationPolicySchema, submissionScopeKey } = require('../backend/validators/policy');
const { csvCell, toCsv } = require('../backend/utils/csv');
const models = require('../backend/models');

test('institutional account email rules normalize case and enforce role domains', () => {
  assert.equal(normalizeEmail('  STUDENT@ST.TVU.EDU.VN '), 'student@st.tvu.edu.vn');
  assert.equal(isRoleEmailValid('student', 'student@st.tvu.edu.vn'), true);
  assert.equal(isRoleEmailValid('student', 'student@tvu.edu.vn'), false);
  assert.equal(isRoleEmailValid('lecturer', 'lecturer@tvu.edu.vn'), true);
  assert.equal(isRoleEmailValid('lecturer', 'lecturer@example.com'), false);
  assert.equal(isRoleEmailValid('admin', 'admin@example.com'), true);
});

test('evaluation policies reject invalid submission and revision settings', () => {
  assert.equal(evaluationPolicySchema.safeParse({
    scope: 'survey', max_submissions: 1, allow_revisions: false, min_report_responses: 5
  }).success, true);
  assert.equal(evaluationPolicySchema.safeParse({
    scope: 'survey', max_submissions: 2, allow_revisions: false, min_report_responses: 5
  }).success, false);
  assert.equal(evaluationPolicySchema.safeParse({
    scope: 'survey', max_submissions: 1, allow_revisions: true, min_report_responses: 5
  }).success, false);
  assert.equal(evaluationPolicySchema.safeParse({
    scope: 'survey', max_submissions: 2, allow_revisions: 'false', min_report_responses: 5
  }).success, false);
  assert.equal(evaluationPolicySchema.safeParse({
    scope: 'unknown', max_submissions: 0, allow_revisions: true, min_report_responses: 0
  }).success, false);
});

test('User model validation enforces institutional email domains', async () => {
  const student = new models.User({
    full_name: 'Sinh viên kiểm thử', email: 'STUDENT@ST.TVU.EDU.VN',
    password_hash: 'hashed', role: 'student'
  });
  await student.validate();
  assert.equal(student.email, 'student@st.tvu.edu.vn');

  const invalid = new models.User({
    full_name: 'Sinh viên sai miền', email: 'student@example.com',
    password_hash: 'hashed', role: 'student'
  });
  await assert.rejects(invalid.validate(), /tên miền @st\.tvu\.edu\.vn/);
});

test('submission scopes separate surveys or group an assignment period', () => {
  const survey = { _id: 'survey-1' };
  const assignment = { _id: 'assignment-1', academic_year: '2026-2027', semester: '1' };
  assert.equal(
    submissionScopeKey({ scope: 'survey' }, survey, assignment),
    'survey:survey-1'
  );
  assert.equal(
    submissionScopeKey({ scope: 'assignment_period' }, survey, assignment),
    'assignment:assignment-1:2026-2027:1'
  );
});

test('CSV output quotes cells and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('line, "two"\nthree'), '"line, ""two""\nthree"');
  assert.equal(toCsv([['Name', 'Score'], ['TVU', 5]]), '"Name","Score"\r\n"TVU","5"');
});
