require('dotenv').config();

const bcrypt = require('bcryptjs');
const { connectDatabase, closePool } = require('../backend/config/mysql');
const { migrate } = require('../backend/scripts/migrate-mysql');
const models = require('../backend/models');
const { provisionStudentAccount } = require('../backend/services/student-provisioning');
const { normalizeEmail, studentIdFromEmail } = require('../backend/validators/account');

async function upsert(Model, filter, update) {
  return Model.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true, runValidators: true });
}

async function main() {
  await migrate();
  await connectDatabase();
  await Promise.all(Object.values(models)
    .filter((model) => typeof model.createIndexes === 'function')
    .map((model) => model.createIndexes()));
  const minReportResponses = Number(process.env.MIN_REPORT_RESPONSES || 5);
  if (!Number.isInteger(minReportResponses) || minReportResponses < 1 || minReportResponses > 1000) {
    throw new Error('MIN_REPORT_RESPONSES must be an integer between 1 and 1000.');
  }
  await models.EvaluationPolicy.updateOne(
    { key: 'global' },
    { $setOnInsert: {
      key: 'global', scope: 'survey', max_submissions: 1, allow_revisions: false,
      min_report_responses: minReportResponses
    } },
    { upsert: true, runValidators: true }
  );
  const lecturer = await upsert(models.Lecturer, { email: 'lecturer.demo@tvu.edu.vn' }, {
    full_name: 'Giảng viên minh họa', department: 'Khoa minh họa', email: 'lecturer.demo@tvu.edu.vn'
  });
  const course = await upsert(models.Course, { code: 'DEMO-101' }, {
    code: 'DEMO-101', title: 'Học phần minh họa', description: 'Dữ liệu mẫu tổng hợp, không đại diện cho hồ sơ TVU.'
  });
  const section = await upsert(models.ClassSection, { code: 'DEMO-CLASS' }, {
    code: 'DEMO-CLASS', name: 'Lớp minh họa', academic_year: '2026-2027', semester: 'Học kỳ 1'
  });
  const assignment = await upsert(models.TeachingAssignment, {
    lecturer_id: lecturer._id, course_id: course._id, class_id: section._id,
    academic_year: '2026-2027', semester: 'Học kỳ 1'
  }, {
    lecturer_id: lecturer._id, course_id: course._id, class_id: section._id,
    academic_year: '2026-2027', semester: 'Học kỳ 1'
  });
  const questions = [];
  const samples = [
    ['Giảng viên thể hiện kiến thức chuyên môn vững vàng.', 'Kiến thức chuyên môn'],
    ['Phương pháp giảng dạy giúp tôi hiểu bài.', 'Phương pháp giảng dạy'],
    ['Giảng viên giao tiếp rõ ràng và tôn trọng sinh viên.', 'Giao tiếp'],
    ['Giảng viên khuyến khích tương tác trong lớp học.', 'Tương tác lớp học'],
    ['Học phần được tổ chức và thông báo kế hoạch rõ ràng.', 'Tổ chức học phần']
  ];
  for (const [text, category] of samples) {
    questions.push(await upsert(models.SurveyQuestion, { text }, { text, category, is_active: true }));
  }
  const period = await upsert(models.SurveyPeriod, { title: 'Khảo sát minh họa TVU 2026-2027' }, {
    assignment_id: assignment._id,
    title: 'Khảo sát minh họa TVU 2026-2027',
    description: 'Khảo sát mẫu để kiểm tra giao diện. Không phải khảo sát chính thức của TVU.',
    starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: 'open',
    questions: questions.map((question, index) => ({ question_id: question._id, position: index + 1 }))
  });
  const lecturerAccountEmail = process.env.SEED_LECTURER_EMAIL;
  const studentEmail = process.env.SEED_STUDENT_EMAIL;
  if (lecturerAccountEmail && process.env.SEED_LECTURER_PASSWORD) {
    await upsert(models.User, { email: lecturerAccountEmail.toLowerCase() }, {
      full_name: 'Tài khoản giảng viên minh họa', email: lecturerAccountEmail.toLowerCase(),
      role: 'lecturer', lecturer_id: lecturer._id,
      password_hash: await bcrypt.hash(process.env.SEED_LECTURER_PASSWORD, 12), is_active: true
    });
  }
  if (studentEmail) {
    const normalizedStudentEmail = normalizeEmail(studentEmail);
    if (!studentIdFromEmail(normalizedStudentEmail)) {
      throw new Error('SEED_STUDENT_EMAIL must be an MSSV of 6–12 digits followed by @st.tvu.edu.vn.');
    }
    const { user: student, created } = await provisionStudentAccount(models.User, normalizedStudentEmail);
    await models.Enrollment.updateOne(
      { class_id: section._id, student_id: student._id },
      { $setOnInsert: { class_id: section._id, student_id: student._id } },
      { upsert: true }
    );
    console.log(`Tài khoản sinh viên ${created ? 'đã được tạo' : 'đã tồn tại'}; mật khẩu không bị thay đổi.`);
  }
  console.log(`Đã khởi tạo dữ liệu minh họa. Khảo sát: ${period._id}`);
  console.log('Dữ liệu giảng viên, lớp và học phần chỉ là dữ liệu minh họa, không phải thông tin TVU.');
}

main()
  .catch((error) => {
    console.error('Không thể tạo dữ liệu minh họa:', error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
