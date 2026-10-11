const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const mongoose = require('mongoose');
const models = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  normalizeEmail, isRoleEmailValid, accountEmailError,
  MANAGEMENT_PASSWORD_MIN_LENGTH, managementPasswordSchema
} = require('../validators/account');
const { evaluationPolicySchema, submissionScopeKey } = require('../validators/policy');
const { toCsv } = require('../utils/csv');

const router = express.Router();
router.use(authenticate);
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const nameSchema = z.string().trim().min(1).max(150);
const resources = {
  lecturers: { model: models.Lecturer, fields: ['full_name', 'department', 'email'] },
  courses: { model: models.Course, fields: ['code', 'title', 'description'] },
  classes: { model: models.ClassSection, fields: ['code', 'name', 'academic_year', 'semester'] },
  questions: { model: models.SurveyQuestion, fields: ['text', 'category', 'is_active'] },
  'lecturer-questions': {
    model: models.LecturerQuestion,
    fields: ['text', 'category', 'description', 'is_required', 'is_active']
  }
};

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function asId(value) {
  return objectIdSchema.safeParse(String(value || '')).success
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function serialize(doc) {
  if (!doc) return doc;
  const data = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const output = { ...data, id: String(data._id) };
  delete output._id;
  delete output.__v;
  return output;
}

function userView(user) {
  return { id: String(user._id), name: user.full_name, email: user.email, role: user.role };
}

function duplicateError(error) {
  return error?.code === 11000;
}

router.get('/overview', requireRole('admin', 'lecturer'), async (req, res, next) => {
  try {
    if (req.user.role === 'lecturer' && !req.user.lecturerId) {
      return res.status(403).json({ error: 'Tài khoản giảng viên chưa được liên kết hồ sơ giảng viên.' });
    }
    const assignmentFilter = req.user.role === 'lecturer' ? { lecturer_id: asId(req.user.lecturerId) } : {};
    const assignmentIds = await models.TeachingAssignment.find(assignmentFilter).distinct('_id');
    const courseIds = await models.TeachingAssignment.find(assignmentFilter).distinct('course_id');
    const classIds = await models.TeachingAssignment.find(assignmentFilter).distinct('class_id');
    const scope = req.user.role === 'lecturer' ? { assignment_id: { $in: assignmentIds } } : {};
    const [courses, classes, lecturers, activeSurveys, responseCount] = await Promise.all([
      req.user.role === 'lecturer' ? courseIds.length : models.Course.countDocuments(),
      req.user.role === 'lecturer' ? classIds.length : models.ClassSection.countDocuments(),
      req.user.role === 'lecturer' ? 1 : models.Lecturer.countDocuments(),
      models.SurveyPeriod.countDocuments({
        ...scope, status: 'open', starts_at: { $lte: new Date() }, ends_at: { $gte: new Date() }
      }),
      models.Evaluation.countDocuments(scope)
    ]);
    const match = req.user.role === 'lecturer' ? { lecturer_id: asId(req.user.lecturerId) } : {};
    const [score] = await models.Evaluation.aggregate([
      { $match: match },
      { $unwind: '$answers' },
      { $group: { _id: null, average: { $avg: '$answers.score' } } }
    ]);
    const policy = await getEvaluationPolicy();
    const threshold = policy.min_report_responses;
    return res.json({
      courses, classes, lecturers, activeSurveys,
      responses: req.user.role === 'lecturer' && responseCount < threshold ? null : responseCount,
      averageScore: responseCount < threshold ? null : Number((score?.average || 0).toFixed(2))
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/surveys/available', requireRole('student'), async (req, res, next) => {
  try {
    const policy = await getEvaluationPolicy();
    const enrollments = await models.Enrollment.find({ student_id: req.user.id }).select('class_id').lean();
    const classIds = enrollments.map((entry) => entry.class_id);
    const assignments = await models.TeachingAssignment.find({ class_id: { $in: classIds } })
      .populate('lecturer_id', 'full_name')
      .populate('course_id', 'title code')
      .populate('class_id', 'name').lean();
    const assignmentById = new Map(assignments.map((assignment) => [String(assignment._id), assignment]));
    const periods = await models.SurveyPeriod.find({
      assignment_id: { $in: assignments.map((assignment) => assignment._id) },
      status: 'open', starts_at: { $lte: new Date() }, ends_at: { $gte: new Date() }
    }).sort({ ends_at: 1 }).lean();
    const scopes = periods.map((period) => {
      const assignment = assignmentById.get(String(period.assignment_id));
      return assignment ? submissionScopeKey(policy, period, assignment) : '';
    }).filter(Boolean);
    const records = await models.SubmissionRecord.find({
      scope_key: { $in: scopes }, student_id: req.user.id
    }).select('scope_key attempts survey_id').lean();
    const recordsByScope = new Map(records.map((record) => [record.scope_key, record]));
    const legacyFilter = policy.scope === 'survey'
      ? { survey_id: { $in: periods.map((period) => period._id) }, student_id: req.user.id }
      : { assignment_id: { $in: assignments.map((assignment) => assignment._id) }, student_id: req.user.id };
    const legacy = await models.SubmissionEligibility.find(legacyFilter)
      .select('survey_id assignment_id academic_year semester').lean();
    return res.json({
      surveys: periods.map((period) => {
        const assignment = assignmentById.get(String(period.assignment_id));
        const scopeKey = assignment ? submissionScopeKey(policy, period, assignment) : '';
        const record = recordsByScope.get(scopeKey);
        const legacySubmission = legacy.some((entry) => policy.scope === 'survey'
          ? String(entry.survey_id) === String(period._id)
          : String(entry.assignment_id) === String(assignment?._id) &&
            entry.academic_year === assignment?.academic_year &&
            entry.semester === assignment?.semester);
        const attemptsUsed = record?.attempts || (legacySubmission ? 1 : 0);
        return {
          id: String(period._id), title: period.title, course_title: assignment?.course_id?.title || '',
          class_name: assignment?.class_id?.name || '', lecturer_name: assignment?.lecturer_id?.full_name || '',
          ends_at: period.ends_at,
          submitted: Boolean(record && String(record.survey_id) === String(period._id)) || legacySubmission,
          attemptsUsed,
          attemptsRemaining: Math.max(0, policy.max_submissions - attemptsUsed),
          maxSubmissions: policy.max_submissions,
          allowRevisions: policy.allow_revisions
        };
      })
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/surveys/:id', requireRole('student'), async (req, res, next) => {
  const surveyId = asId(req.params.id);
  if (!surveyId) return badRequest(res, 'Mã khảo sát không hợp lệ.');
  try {
    const period = await models.SurveyPeriod.findOne({
      _id: surveyId, status: 'open', starts_at: { $lte: new Date() }, ends_at: { $gte: new Date() }
    }).populate({
      path: 'assignment_id',
      populate: [{ path: 'course_id', select: 'title' }, { path: 'lecturer_id', select: 'full_name' }]
    });
    if (!period) return res.status(404).json({ error: 'Không tìm thấy khảo sát đang mở.' });
    const eligible = await models.Enrollment.exists({
      student_id: req.user.id, class_id: period.assignment_id.class_id
    });
    if (!eligible) return res.status(404).json({ error: 'Bạn không thuộc lớp được đánh giá.' });
    const policy = await getEvaluationPolicy();
    const scopeKey = submissionScopeKey(policy, period, period.assignment_id);
    const submissionRecord = await models.SubmissionRecord.findOne({
      scope_key: scopeKey, student_id: req.user.id
    }).select('attempts');
    const legacyFilter = policy.scope === 'survey'
      ? { survey_id: period._id, student_id: req.user.id }
      : {
          assignment_id: period.assignment_id._id, academic_year: period.assignment_id.academic_year,
          semester: period.assignment_id.semester, student_id: req.user.id
        };
    const legacySubmission = await models.SubmissionEligibility.exists(legacyFilter);
    const attemptsUsed = submissionRecord?.attempts || (legacySubmission ? 1 : 0);
    if (legacySubmission && !submissionRecord) {
      return res.status(409).json({ error: 'Bạn đã gửi đánh giá cho khảo sát này.' });
    }
    if (attemptsUsed >= policy.max_submissions) {
      return res.status(409).json({ error: 'Bạn đã sử dụng hết số lần gửi đánh giá được phép.' });
    }
    if (attemptsUsed && !policy.allow_revisions) {
      return res.status(409).json({ error: 'Bạn đã gửi đánh giá cho khảo sát này.' });
    }
    const questions = await models.SurveyQuestion.find({ is_active: true })
      .sort({ createdAt: 1, _id: 1 }).lean();
    const positionById = new Map(period.questions.map((entry) => [String(entry.question_id), entry.position]));
    const standardQuestions = questions
      .sort((a, b) => (positionById.get(String(a._id)) || Number.MAX_SAFE_INTEGER) -
        (positionById.get(String(b._id)) || Number.MAX_SAFE_INTEGER))
      .map((question) => ({
        id: String(question._id), text: question.text, category: question.category,
        required: true, additional: false
      }));
    const additionalQuestions = await models.LecturerQuestion.find({
      lecturer_id: period.assignment_id.lecturer_id._id,
      assignment_id: period.assignment_id._id,
      is_active: true,
      $or: [
        { survey_id: period._id },
        { survey_id: null, createdAt: { $lte: period.starts_at } },
        { survey_id: { $exists: false }, createdAt: { $lte: period.starts_at } }
      ]
    }).sort({ createdAt: 1 }).lean();
    const ordered = [
      ...standardQuestions,
      ...additionalQuestions.map((question) => ({
        id: String(question._id),
        text: question.text,
        category: question.category,
        description: question.description,
        required: question.is_required,
        additional: true
      }))
    ];
    if (!ordered.length) return res.status(409).json({ error: 'Khảo sát chưa có câu hỏi.' });
    return res.json({
      survey: {
        id: String(period._id), title: period.title, description: period.description,
        course_title: period.assignment_id.course_id.title,
        lecturer_name: period.assignment_id.lecturer_id.full_name,
        ends_at: period.ends_at,
        attemptsUsed,
        attemptsRemaining: policy.max_submissions - attemptsUsed,
        maxSubmissions: policy.max_submissions,
        allowRevisions: policy.allow_revisions
      },
      questions: ordered
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/surveys/:id/submit', requireRole('student'), async (req, res, next) => {
  const surveyId = asId(req.params.id);
  const schema = z.object({
    answers: z.array(z.object({
      questionId: objectIdSchema,
      score: z.coerce.number().int().min(1).max(5)
    })).max(100),
    feedback: z.string().trim().max(2000).optional().default('')
  });
  const parsed = schema.safeParse(req.body);
  if (!surveyId || !parsed.success) return badRequest(res, 'Dữ liệu đánh giá không hợp lệ (điểm phải từ 1 đến 5).');

  let session;
  let submissionStatus;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const period = await models.SurveyPeriod.findOne({
        _id: surveyId, status: 'open', starts_at: { $lte: new Date() }, ends_at: { $gte: new Date() }
      }).session(session);
      if (!period) {
        const error = new Error('Khảo sát không còn mở.');
        error.status = 404;
        throw error;
      }
      const assignment = await models.TeachingAssignment.findById(period.assignment_id).session(session);
      const enrollment = assignment && await models.Enrollment.exists({
        student_id: req.user.id, class_id: assignment.class_id
      }).session(session);
      if (!enrollment) {
        const error = new Error('Bạn không thuộc lớp được đánh giá.');
        error.status = 403;
        throw error;
      }
      const standardQuestions = await models.SurveyQuestion.find({ is_active: true })
        .sort({ createdAt: 1, _id: 1 }).session(session).lean();
      const standardIds = new Set(standardQuestions.map((question) => String(question._id)));
      const lecturerQuestions = await models.LecturerQuestion.find({
        lecturer_id: assignment.lecturer_id,
        assignment_id: assignment._id,
        is_active: true,
        $or: [
          { survey_id: period._id },
          { survey_id: null, createdAt: { $lte: period.starts_at } },
          { survey_id: { $exists: false }, createdAt: { $lte: period.starts_at } }
        ]
      }).session(session).lean();
      const questionById = new Map([
        ...standardQuestions.map((question) => [String(question._id), question]),
        ...lecturerQuestions.map((question) => [String(question._id), question])
      ]);
      const allowedIds = new Set(questionById.keys());
      const questionIds = parsed.data.answers.map((answer) => answer.questionId);
      const requiredIds = new Set([
        ...standardIds,
        ...lecturerQuestions.filter((question) => question.is_required).map((question) => String(question._id))
      ]);
      if (new Set(questionIds).size !== questionIds.length ||
          questionIds.some((questionId) => !allowedIds.has(questionId)) ||
          [...requiredIds].some((questionId) => !questionIds.includes(questionId)) ||
          questionIds.length === 0) {
        const error = new Error('Cần trả lời đầy đủ câu hỏi bắt buộc và không gửi câu hỏi ngoài phiếu.');
        error.status = 400;
        throw error;
      }
      const lecturer = await models.Lecturer.findById(assignment.lecturer_id).session(session);
      if (!lecturer) throw new Error('Không tìm thấy hồ sơ giảng viên.');
      const policy = await getEvaluationPolicy(session);
      const scopeKey = submissionScopeKey(policy, period, assignment);
      let record = await models.SubmissionRecord.findOne({
        scope_key: scopeKey, student_id: req.user.id
      }).session(session);
      const legacyFilter = policy.scope === 'survey'
        ? { survey_id: period._id, student_id: req.user.id }
        : {
            assignment_id: assignment._id, academic_year: assignment.academic_year,
            semester: assignment.semester, student_id: req.user.id
          };
      if (!record && await models.SubmissionEligibility.exists(legacyFilter).session(session)) {
        const error = new Error('Bạn đã gửi đánh giá cho khảo sát này.');
        error.status = 409;
        throw error;
      }
      if (record && (!policy.allow_revisions || record.attempts >= policy.max_submissions)) {
        const error = new Error('Bạn đã sử dụng hết số lần gửi đánh giá được phép.');
        error.status = 409;
        throw error;
      }
      const answers = parsed.data.answers.map((answer) => {
        const question = questionById.get(answer.questionId);
        if (!question) {
          const error = new Error('Một câu hỏi không còn hợp lệ.');
          error.status = 400;
          throw error;
        }
        return { question_id: question._id, category: question.category, text: question.text, score: answer.score };
      });
      let evaluation;
      if (record && String(record.survey_id) === String(period._id)) {
        evaluation = await models.Evaluation.findById(record.evaluation_id).session(session);
        if (!evaluation) throw new Error('Không tìm thấy bản ghi đánh giá cần chỉnh sửa.');
        evaluation.answers = answers;
        evaluation.feedback = parsed.data.feedback;
        evaluation.survey_id = period._id;
        await evaluation.save({ session });
      } else {
        evaluation = await models.Evaluation.create([{
          survey_id: period._id, assignment_id: assignment._id,
          lecturer_id: assignment.lecturer_id, course_id: assignment.course_id,
          answers, feedback: parsed.data.feedback
        }], { session }).then((docs) => docs[0]);
        if (!record) {
          record = new models.SubmissionRecord({
            scope_key: scopeKey, survey_id: period._id, assignment_id: assignment._id,
            student_id: req.user.id, attempts: 0, evaluation_id: evaluation._id
          });
        }
        record.survey_id = period._id;
        record.assignment_id = assignment._id;
        record.evaluation_id = evaluation._id;
      }
      record.attempts += 1;
      record.submitted_at = new Date();
      await record.save({ session });
      submissionStatus = {
        attemptsUsed: record.attempts,
        attemptsRemaining: Math.max(0, policy.max_submissions - record.attempts),
        maxSubmissions: policy.max_submissions
      };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return res.status(201).json({
      message: 'Cảm ơn bạn đã gửi đánh giá ẩn danh.',
      ...submissionStatus
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (duplicateError(error)) return res.status(409).json({ error: 'Bạn đã gửi đánh giá cho khảo sát này.' });
    return next(error);
  } finally {
    await session?.endSession();
  }
});

router.get('/reports/lecturers', requireRole('admin'), async (req, res, next) => {
  try {
    const lecturers = await models.Lecturer.find().sort({ full_name: 1 }).lean();
    return res.json({ lecturers: lecturers.map((lecturer) => ({
      id: String(lecturer._id), full_name: lecturer.full_name, department: lecturer.department
    })) });
  } catch (error) {
    return next(error);
  }
});

router.get('/reports/courses', requireRole('admin', 'lecturer'), async (req, res, next) => {
  try {
    const assignmentFilter = req.user.role === 'lecturer' ? { lecturer_id: req.user.lecturerId } : {};
    const assignments = await models.TeachingAssignment.find(assignmentFilter).distinct('course_id');
    const courses = await models.Course.find({ _id: { $in: assignments } }).sort({ code: 1 }).lean();
    return res.json({ courses: courses.map((course) => ({
      id: String(course._id), code: course.code, title: course.title
    })) });
  } catch (error) {
    return next(error);
  }
});

router.get('/reports', requireRole('admin', 'lecturer'), async (req, res, next) => {
  const query = parseReportQuery(req.query);
  if (!query.success) return badRequest(res, 'Bộ lọc báo cáo không hợp lệ.');
  if (query.data.from && query.data.to && query.data.from > query.data.to) {
    return badRequest(res, 'Ngày bắt đầu phải trước ngày kết thúc.');
  }
  try {
    return res.json(await buildReports(query.data, req.user));
  } catch (error) {
    return next(error);
  }
});

router.get('/reports/export.csv', requireRole('admin', 'lecturer'), async (req, res, next) => {
  const query = parseReportQuery(req.query);
  if (!query.success) return badRequest(res, 'Bộ lọc báo cáo không hợp lệ.');
  if (query.data.from && query.data.to && query.data.from > query.data.to) {
    return badRequest(res, 'Ngày bắt đầu phải trước ngày kết thúc.');
  }
  try {
    const result = await buildReports(query.data, req.user);
    const rows = [[
      'Khảo sát', 'Học phần', 'Mã học phần', 'Lớp', 'Giảng viên', 'Năm học', 'Học kỳ',
      'Ngày khảo sát', 'Số phản hồi', 'Tiêu chí', 'Câu hỏi', 'Điểm trung bình',
      'Điểm 1', 'Điểm 2', 'Điểm 3', 'Điểm 4', 'Điểm 5'
    ]];
    for (const report of result.reports) {
      if (report.suppressed) continue;
      for (const question of report.questions) {
        rows.push([
          report.title, report.course, report.courseCode, report.class, report.lecturer,
          report.academicYear, report.semester, report.date.toISOString(), report.responses,
          question.category, question.text, question.average, ...question.distribution
        ]);
      }
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="teaching-quality-report.csv"',
      'Cache-Control': 'no-store'
    });
    return res.send(`\uFEFF${toCsv(rows)}`);
  } catch (error) {
    return next(error);
  }
});

async function getEvaluationPolicy(session) {
  let query = models.EvaluationPolicy.findOne({ key: 'global' });
  if (session) query = query.session(session);
  const policy = await query.lean();
  if (!policy) throw new Error('Evaluation policy has not been initialized.');
  return policy;
}

function parseReportQuery(query) {
  return z.object({
    lecturerId: objectIdSchema.optional(),
    courseId: objectIdSchema.optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    academicYear: z.string().trim().max(20).optional(),
    semester: z.string().trim().max(30).optional()
  }).safeParse(query);
}

async function buildReports(query, user) {
  if (user.role === 'lecturer' && !user.lecturerId) {
    const error = new Error('Tài khoản giảng viên chưa được liên kết hồ sơ giảng viên.');
    error.status = 403;
    throw error;
  }
  const match = {};
  if (user.role === 'lecturer') match.lecturer_id = asId(user.lecturerId);
  else if (query.lecturerId) match.lecturer_id = asId(query.lecturerId);
  if (query.courseId) match.course_id = asId(query.courseId);
  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) match.createdAt.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.academicYear || query.semester) {
    const assignmentFilter = user.role === 'lecturer' ? { lecturer_id: asId(user.lecturerId) } : {};
    if (query.academicYear) assignmentFilter.academic_year = query.academicYear;
    if (query.semester) assignmentFilter.semester = query.semester;
    const assignments = await models.TeachingAssignment.find(assignmentFilter).distinct('_id');
    match.assignment_id = { $in: assignments };
  }
  const policy = await getEvaluationPolicy();
  const grouped = await models.Evaluation.aggregate([
    { $match: match },
    { $unwind: '$answers' },
    {
      $group: {
        _id: { survey: '$survey_id', question: '$answers.question_id', text: '$answers.text', category: '$answers.category' },
        answerCount: { $sum: 1 },
        scoreTotal: { $sum: '$answers.score' },
        score1: { $sum: { $cond: [{ $eq: ['$answers.score', 1] }, 1, 0] } },
        score2: { $sum: { $cond: [{ $eq: ['$answers.score', 2] }, 1, 0] } },
        score3: { $sum: { $cond: [{ $eq: ['$answers.score', 3] }, 1, 0] } },
        score4: { $sum: { $cond: [{ $eq: ['$answers.score', 4] }, 1, 0] } },
        score5: { $sum: { $cond: [{ $eq: ['$answers.score', 5] }, 1, 0] } }
      }
    },
    {
      $group: {
        _id: '$_id.survey', responses: { $max: '$answerCount' },
        questions: { $push: {
          id: '$_id.question', text: '$_id.text', category: '$_id.category',
          average: { $divide: ['$scoreTotal', '$answerCount'] },
          distribution: ['$score1', '$score2', '$score3', '$score4', '$score5']
        } }
      }
    },
    { $lookup: { from: 'survey_periods', localField: '_id', foreignField: '_id', as: 'period' } },
    { $unwind: '$period' },
    { $lookup: { from: 'teaching_assignments', localField: 'period.assignment_id', foreignField: '_id', as: 'assignment' } },
    { $unwind: '$assignment' },
    { $lookup: { from: 'lecturers', localField: 'assignment.lecturer_id', foreignField: '_id', as: 'lecturer' } },
    { $unwind: '$lecturer' },
    { $lookup: { from: 'courses', localField: 'assignment.course_id', foreignField: '_id', as: 'course' } },
    { $unwind: '$course' },
    { $lookup: { from: 'classes', localField: 'assignment.class_id', foreignField: '_id', as: 'class' } },
    { $unwind: '$class' },
    { $sort: { 'period.createdAt': -1 } }
  ]);
  const reports = grouped.map((item) => {
    const suppressed = item.responses < policy.min_report_responses;
    return {
      id: String(item.period._id), title: item.period.title, date: item.period.createdAt,
      course: item.course.title, courseCode: item.course.code, class: item.class.name,
      academicYear: item.assignment.academic_year, semester: item.assignment.semester,
      lecturer: item.lecturer.full_name, department: item.lecturer.department,
      responses: suppressed ? null : item.responses, suppressed,
      questions: suppressed ? [] : item.questions.map((question) => ({
        id: String(question.id), text: question.text, category: question.category,
        average: Number(question.average.toFixed(2)), distribution: question.distribution
      }))
    };
  });
  return { reports, minimumResponses: policy.min_report_responses };
}

router.get('/admin/policy', requireRole('admin'), async (req, res, next) => {
  try {
    const policy = await getEvaluationPolicy();
    return res.json({ policy });
  } catch (error) {
    return next(error);
  }
});

router.put('/admin/policy', requireRole('admin'), async (req, res, next) => {
  const parsed = evaluationPolicySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message || 'Chính sách đánh giá không hợp lệ.');
  try {
    const current = await getEvaluationPolicy();
    if (current.scope !== parsed.data.scope) {
      const [newRecords, legacyRecords] = await Promise.all([
        models.SubmissionRecord.countDocuments(),
        models.SubmissionEligibility.countDocuments()
      ]);
      if (newRecords || legacyRecords) {
        return res.status(409).json({ error: 'Không thể đổi phạm vi sau khi đã ghi nhận đánh giá để tránh cho phép gửi trùng.' });
      }
    }
    const policy = await models.EvaluationPolicy.findOneAndUpdate(
      { key: 'global' }, { $set: parsed.data, $setOnInsert: { key: 'global' } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    return res.json({ policy, message: 'Đã cập nhật chính sách đánh giá.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/:resource', requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.resource === 'users') {
      const users = await models.User.find().sort({ createdAt: -1 }).lean();
      return res.json({ items: users.map((user) => ({
        id: String(user._id), full_name: user.full_name, email: user.email,
        role: user.role, lecturer_id: user.lecturer_id ? String(user.lecturer_id) : '', is_active: user.is_active,
        phone_number: user.role === 'student' ? user.phone_number : '',
        phone_verified: user.role === 'student' && user.phone_verified
      })) });
    }
    if (req.params.resource === 'students') {
      const students = await models.User.find({ role: 'student', is_active: true }).select('full_name email').sort({ full_name: 1 }).lean();
      return res.json({ items: students.map((student) => ({
        id: String(student._id), full_name: student.full_name, email: student.email
      })) });
    }
    const resource = resources[req.params.resource];
    if (!resource) return res.status(404).json({ error: 'Danh mục quản lý không tồn tại.' });
    if (req.params.resource === 'lecturer-questions') {
      const items = await models.LecturerQuestion.find()
        .populate('lecturer_id', 'full_name')
        .populate({
          path: 'assignment_id',
          populate: [{ path: 'course_id', select: 'title' }, { path: 'class_id', select: 'name' }]
        })
        .sort({ createdAt: -1 }).lean();
      return res.json({ items: items.map((item) => ({
        id: String(item._id),
        lecturer_name: item.lecturer_id?.full_name || '',
        course_title: item.assignment_id?.course_id?.title || '',
        class_name: item.assignment_id?.class_id?.name || '',
        text: item.text,
        category: item.category,
        description: item.description,
        is_required: item.is_required,
        is_active: item.is_active
      })) });
    }
    const items = await resource.model.find().sort({ createdAt: -1 }).lean();
    return res.json({ items: items.map(serialize) });
  } catch (error) {
    return next(error);
  }
});

router.post('/admin/:resource', requireRole('admin'), async (req, res, next) => {
  if (['assignments', 'surveys', 'enrollments'].includes(req.params.resource)) return next();
  try {
    if (req.params.resource === 'users') {
      const parsed = z.object({
        full_name: nameSchema, email: z.string().email().max(255),
        password: managementPasswordSchema,
        role: z.enum(['admin', 'lecturer', 'student']),
        lecturer_id: objectIdSchema.nullable().optional(),
        phone_number: z.union([z.string().regex(/^\+[1-9]\d{7,14}$/), z.literal('')]).optional().default(''),
        phone_verified: z.boolean().optional().default(false)
      }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, `Thông tin tài khoản không hợp lệ; mật khẩu cần tối thiểu ${MANAGEMENT_PASSWORD_MIN_LENGTH} ký tự.`);
      const email = normalizeEmail(parsed.data.email);
      if (!isRoleEmailValid(parsed.data.role, email)) {
        return badRequest(res, accountEmailError(parsed.data.role));
      }
      if ((parsed.data.role === 'lecturer') !== Boolean(parsed.data.lecturer_id)) {
        return badRequest(res, 'Chỉ tài khoản giảng viên được liên kết với hồ sơ giảng viên.');
      }
      if (parsed.data.role !== 'student' && (parsed.data.phone_number || parsed.data.phone_verified)) {
        return badRequest(res, 'Chỉ tài khoản sinh viên được đăng ký số điện thoại khôi phục.');
      }
      if (parsed.data.phone_verified && !parsed.data.phone_number) {
        return badRequest(res, 'Cần nhập số điện thoại trước khi xác nhận đã xác minh.');
      }
      if (parsed.data.lecturer_id && !(await models.Lecturer.exists({ _id: parsed.data.lecturer_id }))) {
        return badRequest(res, 'Không tìm thấy hồ sơ giảng viên được chọn.');
      }
      const user = await models.User.create({
        full_name: parsed.data.full_name, email,
        password_hash: await bcrypt.hash(parsed.data.password, 12), role: parsed.data.role,
        lecturer_id: parsed.data.lecturer_id || null,
        phone_number: parsed.data.role === 'student' ? parsed.data.phone_number : '',
        phone_verified: parsed.data.role === 'student' && parsed.data.phone_verified
      });
      return res.status(201).json({ id: String(user._id), message: 'Đã tạo tài khoản.' });
    }
    const resource = resources[req.params.resource];
    if (!resource) return res.status(404).json({ error: 'Danh mục quản lý không tồn tại.' });
    const parsed = resourceSchema(req.params.resource, req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    if (req.params.resource === 'questions') {
      if (await models.SurveyPeriod.exists({ status: 'open' })) {
        return res.status(409).json({ error: 'Không thể thay đổi câu hỏi dùng chung khi có khảo sát đang mở.' });
      }
      if (parsed.data.is_active && await models.SurveyQuestion.countDocuments({ is_active: true }) >= 100) {
        return badRequest(res, 'Không thể có quá 100 câu hỏi chung đang hoạt động.');
      }
    }
    const item = await resource.model.create(parsed.data);
    return res.status(201).json({ id: String(item._id), message: 'Đã thêm dữ liệu.' });
  } catch (error) {
    return next(error);
  }
});

router.put('/admin/users/:id/status', requireRole('admin'), async (req, res, next) => {
  const id = asId(req.params.id);
  const parsed = z.object({ is_active: z.coerce.boolean() }).safeParse(req.body);
  if (!id || !parsed.success) return badRequest(res, 'Trạng thái tài khoản không hợp lệ.');
  if (String(req.user.id) === String(id) && !parsed.data.is_active) return badRequest(res, 'Không thể tự vô hiệu hóa tài khoản đang đăng nhập.');
  try {
    const result = await models.User.updateOne({ _id: id }, { $set: { is_active: parsed.data.is_active } });
    return result.matchedCount ? res.json({ message: 'Đã cập nhật trạng thái tài khoản.' }) : res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  } catch (error) {
    return next(error);
  }
});

router.put('/admin/users/:id', requireRole('admin'), async (req, res, next) => {
  const id = asId(req.params.id);
  const parsed = z.object({
    full_name: nameSchema, email: z.string().email().max(255),
    password: managementPasswordSchema.optional().or(z.literal('')),
    role: z.enum(['admin', 'lecturer', 'student']),
    lecturer_id: objectIdSchema.nullable().optional(),
    phone_number: z.union([z.string().regex(/^\+[1-9]\d{7,14}$/), z.literal('')]).optional().default(''),
    phone_verified: z.boolean().optional().default(false)
  }).safeParse(req.body);
  if (!id || !parsed.success) return badRequest(res, 'Thông tin tài khoản không hợp lệ.');
  const email = normalizeEmail(parsed.data.email);
  if (!isRoleEmailValid(parsed.data.role, email)) {
    return badRequest(res, accountEmailError(parsed.data.role));
  }
  if ((parsed.data.role === 'lecturer') !== Boolean(parsed.data.lecturer_id)) {
    return badRequest(res, 'Chỉ tài khoản giảng viên được liên kết với hồ sơ giảng viên.');
  }
  if (parsed.data.role !== 'student' && (parsed.data.phone_number || parsed.data.phone_verified)) {
    return badRequest(res, 'Chỉ tài khoản sinh viên được đăng ký số điện thoại khôi phục.');
  }
  if (parsed.data.phone_verified && !parsed.data.phone_number) {
    return badRequest(res, 'Cần nhập số điện thoại trước khi xác nhận đã xác minh.');
  }
  if (String(req.user.id) === String(id) && parsed.data.role !== 'admin') return badRequest(res, 'Không thể tự hạ quyền tài khoản đang đăng nhập.');
  try {
    if (parsed.data.lecturer_id && !(await models.Lecturer.exists({ _id: parsed.data.lecturer_id }))) {
      return badRequest(res, 'Không tìm thấy hồ sơ giảng viên được chọn.');
    }
    const update = {
      full_name: parsed.data.full_name, email,
      role: parsed.data.role, lecturer_id: parsed.data.lecturer_id || null,
      phone_number: parsed.data.role === 'student' ? parsed.data.phone_number : '',
      phone_verified: parsed.data.role === 'student' && parsed.data.phone_verified
    };
    const updateOperation = { $set: update };
    if (parsed.data.password) {
      update.password_hash = await bcrypt.hash(parsed.data.password, 12);
      updateOperation.$inc = { auth_version: 1 };
    }
    const result = await models.User.updateOne({ _id: id }, updateOperation, { runValidators: true });
    return result.matchedCount ? res.json({ message: 'Đã cập nhật tài khoản.' }) : res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  } catch (error) {
    return next(error);
  }
});

router.put('/admin/:resource/:id', requireRole('admin'), async (req, res, next) => {
  const id = asId(req.params.id);
  if (!id) return badRequest(res, 'Mã dữ liệu không hợp lệ.');
  try {
    const resource = resources[req.params.resource];
    if (!resource) return res.status(404).json({ error: 'Danh mục quản lý không tồn tại.' });
    const parsed = resourceSchema(req.params.resource, req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    if (req.params.resource === 'questions' && await models.SurveyPeriod.exists({ status: 'open' })) {
      return res.status(409).json({ error: 'Không thể thay đổi câu hỏi dùng chung khi có khảo sát đang mở.' });
    }
    if (req.params.resource === 'questions' && parsed.data.is_active) {
      const question = await models.SurveyQuestion.findById(id).select('is_active');
      if (!question) return res.status(404).json({ error: 'Không tìm thấy dữ liệu.' });
      if (!question.is_active && await models.SurveyQuestion.countDocuments({ is_active: true }) >= 100) {
        return badRequest(res, 'Không thể có quá 100 câu hỏi chung đang hoạt động.');
      }
    }
    if (req.params.resource === 'lecturer-questions') {
      const question = await models.LecturerQuestion.findById(id).select('assignment_id survey_id createdAt');
      if (!question) return res.status(404).json({ error: 'Không tìm thấy dữ liệu.' });
      if (await lecturerQuestionHasOpenSurvey(question)) {
        return res.status(409).json({ error: 'Không thể thay đổi câu hỏi khi đợt đánh giá đang mở.' });
      }
    }
    const result = await resource.model.updateOne({ _id: id }, { $set: parsed.data }, { runValidators: true });
    return result.matchedCount ? res.json({ message: 'Đã cập nhật dữ liệu.' }) : res.status(404).json({ error: 'Không tìm thấy dữ liệu.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/admin/enrollments/:classId/:studentId', requireRole('admin'), async (req, res, next) => {
  const classId = asId(req.params.classId);
  const studentId = asId(req.params.studentId);
  if (!classId || !studentId) return badRequest(res, 'Mã lớp hoặc sinh viên không hợp lệ.');
  try {
    const result = await models.Enrollment.deleteOne({ class_id: classId, student_id: studentId });
    return result.deletedCount ? res.json({ message: 'Đã gỡ sinh viên khỏi lớp.' }) : res.status(404).json({ error: 'Không tìm thấy ghi danh.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/admin/:resource/:id', requireRole('admin'), async (req, res, next) => {
  const id = asId(req.params.id);
  if (!id) return badRequest(res, 'Mã dữ liệu không hợp lệ.');
  try {
    const model = req.params.resource === 'assignments' ? models.TeachingAssignment : resources[req.params.resource]?.model;
    if (!model) return res.status(404).json({ error: 'Danh mục quản lý không tồn tại.' });
    const resource = req.params.resource;
    const references = {
      lecturers: [
        models.User.exists({ lecturer_id: id }),
        models.TeachingAssignment.exists({ lecturer_id: id })
      ],
      courses: [models.TeachingAssignment.exists({ course_id: id })],
      classes: [
        models.TeachingAssignment.exists({ class_id: id }),
        models.Enrollment.exists({ class_id: id })
      ],
      questions: [
        models.SurveyPeriod.exists({ status: 'open' }),
        models.SurveyPeriod.exists({ 'questions.question_id': id }),
        models.Evaluation.exists({ 'answers.question_id': id })
      ],
      'lecturer-questions': [],
      assignments: [models.SurveyPeriod.exists({ assignment_id: id })]
    }[resource] || [];
    if (resource === 'lecturer-questions') {
      const question = await models.LecturerQuestion.findById(id).select('assignment_id survey_id createdAt');
      if (!question) return res.status(404).json({ error: 'Không tìm thấy dữ liệu.' });
      if (await lecturerQuestionHasOpenSurvey(question)) {
        return res.status(409).json({ error: 'Không thể xóa câu hỏi khi đợt đánh giá đang mở.' });
      }
    }
    if (references.length && (await Promise.all(references)).some(Boolean)) {
      return res.status(409).json({ error: 'Dữ liệu đang được sử dụng và không thể xóa.' });
    }
    const result = await model.deleteOne({ _id: id });
    return result.deletedCount ? res.json({ message: 'Đã xóa dữ liệu.' }) : res.status(404).json({ error: 'Không tìm thấy dữ liệu.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/assignments/list', requireRole('admin'), async (req, res, next) => {
  try {
    const assignments = await models.TeachingAssignment.find()
      .populate('lecturer_id', 'full_name').populate('course_id', 'title code').populate('class_id', 'name').sort({ createdAt: -1 }).lean();
    return res.json({ items: assignments.map((item) => ({
      id: String(item._id), lecturer_id: String(item.lecturer_id?._id || ''),
      course_id: String(item.course_id?._id || ''), class_id: String(item.class_id?._id || ''),
      lecturer_name: item.lecturer_id?.full_name || '', course_title: item.course_id?.title || '',
      class_name: item.class_id?.name || '', academic_year: item.academic_year, semester: item.semester
    })) });
  } catch (error) {
    return next(error);
  }
});

router.post('/admin/assignments', requireRole('admin'), async (req, res, next) => {
  const parsed = z.object({
    lecturer_id: objectIdSchema, course_id: objectIdSchema, class_id: objectIdSchema,
    academic_year: z.string().trim().min(1).max(20), semester: z.string().trim().min(1).max(30)
  }).safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Thông tin phân công không hợp lệ.');
  try {
    const [lecturer, course, section] = await Promise.all([
      models.Lecturer.exists({ _id: parsed.data.lecturer_id }),
      models.Course.exists({ _id: parsed.data.course_id }),
      models.ClassSection.exists({ _id: parsed.data.class_id })
    ]);
    if (!lecturer || !course || !section) return badRequest(res, 'Hãy chọn giảng viên, học phần và lớp đã tồn tại.');
    const assignment = await models.TeachingAssignment.create(parsed.data);
    return res.status(201).json({ id: String(assignment._id), message: 'Đã tạo phân công.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/surveys/list', requireRole('admin'), async (req, res, next) => {
  try {
    const periods = await models.SurveyPeriod.find().populate({
      path: 'assignment_id',
      populate: [{ path: 'lecturer_id', select: 'full_name' }, { path: 'course_id', select: 'title' }, { path: 'class_id', select: 'name' }]
    }).sort({ createdAt: -1 }).lean();
    return res.json({ items: periods.map((period) => ({
      id: String(period._id), title: period.title, status: period.status, ends_at: period.ends_at,
      course_title: period.assignment_id?.course_id?.title || '',
      class_name: period.assignment_id?.class_id?.name || '',
      lecturer_name: period.assignment_id?.lecturer_id?.full_name || ''
    })) });
  } catch (error) {
    return next(error);
  }
});

router.post('/admin/surveys', requireRole('admin'), async (req, res, next) => {
  const parsed = z.object({
    assignment_id: objectIdSchema,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().default(''),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    status: z.enum(['draft', 'open', 'closed'])
  }).safeParse(req.body);
  if (!parsed.success || new Date(parsed.data.starts_at) >= new Date(parsed.data.ends_at)) {
    return badRequest(res, 'Thông tin khảo sát hoặc thời gian khảo sát không hợp lệ.');
  }
  try {
    const [assignment, questions] = await Promise.all([
      models.TeachingAssignment.exists({ _id: parsed.data.assignment_id }),
      models.SurveyQuestion.find({ is_active: true }).select('_id').sort({ createdAt: 1, _id: 1 }).lean()
    ]);
    if (!assignment) return badRequest(res, 'Phân công giảng dạy không tồn tại.');
    if (!questions.length) return badRequest(res, 'Cần có ít nhất một câu hỏi chung đang hoạt động trước khi tạo khảo sát.');
    if (questions.length > 100) return badRequest(res, 'Không thể thêm quá 100 câu hỏi chung vào một khảo sát.');
    const period = await models.SurveyPeriod.create({
      assignment_id: parsed.data.assignment_id, title: parsed.data.title,
      description: parsed.data.description, starts_at: new Date(parsed.data.starts_at),
      ends_at: new Date(parsed.data.ends_at), status: parsed.data.status,
      questions: questions.map(({ _id: question_id }, index) => ({ question_id, position: index + 1 }))
    });
    return res.status(201).json({ id: String(period._id), message: 'Đã tạo khảo sát.' });
  } catch (error) {
    return next(error);
  }
});

router.put('/admin/surveys/:id/status', requireRole('admin'), async (req, res, next) => {
  const id = asId(req.params.id);
  const parsed = z.object({ status: z.enum(['draft', 'open', 'closed']) }).safeParse(req.body);
  if (!id || !parsed.success) return badRequest(res, 'Trạng thái khảo sát không hợp lệ.');
  try {
    const result = await models.SurveyPeriod.updateOne({ _id: id }, { $set: { status: parsed.data.status } });
    return result.matchedCount ? res.json({ message: 'Đã cập nhật trạng thái khảo sát.' }) : res.status(404).json({ error: 'Không tìm thấy khảo sát.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/enrollments/list', requireRole('admin'), async (req, res, next) => {
  try {
    const enrollments = await models.Enrollment.find().populate('student_id', 'full_name email').populate('class_id', 'name').lean();
    return res.json({ items: enrollments.map((entry) => ({
      class_id: String(entry.class_id?._id || ''), student_id: String(entry.student_id?._id || ''),
      full_name: entry.student_id?.full_name || '', email: entry.student_id?.email || '',
      class_name: entry.class_id?.name || ''
    })) });
  } catch (error) {
    return next(error);
  }
});

router.post('/admin/enrollments', requireRole('admin'), async (req, res, next) => {
  const parsed = z.object({ student_id: objectIdSchema, class_id: objectIdSchema }).safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Mã sinh viên hoặc lớp không hợp lệ.');
  try {
    const [student, section] = await Promise.all([
      models.User.exists({ _id: parsed.data.student_id, role: 'student', is_active: true }),
      models.ClassSection.exists({ _id: parsed.data.class_id })
    ]);
    if (!student || !section) return badRequest(res, 'Tài khoản sinh viên hoặc lớp không tồn tại.');
    await models.Enrollment.create(parsed.data);
    return res.status(201).json({ message: 'Đã ghi danh sinh viên vào lớp.' });
  } catch (error) {
    if (duplicateError(error)) return res.status(409).json({ error: 'Sinh viên đã thuộc lớp này.' });
    return next(error);
  }
});

function resourceSchema(resource, body) {
  let schema;
  if (resource === 'lecturers') {
    schema = z.object({
      full_name: nameSchema, department: nameSchema,
      email: z.string().email().max(255).transform(normalizeEmail)
        .refine((email) => isRoleEmailValid('lecturer', email), accountEmailError('lecturer'))
    });
  } else if (resource === 'courses') {
    schema = z.object({ code: z.string().trim().min(1).max(30), title: nameSchema, description: z.string().trim().max(2000).optional().default('') });
  } else if (resource === 'classes') {
    schema = z.object({ code: z.string().trim().min(1).max(30), name: nameSchema, academic_year: z.string().trim().min(1).max(20), semester: z.string().trim().max(30).optional().default('') });
  } else if (resource === 'questions') {
    schema = z.object({ text: z.string().trim().min(5).max(1000), category: nameSchema.max(100), is_active: z.coerce.boolean().default(true) });
  } else if (resource === 'lecturer-questions') {
    schema = z.object({
      text: z.string().trim().min(5).max(1000),
      category: nameSchema.max(100),
      description: z.string().trim().max(500).optional().default(''),
      is_required: z.coerce.boolean().default(false),
      is_active: z.coerce.boolean().default(true)
    });
  }
  if (!schema) return { success: false, error: 'Danh mục quản lý không tồn tại.' };
  return schema.safeParse(body);
}

async function lecturerQuestionHasOpenSurvey(question) {
  const liveSurveyFilter = { assignment_id: question.assignment_id, status: 'open' };
  if (question.survey_id) liveSurveyFilter._id = question.survey_id;
  else liveSurveyFilter.starts_at = { $gte: question.createdAt };
  return models.SurveyPeriod.exists(liveSurveyFilter);
}

module.exports = router;
