const express = require('express');
const { z } = require('zod');
const models = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { getEvaluationPolicy } = require('../services/evaluation-analytics');

const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const router = express.Router();
router.use(authenticate, requireRole('lecturer'));
router.use((req, res, next) => {
  if (!req.user.lecturerId) {
    return res.status(403).json({ error: 'Tài khoản giảng viên chưa được liên kết hồ sơ giảng viên.' });
  }
  return next();
});

router.get('/analytics', async (req, res, next) => {
  const filters = z.object({
    courseId: idSchema.optional(),
    surveyId: idSchema.optional(),
    academicYear: z.string().trim().max(20).optional(),
    semester: z.string().trim().max(30).optional()
  }).safeParse(req.query);
  if (!filters.success) return res.status(400).json({ error: 'Bộ lọc báo cáo không hợp lệ.' });
  try {
    const result = await buildLecturerAnalytics(req.user.lecturerId, filters.data);
    if (result.status === 'invalid_course') {
      return res.status(404).json({ error: 'Không tìm thấy môn học được phân công cho bạn.' });
    }
    if (result.status === 'invalid_survey') {
      return res.status(404).json({ error: 'Không tìm thấy đợt đánh giá được phân công cho bạn.' });
    }
    return res.json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.get('/questions', async (req, res, next) => {
  const filters = z.object({
    assignmentId: idSchema.optional(),
    courseId: idSchema.optional(),
    surveyId: idSchema.optional()
  }).safeParse(req.query);
  if (!filters.success) return res.status(400).json({ error: 'Bộ lọc câu hỏi không hợp lệ.' });
  try {
    const assignments = await models.TeachingAssignment.find({ lecturer_id: req.user.lecturerId })
      .select('_id course_id class_id academic_year semester')
      .populate('course_id', 'code title')
      .populate('class_id', 'name code')
      .lean();
    const available = assignments.filter((entry) => !filters.data.assignmentId ||
      String(entry._id) === filters.data.assignmentId).filter((entry) => !filters.data.courseId ||
      String(entry.course_id?._id || entry.course_id) === filters.data.courseId);
    if ((filters.data.assignmentId || filters.data.courseId) && !available.length) {
      return res.status(404).json({ error: 'Không tìm thấy môn học được phân công cho bạn.' });
    }
    let survey = null;
    if (filters.data.surveyId) {
      survey = await models.SurveyPeriod.findById(filters.data.surveyId).select('assignment_id status title').lean();
      if (!survey || !available.some((entry) => String(entry._id) === String(survey.assignment_id))) {
        return res.status(404).json({ error: 'Không tìm thấy đợt đánh giá được phân công cho bạn.' });
      }
    }
    const questionFilter = {
      lecturer_id: req.user.lecturerId,
      assignment_id: { $in: available.map((entry) => entry._id) }
    };
    if (filters.data.surveyId) {
      questionFilter.$or = [
        { survey_id: filters.data.surveyId },
        { survey_id: null }
      ];
    }
    const questions = await models.LecturerQuestion.find(questionFilter)
      .sort({ createdAt: -1 }).lean();
    const surveyIds = questions.filter((question) => question.survey_id).map((question) => question.survey_id);
    const questionSurveys = await models.SurveyPeriod.find({ _id: { $in: surveyIds } })
      .select('_id title').lean();
    const surveyTitles = new Map(questionSurveys.map((entry) => [String(entry._id), entry.title]));
    return res.json({
      assignments: available.map((entry) => ({
        id: String(entry._id),
        courseId: String(entry.course_id?._id || entry.course_id || ''),
        courseCode: entry.course_id?.code || '',
        courseTitle: entry.course_id?.title || '',
        className: entry.class_id?.name || '',
        academicYear: entry.academic_year,
        semester: entry.semester
      })),
      questions: questions.map((question) => ({
        id: String(question._id),
        assignmentId: String(question.assignment_id),
        courseCode: available.find((entry) => String(entry._id) === String(question.assignment_id))?.course_id?.code || '',
        assignmentClass: available.find((entry) => String(entry._id) === String(question.assignment_id))?.class_id?.name || '',
        surveyId: question.survey_id ? String(question.survey_id) : '',
        surveyTitle: question.survey_id
          ? (surveyTitles.get(String(question.survey_id)) || survey?.title || '')
          : '',
        text: question.text,
        category: question.category,
        description: question.description,
        questionType: question.question_type,
        required: question.is_required,
        active: question.is_active
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/assignments', async (req, res, next) => {
  try {
    const assignments = await models.TeachingAssignment.find({ lecturer_id: req.user.lecturerId })
      .populate('course_id', 'code title')
      .populate('class_id', 'name code')
      .sort({ academic_year: -1, semester: 1 })
      .lean();
    return res.json({
      assignments: assignments.map((entry) => ({
        assignmentId: String(entry._id),
        courseId: String(entry.course_id?._id || entry.course_id || ''),
        courseCode: entry.course_id?.code || '',
        courseName: entry.course_id?.title || '',
        className: entry.class_id?.name || '',
        academicYear: entry.academic_year,
        semester: entry.semester
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/surveys', async (req, res, next) => {
  try {
    const assignments = await models.TeachingAssignment.find({ lecturer_id: req.user.lecturerId })
      .select('_id')
      .lean();
    const surveys = await models.SurveyPeriod.find({
      assignment_id: { $in: assignments.map((assignment) => assignment._id) }
    }).select('_id assignment_id title status starts_at ends_at').sort({ starts_at: -1 }).lean();
    return res.json({
      surveys: surveys.map((survey) => ({
        id: String(survey._id),
        assignmentId: String(survey.assignment_id),
        title: survey.title,
        status: survey.status,
        startsAt: survey.starts_at,
        endsAt: survey.ends_at
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/questions', async (req, res, next) => {
  const parsed = lecturerQuestionInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Thông tin câu hỏi không hợp lệ.' });
  }
  try {
    const assignment = await models.TeachingAssignment.findOne({
      _id: parsed.data.assignmentId,
      lecturer_id: req.user.lecturerId
    }).select('_id lecturer_id');
    if (!assignment) return res.status(404).json({ error: 'Không tìm thấy môn học được phân công cho bạn.' });
    if (parsed.data.surveyId) {
      const period = await models.SurveyPeriod.findOne({
        _id: parsed.data.surveyId, assignment_id: assignment._id, status: 'draft'
      }).select('_id');
      if (!period) {
        return res.status(409).json({ error: 'Chỉ có thể gắn câu hỏi vào đợt đánh giá đang ở trạng thái nháp.' });
      }
    }
    const question = await models.LecturerQuestion.create({
      lecturer_id: assignment.lecturer_id,
      assignment_id: assignment._id,
      survey_id: parsed.data.surveyId || null,
      text: parsed.data.text,
      category: parsed.data.category,
      description: parsed.data.description,
      question_type: 'likert',
      is_required: parsed.data.required,
      is_active: true
    });
    return res.status(201).json({
      question: serializeLecturerQuestion(question),
      message: 'Đã thêm câu hỏi bổ sung.'
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/questions/:id/status', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'Trạng thái câu hỏi không hợp lệ.' });
  try {
    const question = await models.LecturerQuestion.findOne({
      _id: id.data, lecturer_id: req.user.lecturerId
    });
    if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi thuộc quyền quản lý của bạn.' });
    const liveSurveyFilter = {
      assignment_id: question.assignment_id,
      status: 'open'
    };
    if (question.survey_id) liveSurveyFilter._id = question.survey_id;
    else liveSurveyFilter.starts_at = { $gte: question.createdAt };
    if (await models.SurveyPeriod.exists(liveSurveyFilter)) {
      return res.status(409).json({ error: 'Không thể thay đổi câu hỏi khi đợt đánh giá đang mở.' });
    }
    question.is_active = parsed.data.active;
    await question.save();
    return res.json({
      question: serializeLecturerQuestion(question),
      message: parsed.data.active ? 'Đã kích hoạt câu hỏi.' : 'Đã tạm ngưng câu hỏi.'
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/questions/:id', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = lecturerQuestionUpdate.safeParse(req.body);
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Thông tin câu hỏi không hợp lệ.' });
  }
  try {
    const question = await models.LecturerQuestion.findOne({
      _id: id.data, lecturer_id: req.user.lecturerId
    });
    if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi thuộc quyền quản lý của bạn.' });
    if (await lecturerQuestionHasOpenSurvey(question)) {
      return res.status(409).json({ error: 'Không thể thay đổi câu hỏi khi đợt đánh giá đang mở.' });
    }
    question.text = parsed.data.text;
    question.category = parsed.data.category;
    question.description = parsed.data.description;
    question.is_required = parsed.data.required;
    await question.save();
    return res.json({
      question: serializeLecturerQuestion(question),
      message: 'Đã cập nhật câu hỏi.'
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/questions/:id', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Mã câu hỏi không hợp lệ.' });
  try {
    const question = await models.LecturerQuestion.findOne({
      _id: id.data, lecturer_id: req.user.lecturerId
    });
    if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi thuộc quyền quản lý của bạn.' });
    if (await lecturerQuestionHasOpenSurvey(question)) {
      return res.status(409).json({ error: 'Không thể xóa câu hỏi khi đợt đánh giá đang mở.' });
    }
    await question.deleteOne();
    return res.json({ message: 'Đã xóa câu hỏi.' });
  } catch (error) {
    return next(error);
  }
});

const lecturerQuestionInput = z.object({
  assignmentId: idSchema,
  surveyId: idSchema.optional().or(z.literal('')),
  text: z.string().trim().min(5).max(1000),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(''),
  questionType: z.literal('likert').optional().default('likert'),
  required: z.boolean().optional().default(false)
}).strict().transform((values) => ({
  ...values,
  surveyId: values.surveyId || ''
}));

const lecturerQuestionUpdate = z.object({
  text: z.string().trim().min(5).max(1000),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(''),
  required: z.boolean().optional().default(false)
}).strict();

function serializeLecturerQuestion(question) {
  return {
    id: String(question._id),
    assignmentId: String(question.assignment_id),
    surveyId: question.survey_id ? String(question.survey_id) : '',
    text: question.text,
    category: question.category,
    description: question.description,
    questionType: question.question_type,
    required: question.is_required,
    active: question.is_active
  };
}

async function lecturerQuestionHasOpenSurvey(question) {
  const liveSurveyFilter = {
    assignment_id: question.assignment_id,
    status: 'open'
  };
  if (question.survey_id) liveSurveyFilter._id = question.survey_id;
  else liveSurveyFilter.starts_at = { $gte: question.createdAt };
  return models.SurveyPeriod.exists(liveSurveyFilter);
}

async function buildLecturerAnalytics(lecturerId, filters) {
  const assignmentQuery = { lecturer_id: lecturerId };
  if (filters.courseId) assignmentQuery.course_id = filters.courseId;
  if (filters.academicYear) assignmentQuery.academic_year = filters.academicYear;
  if (filters.semester) assignmentQuery.semester = filters.semester;
  const assignments = await models.TeachingAssignment.find(assignmentQuery)
    .populate('course_id', 'code title')
    .populate('class_id', 'name code')
    .lean();
  if (filters.courseId && !assignments.length) return { status: 'invalid_course' };
  const allAssignments = filters.courseId || filters.academicYear || filters.semester
    ? await models.TeachingAssignment.find({ lecturer_id: lecturerId })
      .populate('course_id', 'code title')
      .populate('class_id', 'name code')
      .lean()
    : assignments;
  const assignmentById = new Map(allAssignments.map((assignment) => [String(assignment._id), assignment]));
  const allSurveys = await models.SurveyPeriod.find({
    assignment_id: { $in: allAssignments.map((entry) => entry._id) }
  }).sort({ starts_at: -1 }).lean();
  if (filters.surveyId && !allSurveys.some((survey) => String(survey._id) === filters.surveyId)) {
    return { status: 'invalid_survey' };
  }
  const filteredSurveyIds = allSurveys.filter((survey) => {
    const assignment = assignmentById.get(String(survey.assignment_id));
    if (!assignment) return false;
    if (filters.surveyId && String(survey._id) !== filters.surveyId) return false;
    if (filters.courseId && String(assignment.course_id?._id || assignment.course_id) !== filters.courseId) return false;
    if (filters.academicYear && assignment.academic_year !== filters.academicYear) return false;
    if (filters.semester && assignment.semester !== filters.semester) return false;
    return true;
  });
  const policy = await getEvaluationPolicy();
  const evaluations = filteredSurveyIds.length
    ? await models.Evaluation.find({
      lecturer_id: lecturerId,
      survey_id: { $in: filteredSurveyIds.map((survey) => survey._id) }
    }).select('survey_id answers').lean()
    : [];
  const periodStats = new Map();
  for (const survey of filteredSurveyIds) {
    const assignment = assignmentById.get(String(survey.assignment_id));
    periodStats.set(String(survey._id), {
      survey, assignment,
      evaluations: [],
      scores: [],
      criteria: new Map(),
      distribution: [0, 0, 0, 0, 0],
      feedbackCount: 0
    });
  }
  for (const evaluation of evaluations) {
    const stat = periodStats.get(String(evaluation.survey_id));
    if (!stat) continue;
    stat.evaluations.push(evaluation);
    if (evaluation.feedback?.trim()) stat.feedbackCount += 1;
    for (const answer of evaluation.answers || []) {
      if (!Number.isFinite(answer.score) || answer.score < 1 || answer.score > 5) continue;
      stat.scores.push(answer.score);
      stat.distribution[answer.score - 1] += 1;
      const key = `${answer.category}\u0000${answer.text}`;
      const criterion = stat.criteria.get(key) || {
        category: answer.category, text: answer.text, total: 0, count: 0
      };
      criterion.total += answer.score;
      criterion.count += 1;
      stat.criteria.set(key, criterion);
    }
  }
  const eligibleBySurvey = new Map();
  for (const stat of periodStats.values()) {
    const eligibleCount = await models.Enrollment.countDocuments({
      class_id: stat.assignment.class_id?._id || stat.assignment.class_id
    });
    eligibleBySurvey.set(String(stat.survey._id), eligibleCount);
  }
  const periods = [...periodStats.values()].map((stat) => {
    const responses = stat.evaluations.length;
    const suppressed = responses > 0 && responses < policy.min_report_responses;
    const eligible = eligibleBySurvey.get(String(stat.survey._id)) || 0;
    const criteria = suppressed ? [] : [...stat.criteria.values()].map((criterion) => ({
      category: criterion.category,
      text: criterion.text,
      average: Number((criterion.total / criterion.count).toFixed(2)),
      answerCount: criterion.count
    }));
    return {
      id: String(stat.survey._id),
      title: stat.survey.title,
      courseId: String(stat.assignment.course_id?._id || stat.assignment.course_id),
      courseCode: stat.assignment.course_id?.code || '',
      courseTitle: stat.assignment.course_id?.title || '',
      assignmentId: String(stat.assignment._id),
      className: stat.assignment.class_id?.name || '',
      academicYear: stat.assignment.academic_year,
      semester: stat.assignment.semester,
      startsAt: stat.survey.starts_at,
      endsAt: stat.survey.ends_at,
      status: stat.survey.status,
      suppressed,
      minimumResponses: policy.min_report_responses,
      eligibleStudents: suppressed ? null : eligible || null,
      completedEvaluations: suppressed ? null : responses,
      responseRate: !suppressed && eligible > 0 ? Number((responses / eligible * 100).toFixed(2)) : null,
      averageOverall: !suppressed && stat.scores.length
        ? Number((stat.scores.reduce((sum, score) => sum + score, 0) / stat.scores.length).toFixed(2))
        : null,
      criteria,
      ratingLabels: ['1', '2', '3', '4', '5'],
      ratingDistribution: suppressed ? null : stat.distribution,
      feedbackCount: suppressed ? null : stat.feedbackCount,
      feedbackNote: suppressed
        ? 'Chưa đạt ngưỡng phản hồi tối thiểu.'
        : 'Nội dung góp ý tự do không hiển thị nhằm bảo vệ danh tính người trả lời.'
    };
  });
  const comparisonGroups = new Map();
  for (const stat of periodStats.values()) {
    const key = [
      String(stat.assignment.course_id?._id || stat.assignment.course_id),
      stat.assignment.academic_year,
      stat.assignment.semester
    ].join('|');
    const group = comparisonGroups.get(key) || {
      courseId: String(stat.assignment.course_id?._id || stat.assignment.course_id),
      courseCode: stat.assignment.course_id?.code || '',
      courseTitle: stat.assignment.course_id?.title || '',
      academicYear: stat.assignment.academic_year,
      semester: stat.assignment.semester,
      responseCount: 0, scoreTotal: 0, scoreCount: 0,
      distribution: [0, 0, 0, 0, 0],
      eligibleStudents: 0,
      criteria: new Map(),
      periods: 0
    };
    group.periods += 1;
    group.eligibleStudents += eligibleBySurvey.get(String(stat.survey._id)) || 0;
    for (const score of stat.scores) {
      group.scoreTotal += score;
      group.scoreCount += 1;
      group.distribution[score - 1] += 1;
    }
    for (const evaluation of stat.evaluations) {
      group.responseCount += 1;
      for (const answer of evaluation.answers || []) {
        if (!Number.isFinite(answer.score) || answer.score < 1 || answer.score > 5) continue;
        const criterionKey = `${answer.category}\u0000${answer.text}`;
        const criterion = group.criteria.get(criterionKey) || {
          category: answer.category, text: answer.text, total: 0, count: 0
        };
        criterion.total += answer.score;
        criterion.count += 1;
        group.criteria.set(criterionKey, criterion);
      }
    }
    comparisonGroups.set(key, group);
  }
  const comparisons = [...comparisonGroups.values()].map((group) => {
    const suppressed = group.responseCount > 0 && group.responseCount < policy.min_report_responses;
    const eligible = group.eligibleStudents;
    return {
      courseId: group.courseId,
      courseCode: group.courseCode,
      courseTitle: group.courseTitle,
      academicYear: group.academicYear,
      semester: group.semester,
      surveyCount: group.periods,
      suppressed,
      completedEvaluations: suppressed ? null : group.responseCount,
      eligibleStudents: suppressed ? null : eligible || null,
      responseRate: !suppressed && eligible > 0
        ? Number((group.responseCount / eligible * 100).toFixed(2))
        : null,
      averageOverall: !suppressed && group.scoreCount
        ? Number((group.scoreTotal / group.scoreCount).toFixed(2))
        : null,
      criteria: suppressed ? [] : [...group.criteria.values()].map((criterion) => ({
        category: criterion.category,
        text: criterion.text,
        average: Number((criterion.total / criterion.count).toFixed(2)),
        answerCount: criterion.count
      })),
      ratingDistribution: suppressed ? null : group.distribution
    };
  });
  const courseById = new Map(allAssignments.map((assignment) => {
    const course = assignment.course_id;
    return [String(course?._id || course), {
      id: String(course?._id || course),
      code: course?.code || '',
      title: course?.title || ''
    }];
  }));
  const years = [...new Set(allAssignments.map((assignment) => assignment.academic_year))].sort().reverse();
  const semesters = [...new Set(allAssignments.map((assignment) => assignment.semester))].sort();
  const visiblePeriods = periods.filter((period) => !period.suppressed);
  const totalRatingCount = visiblePeriods.reduce((total, period) =>
    total + period.ratingDistribution.reduce((sum, count) => sum + count, 0), 0);
  const summaryCriteria = new Map();
  for (const period of visiblePeriods) {
    for (const criterion of period.criteria) {
      const key = `${criterion.category}\u0000${criterion.text}`;
      const aggregate = summaryCriteria.get(key) || {
        category: criterion.category, text: criterion.text, total: 0, count: 0
      };
      aggregate.total += criterion.average * criterion.answerCount;
      aggregate.count += criterion.answerCount;
      summaryCriteria.set(key, aggregate);
    }
  }
  return {
    data: {
      courses: [...courseById.values()].sort((left, right) => left.code.localeCompare(right.code)),
      periods,
      comparisons,
      summary: {
        courseCount: new Set(assignments.map((assignment) =>
          String(assignment.course_id?._id || assignment.course_id))).size,
        assignmentCount: assignments.length,
        responseCount: visiblePeriods.reduce((total, period) =>
          total + (period.completedEvaluations || 0), 0),
        eligibleStudents: visiblePeriods.reduce((total, period) =>
          total + (period.eligibleStudents || 0), 0),
        responseRate: visiblePeriods.reduce((total, period) =>
          total + (period.eligibleStudents || 0), 0)
          ? Number((visiblePeriods.reduce((total, period) =>
            total + (period.completedEvaluations || 0), 0) /
            visiblePeriods.reduce((total, period) =>
              total + (period.eligibleStudents || 0), 0) * 100).toFixed(2))
          : null,
        averageScore: totalRatingCount
          ? Number((visiblePeriods.reduce((total, period) =>
            total + (period.ratingDistribution.reduce((sum, count) => sum + count, 0) * period.averageOverall), 0) /
            totalRatingCount).toFixed(2))
          : null
      },
      criteria: [...summaryCriteria.values()].map((criterion) => ({
        label: `${criterion.category}: ${criterion.text}`,
        averageScore: Number((criterion.total / criterion.count).toFixed(2)),
        answerCount: criterion.count
      })),
      ratingDistribution: [0, 1, 2, 3, 4].map((rating) =>
        visiblePeriods.reduce((total, period) => total + period.ratingDistribution[rating], 0)),
      groups: visiblePeriods.map((period) => ({
        courseCode: period.courseCode,
        className: period.className,
        averageScore: period.averageOverall,
        responseCount: period.completedEvaluations
      })),
      comparison: comparisons.filter((group) => !group.suppressed).map((group) => ({
        courseCode: group.courseCode,
        courseName: group.courseTitle,
        academicYear: group.academicYear,
        semester: group.semester,
        responseCount: group.completedEvaluations,
        averageScore: group.averageOverall,
        criteria: group.criteria.map((criterion) => ({
          label: `${criterion.category}: ${criterion.text}`,
          averageScore: criterion.average
        }))
      })),
      feedbackCount: visiblePeriods.reduce((total, period) => total + (period.feedbackCount || 0), 0),
      filters: { academicYears: years, semesters },
      minimumResponses: policy.min_report_responses,
      formula: 'Điểm chung là trung bình cộng của tất cả điểm hợp lệ từ 1 đến 5 trong các câu trả lời đã lưu; câu bỏ trống không tính là 0. Điểm tiêu chí tính trên các câu trả lời có cùng nội dung và nhóm. Phân bố đếm từng điểm Likert đã nộp.'
    }
  };
}

module.exports = router;
module.exports.buildLecturerAnalytics = buildLecturerAnalytics;
