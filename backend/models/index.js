const { mongoose } = require('../config/db');
const { normalizeEmail, isRoleEmailValid, accountEmailError } = require('../validators/account');

const { Schema } = mongoose;
const objectId = Schema.Types.ObjectId;

const userSchema = new Schema({
  full_name: { type: String, required: true, trim: true, maxlength: 150 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 255 },
  password_hash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'lecturer', 'student'], required: true, index: true },
  lecturer_id: { type: objectId, ref: 'Lecturer', default: null },
  is_active: { type: Boolean, default: true, index: true }
}, { timestamps: true, collection: 'users' });
userSchema.index(
  { lecturer_id: 1 },
  { unique: true, partialFilterExpression: { lecturer_id: { $type: 'objectId' } } }
);
userSchema.pre('validate', function validateInstitutionalEmail(next) {
  this.email = normalizeEmail(this.email);
  if (!isRoleEmailValid(this.role, this.email)) return next(new Error(accountEmailError(this.role)));
  return next();
});

const lecturerSchema = new Schema({
  full_name: { type: String, required: true, trim: true, maxlength: 150 },
  department: { type: String, required: true, trim: true, maxlength: 150 },
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 255,
    match: /^[^\s@]+@tvu\.edu\.vn$/
  }
}, { timestamps: true, collection: 'lecturers' });

const courseSchema = new Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 30 },
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, default: '', maxlength: 2000 }
}, { timestamps: true, collection: 'courses' });

const classSchema = new Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 30 },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  academic_year: { type: String, required: true, trim: true, maxlength: 20 },
  semester: { type: String, trim: true, maxlength: 30, default: '' }
}, { timestamps: true, collection: 'classes' });

const assignmentSchema = new Schema({
  lecturer_id: { type: objectId, ref: 'Lecturer', required: true, index: true },
  course_id: { type: objectId, ref: 'Course', required: true, index: true },
  class_id: { type: objectId, ref: 'ClassSection', required: true, index: true },
  academic_year: { type: String, required: true, trim: true, maxlength: 20 },
  semester: { type: String, required: true, trim: true, maxlength: 30 }
}, { timestamps: true, collection: 'teaching_assignments' });
assignmentSchema.index({ lecturer_id: 1, course_id: 1, class_id: 1, academic_year: 1, semester: 1 }, { unique: true });

const questionSchema = new Schema({
  text: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
  category: { type: String, required: true, trim: true, maxlength: 100, index: true },
  is_active: { type: Boolean, default: true, index: true }
}, { timestamps: true, collection: 'survey_questions' });

const surveyPeriodSchema = new Schema({
  assignment_id: { type: objectId, ref: 'TeachingAssignment', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  starts_at: { type: Date, required: true },
  ends_at: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'open', 'closed'], default: 'draft', index: true },
  questions: [{
    question_id: { type: objectId, ref: 'SurveyQuestion', required: true },
    position: { type: Number, required: true, min: 1 }
  }]
}, { timestamps: true, collection: 'survey_periods' });
surveyPeriodSchema.index({ status: 1, starts_at: 1, ends_at: 1 });

const enrollmentSchema = new Schema({
  class_id: { type: objectId, ref: 'ClassSection', required: true },
  student_id: { type: objectId, ref: 'User', required: true }
}, { timestamps: true, collection: 'class_students' });
enrollmentSchema.index({ class_id: 1, student_id: 1 }, { unique: true });
enrollmentSchema.index({ student_id: 1 });

const eligibilitySchema = new Schema({
  survey_id: { type: objectId, ref: 'SurveyPeriod', required: true },
  assignment_id: { type: objectId, ref: 'TeachingAssignment', required: true },
  academic_year: { type: String, required: true, trim: true, maxlength: 20 },
  semester: { type: String, required: true, trim: true, maxlength: 30 },
  student_id: { type: objectId, ref: 'User', required: true, select: false },
  submitted_at: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'submission_eligibility' });
eligibilitySchema.index(
  { assignment_id: 1, academic_year: 1, semester: 1, student_id: 1 },
  { unique: true }
);
eligibilitySchema.index({ survey_id: 1, student_id: 1 }, { unique: true });

const submissionRecordSchema = new Schema({
  scope_key: { type: String, required: true, maxlength: 200 },
  survey_id: { type: objectId, ref: 'SurveyPeriod', required: true },
  assignment_id: { type: objectId, ref: 'TeachingAssignment', required: true },
  student_id: { type: objectId, ref: 'User', required: true, select: false },
  attempts: { type: Number, required: true, min: 1, default: 1 },
  evaluation_id: { type: objectId, ref: 'Evaluation', required: true },
  submitted_at: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'submission_records' });
submissionRecordSchema.index({ scope_key: 1, student_id: 1 }, { unique: true });
submissionRecordSchema.index({ survey_id: 1, submitted_at: -1 });

const evaluationPolicySchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  scope: { type: String, enum: ['survey', 'assignment_period'], required: true, default: 'survey' },
  max_submissions: { type: Number, required: true, min: 1, max: 10, default: 1 },
  allow_revisions: { type: Boolean, required: true, default: false },
  min_report_responses: { type: Number, required: true, min: 1, max: 1000, default: 5 }
}, { timestamps: true, collection: 'evaluation_policies' });

const evaluationSchema = new Schema({
  survey_id: { type: objectId, ref: 'SurveyPeriod', required: true, index: true },
  assignment_id: { type: objectId, ref: 'TeachingAssignment', required: true },
  lecturer_id: { type: objectId, ref: 'Lecturer', required: true, index: true },
  course_id: { type: objectId, ref: 'Course', required: true, index: true },
  answers: [{
    question_id: { type: objectId, ref: 'SurveyQuestion', required: true },
    category: { type: String, required: true },
    text: { type: String, required: true },
    score: { type: Number, required: true, min: 1, max: 5 }
  }],
  feedback: { type: String, default: '', maxlength: 2000 }
}, { timestamps: true, collection: 'evaluations' });
evaluationSchema.index({ survey_id: 1, createdAt: -1 });

const models = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  Lecturer: mongoose.models.Lecturer || mongoose.model('Lecturer', lecturerSchema),
  Course: mongoose.models.Course || mongoose.model('Course', courseSchema),
  ClassSection: mongoose.models.ClassSection || mongoose.model('ClassSection', classSchema),
  TeachingAssignment: mongoose.models.TeachingAssignment || mongoose.model('TeachingAssignment', assignmentSchema),
  SurveyQuestion: mongoose.models.SurveyQuestion || mongoose.model('SurveyQuestion', questionSchema),
  SurveyPeriod: mongoose.models.SurveyPeriod || mongoose.model('SurveyPeriod', surveyPeriodSchema),
  Enrollment: mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema),
  SubmissionEligibility: mongoose.models.SubmissionEligibility || mongoose.model('SubmissionEligibility', eligibilitySchema),
  Evaluation: mongoose.models.Evaluation || mongoose.model('Evaluation', evaluationSchema),
  SubmissionRecord: mongoose.models.SubmissionRecord || mongoose.model('SubmissionRecord', submissionRecordSchema),
  EvaluationPolicy: mongoose.models.EvaluationPolicy || mongoose.model('EvaluationPolicy', evaluationPolicySchema)
};

module.exports = models;
