IF DB_ID(N'teaching_quality') IS NULL
BEGIN
  CREATE DATABASE [teaching_quality];
END;
GO

USE [teaching_quality];
GO

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (
    version NVARCHAR(100) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
    applied_at DATETIME2(3) NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF OBJECT_ID(N'dbo.lecturers', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.lecturers (
    id CHAR(24) NOT NULL CONSTRAINT PK_lecturers PRIMARY KEY,
    full_name NVARCHAR(150) NOT NULL,
    department NVARCHAR(150) NOT NULL,
    email NVARCHAR(255) NOT NULL CONSTRAINT UQ_lecturers_email UNIQUE,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_lecturers_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_lecturers_updated_at DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id CHAR(24) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
    full_name NVARCHAR(150) NOT NULL,
    email NVARCHAR(255) NOT NULL CONSTRAINT UQ_users_email UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    [role] NVARCHAR(10) NOT NULL,
    lecturer_id CHAR(24) NULL,
    phone_number NVARCHAR(16) NOT NULL CONSTRAINT DF_users_phone_number DEFAULT (N''),
    phone_verified BIT NOT NULL CONSTRAINT DF_users_phone_verified DEFAULT (0),
    github_url NVARCHAR(255) NOT NULL CONSTRAINT DF_users_github_url DEFAULT (N''),
    avatar_filename NVARCHAR(100) NOT NULL CONSTRAINT DF_users_avatar_filename DEFAULT (N''),
    auth_version BIGINT NOT NULL CONSTRAINT DF_users_auth_version DEFAULT (0),
    is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_users_lecturer FOREIGN KEY (lecturer_id) REFERENCES dbo.lecturers(id) ON DELETE NO ACTION,
    CONSTRAINT CK_users_role CHECK ([role] IN (N'admin', N'lecturer', N'student')),
    CONSTRAINT CK_users_auth_version CHECK (auth_version BETWEEN 0 AND 4294967295),
    CONSTRAINT CK_users_phone_verified CHECK (phone_verified = 0 OR phone_number <> N'')
  );
END;
GO

IF OBJECT_ID(N'dbo.courses', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.courses (
    id CHAR(24) NOT NULL CONSTRAINT PK_courses PRIMARY KEY,
    code NVARCHAR(30) NOT NULL CONSTRAINT UQ_courses_code UNIQUE,
    title NVARCHAR(150) NOT NULL,
    description NVARCHAR(2000) NOT NULL CONSTRAINT DF_courses_description DEFAULT (N''),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_courses_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_courses_updated_at DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF OBJECT_ID(N'dbo.classes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.classes (
    id CHAR(24) NOT NULL CONSTRAINT PK_classes PRIMARY KEY,
    code NVARCHAR(30) NOT NULL CONSTRAINT UQ_classes_code UNIQUE,
    name NVARCHAR(150) NOT NULL,
    academic_year NVARCHAR(20) NOT NULL,
    semester NVARCHAR(30) NOT NULL CONSTRAINT DF_classes_semester DEFAULT (N''),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_classes_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_classes_updated_at DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF OBJECT_ID(N'dbo.teaching_assignments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.teaching_assignments (
    id CHAR(24) NOT NULL CONSTRAINT PK_teaching_assignments PRIMARY KEY,
    lecturer_id CHAR(24) NOT NULL,
    course_id CHAR(24) NOT NULL,
    class_id CHAR(24) NOT NULL,
    academic_year NVARCHAR(20) NOT NULL,
    semester NVARCHAR(30) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_teaching_assignments_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_teaching_assignments_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_assignment_period UNIQUE (lecturer_id, course_id, class_id, academic_year, semester),
    CONSTRAINT FK_assignments_lecturer FOREIGN KEY (lecturer_id) REFERENCES dbo.lecturers(id) ON DELETE NO ACTION,
    CONSTRAINT FK_assignments_course FOREIGN KEY (course_id) REFERENCES dbo.courses(id) ON DELETE NO ACTION,
    CONSTRAINT FK_assignments_class FOREIGN KEY (class_id) REFERENCES dbo.classes(id) ON DELETE NO ACTION
  );
END;
GO

IF OBJECT_ID(N'dbo.survey_questions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_questions (
    id CHAR(24) NOT NULL CONSTRAINT PK_survey_questions PRIMARY KEY,
    [text] NVARCHAR(1000) NOT NULL,
    category NVARCHAR(100) NOT NULL,
    is_active BIT NOT NULL CONSTRAINT DF_survey_questions_is_active DEFAULT (1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_survey_questions_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_survey_questions_updated_at DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF OBJECT_ID(N'dbo.survey_periods', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.survey_periods (
    id CHAR(24) NOT NULL CONSTRAINT PK_survey_periods PRIMARY KEY,
    assignment_id CHAR(24) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    description NVARCHAR(2000) NOT NULL CONSTRAINT DF_survey_periods_description DEFAULT (N''),
    starts_at DATETIME2(3) NOT NULL,
    ends_at DATETIME2(3) NOT NULL,
    [status] NVARCHAR(10) NOT NULL CONSTRAINT DF_survey_periods_status DEFAULT (N'draft'),
    questions NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_survey_periods_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_survey_periods_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_surveys_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.teaching_assignments(id) ON DELETE NO ACTION,
    CONSTRAINT CK_surveys_status CHECK ([status] IN (N'draft', N'open', N'closed')),
    CONSTRAINT CK_surveys_dates CHECK (starts_at < ends_at),
    CONSTRAINT CK_surveys_questions_json CHECK (ISJSON(questions) = 1)
  );
END;
GO

IF OBJECT_ID(N'dbo.lecturer_questions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.lecturer_questions (
    id CHAR(24) NOT NULL CONSTRAINT PK_lecturer_questions PRIMARY KEY,
    lecturer_id CHAR(24) NOT NULL,
    assignment_id CHAR(24) NOT NULL,
    survey_id CHAR(24) NULL,
    [text] NVARCHAR(1000) NOT NULL,
    category NVARCHAR(100) NOT NULL,
    description NVARCHAR(500) NOT NULL CONSTRAINT DF_lecturer_questions_description DEFAULT (N''),
    question_type NVARCHAR(20) NOT NULL CONSTRAINT DF_lecturer_questions_question_type DEFAULT (N'likert'),
    is_required BIT NOT NULL CONSTRAINT DF_lecturer_questions_is_required DEFAULT (0),
    is_active BIT NOT NULL CONSTRAINT DF_lecturer_questions_is_active DEFAULT (1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_lecturer_questions_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_lecturer_questions_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_lq_lecturer FOREIGN KEY (lecturer_id) REFERENCES dbo.lecturers(id) ON DELETE NO ACTION,
    CONSTRAINT FK_lq_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.teaching_assignments(id) ON DELETE NO ACTION,
    CONSTRAINT FK_lq_survey FOREIGN KEY (survey_id) REFERENCES dbo.survey_periods(id) ON DELETE NO ACTION,
    CONSTRAINT CK_lq_question_type CHECK (question_type = N'likert')
  );
END;
GO

IF OBJECT_ID(N'dbo.enrollments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.enrollments (
    id CHAR(24) NOT NULL CONSTRAINT PK_enrollments PRIMARY KEY,
    class_id CHAR(24) NOT NULL,
    student_id CHAR(24) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_enrollments_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_enrollments_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_enrollment UNIQUE (class_id, student_id),
    CONSTRAINT FK_enrollment_class FOREIGN KEY (class_id) REFERENCES dbo.classes(id) ON DELETE NO ACTION,
    CONSTRAINT FK_enrollment_student FOREIGN KEY (student_id) REFERENCES dbo.users(id) ON DELETE NO ACTION
  );
END;
GO

IF OBJECT_ID(N'dbo.submission_eligibility', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.submission_eligibility (
    id CHAR(24) NOT NULL CONSTRAINT PK_submission_eligibility PRIMARY KEY,
    survey_id CHAR(24) NOT NULL,
    assignment_id CHAR(24) NOT NULL,
    academic_year NVARCHAR(20) NOT NULL,
    semester NVARCHAR(30) NOT NULL,
    student_id CHAR(24) NOT NULL,
    submitted_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_eligibility_submitted_at DEFAULT (SYSUTCDATETIME()),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_eligibility_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_eligibility_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_eligibility_assignment_period_student UNIQUE (assignment_id, academic_year, semester, student_id),
    CONSTRAINT UQ_eligibility_survey_student UNIQUE (survey_id, student_id),
    CONSTRAINT FK_eligibility_survey FOREIGN KEY (survey_id) REFERENCES dbo.survey_periods(id) ON DELETE NO ACTION,
    CONSTRAINT FK_eligibility_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.teaching_assignments(id) ON DELETE NO ACTION,
    CONSTRAINT FK_eligibility_student FOREIGN KEY (student_id) REFERENCES dbo.users(id) ON DELETE NO ACTION
  );
END;
GO

IF OBJECT_ID(N'dbo.evaluations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.evaluations (
    id CHAR(24) NOT NULL CONSTRAINT PK_evaluations PRIMARY KEY,
    survey_id CHAR(24) NOT NULL,
    assignment_id CHAR(24) NOT NULL,
    lecturer_id CHAR(24) NOT NULL,
    course_id CHAR(24) NOT NULL,
    feedback NVARCHAR(2000) NOT NULL CONSTRAINT DF_evaluations_feedback DEFAULT (N''),
    answers NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_evaluations_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_evaluations_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_evaluations_survey FOREIGN KEY (survey_id) REFERENCES dbo.survey_periods(id) ON DELETE NO ACTION,
    CONSTRAINT FK_evaluations_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.teaching_assignments(id) ON DELETE NO ACTION,
    CONSTRAINT FK_evaluations_lecturer FOREIGN KEY (lecturer_id) REFERENCES dbo.lecturers(id) ON DELETE NO ACTION,
    CONSTRAINT FK_evaluations_course FOREIGN KEY (course_id) REFERENCES dbo.courses(id) ON DELETE NO ACTION,
    CONSTRAINT CK_evaluations_answers_json CHECK (ISJSON(answers) = 1)
  );
END;
GO

IF OBJECT_ID(N'dbo.submission_records', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.submission_records (
    id CHAR(24) NOT NULL CONSTRAINT PK_submission_records PRIMARY KEY,
    scope_key NVARCHAR(200) NOT NULL,
    survey_id CHAR(24) NOT NULL,
    assignment_id CHAR(24) NOT NULL,
    student_id CHAR(24) NOT NULL,
    attempts TINYINT NOT NULL CONSTRAINT DF_submission_records_attempts DEFAULT (1),
    evaluation_id CHAR(24) NOT NULL,
    submitted_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_records_submitted_at DEFAULT (SYSUTCDATETIME()),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_records_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_submission_records_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_submission_scope_student UNIQUE (scope_key, student_id),
    CONSTRAINT FK_records_survey FOREIGN KEY (survey_id) REFERENCES dbo.survey_periods(id) ON DELETE NO ACTION,
    CONSTRAINT FK_records_assignment FOREIGN KEY (assignment_id) REFERENCES dbo.teaching_assignments(id) ON DELETE NO ACTION,
    CONSTRAINT FK_records_student FOREIGN KEY (student_id) REFERENCES dbo.users(id) ON DELETE NO ACTION,
    CONSTRAINT FK_records_evaluation FOREIGN KEY (evaluation_id) REFERENCES dbo.evaluations(id) ON DELETE NO ACTION,
    CONSTRAINT CK_submission_attempts CHECK (attempts BETWEEN 1 AND 10)
  );
END;
GO

IF OBJECT_ID(N'dbo.evaluation_policies', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.evaluation_policies (
    id CHAR(24) NOT NULL CONSTRAINT PK_evaluation_policies PRIMARY KEY,
    [key] NVARCHAR(50) NOT NULL CONSTRAINT UQ_evaluation_policies_key UNIQUE,
    [scope] NVARCHAR(30) NOT NULL CONSTRAINT DF_evaluation_policies_scope DEFAULT (N'survey'),
    max_submissions TINYINT NOT NULL CONSTRAINT DF_evaluation_policies_max_submissions DEFAULT (1),
    allow_revisions BIT NOT NULL CONSTRAINT DF_evaluation_policies_allow_revisions DEFAULT (0),
    min_report_responses SMALLINT NOT NULL CONSTRAINT DF_evaluation_policies_min_report_responses DEFAULT (5),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_evaluation_policies_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_evaluation_policies_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_policy_scope CHECK ([scope] IN (N'survey', N'assignment_period')),
    CONSTRAINT CK_policy_submissions CHECK (max_submissions BETWEEN 1 AND 10),
    CONSTRAINT CK_policy_responses CHECK (min_report_responses BETWEEN 1 AND 1000)
  );
END;
GO

IF OBJECT_ID(N'dbo.password_recovery_challenges', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.password_recovery_challenges (
    id CHAR(24) NOT NULL CONSTRAINT PK_password_recovery_challenges PRIMARY KEY,
    token_hash CHAR(64) NOT NULL CONSTRAINT UQ_password_recovery_challenges_token_hash UNIQUE,
    [stage] NVARCHAR(20) NOT NULL,
    purpose NVARCHAR(10) NOT NULL,
    captcha_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_captcha_hash DEFAULT (N''),
    captcha_expires_at DATETIME2(3) NULL,
    user_id CHAR(24) NULL,
    email_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_email_hash DEFAULT (N''),
    phone_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_phone_hash DEFAULT (N''),
    ip_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_ip_hash DEFAULT (N''),
    otp_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_otp_hash DEFAULT (N''),
    otp_attempts TINYINT NOT NULL CONSTRAINT DF_recovery_otp_attempts DEFAULT (0),
    otp_expires_at DATETIME2(3) NULL,
    next_resend_at DATETIME2(3) NULL,
    reset_token_hash NVARCHAR(64) NOT NULL CONSTRAINT DF_recovery_reset_token_hash DEFAULT (N''),
    reset_expires_at DATETIME2(3) NULL,
    expires_at DATETIME2(3) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_recovery_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_recovery_updated_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_recovery_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE,
    CONSTRAINT CK_recovery_stage CHECK ([stage] IN (N'captcha', N'checking', N'otp', N'verified', N'used')),
    CONSTRAINT CK_recovery_purpose CHECK (purpose IN (N'recover', N'change')),
    CONSTRAINT CK_recovery_otp_attempts CHECK (otp_attempts <= 5)
  );
END;
GO

IF OBJECT_ID(N'dbo.password_recovery_limits', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.password_recovery_limits (
    id CHAR(24) NOT NULL CONSTRAINT PK_password_recovery_limits PRIMARY KEY,
    [key] NVARCHAR(64) NOT NULL CONSTRAINT UQ_password_recovery_limits_key UNIQUE,
    [count] BIGINT NOT NULL,
    expires_at DATETIME2(3) NOT NULL,
    CONSTRAINT CK_recovery_limits_count CHECK ([count] BETWEEN 0 AND 4294967295)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_users_lecturer_id_not_null' AND object_id = OBJECT_ID(N'dbo.users'))
  CREATE UNIQUE INDEX UX_users_lecturer_id_not_null ON dbo.users(lecturer_id) WHERE lecturer_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_users_role_active' AND object_id = OBJECT_ID(N'dbo.users'))
  CREATE INDEX IX_users_role_active ON dbo.users([role], is_active);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_assignments_lecturer' AND object_id = OBJECT_ID(N'dbo.teaching_assignments'))
  CREATE INDEX IX_assignments_lecturer ON dbo.teaching_assignments(lecturer_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_assignments_course' AND object_id = OBJECT_ID(N'dbo.teaching_assignments'))
  CREATE INDEX IX_assignments_course ON dbo.teaching_assignments(course_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_assignments_class' AND object_id = OBJECT_ID(N'dbo.teaching_assignments'))
  CREATE INDEX IX_assignments_class ON dbo.teaching_assignments(class_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_survey_questions_category' AND object_id = OBJECT_ID(N'dbo.survey_questions'))
  CREATE INDEX IX_survey_questions_category ON dbo.survey_questions(category);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_survey_questions_active' AND object_id = OBJECT_ID(N'dbo.survey_questions'))
  CREATE INDEX IX_survey_questions_active ON dbo.survey_questions(is_active);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_surveys_status_dates' AND object_id = OBJECT_ID(N'dbo.survey_periods'))
  CREATE INDEX IX_surveys_status_dates ON dbo.survey_periods([status], starts_at, ends_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_lecturer_questions_scope' AND object_id = OBJECT_ID(N'dbo.lecturer_questions'))
  CREATE INDEX IX_lecturer_questions_scope ON dbo.lecturer_questions(lecturer_id, assignment_id, survey_id, is_active);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_enrollment_student' AND object_id = OBJECT_ID(N'dbo.enrollments'))
  CREATE INDEX IX_enrollment_student ON dbo.enrollments(student_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_evaluations_survey_created' AND object_id = OBJECT_ID(N'dbo.evaluations'))
  CREATE INDEX IX_evaluations_survey_created ON dbo.evaluations(survey_id, created_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_evaluations_lecturer_created' AND object_id = OBJECT_ID(N'dbo.evaluations'))
  CREATE INDEX IX_evaluations_lecturer_created ON dbo.evaluations(lecturer_id, created_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_evaluations_course_created' AND object_id = OBJECT_ID(N'dbo.evaluations'))
  CREATE INDEX IX_evaluations_course_created ON dbo.evaluations(course_id, created_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_submission_survey_date' AND object_id = OBJECT_ID(N'dbo.submission_records'))
  CREATE INDEX IX_submission_survey_date ON dbo.submission_records(survey_id, submitted_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_recovery_stage_expiry' AND object_id = OBJECT_ID(N'dbo.password_recovery_challenges'))
  CREATE INDEX IX_recovery_stage_expiry ON dbo.password_recovery_challenges([stage], expires_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_recovery_user_stage' AND object_id = OBJECT_ID(N'dbo.password_recovery_challenges'))
  CREATE INDEX IX_recovery_user_stage ON dbo.password_recovery_challenges(user_id, [stage]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_recovery_reset_expiry' AND object_id = OBJECT_ID(N'dbo.password_recovery_challenges'))
  CREATE INDEX IX_recovery_reset_expiry ON dbo.password_recovery_challenges(reset_expires_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_recovery_limits_expiry' AND object_id = OBJECT_ID(N'dbo.password_recovery_limits'))
  CREATE INDEX IX_recovery_limits_expiry ON dbo.password_recovery_limits(expires_at);
GO

CREATE OR ALTER TRIGGER dbo.TR_lecturers_updated_at ON dbo.lecturers
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.lecturers AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_users_updated_at ON dbo.users
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.users AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_courses_updated_at ON dbo.courses
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.courses AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_classes_updated_at ON dbo.classes
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.classes AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_teaching_assignments_updated_at ON dbo.teaching_assignments
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.teaching_assignments AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_survey_questions_updated_at ON dbo.survey_questions
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.survey_questions AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_survey_periods_updated_at ON dbo.survey_periods
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.survey_periods AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_lecturer_questions_updated_at ON dbo.lecturer_questions
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.lecturer_questions AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_enrollments_updated_at ON dbo.enrollments
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.enrollments AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_submission_eligibility_updated_at ON dbo.submission_eligibility
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.submission_eligibility AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_evaluations_updated_at ON dbo.evaluations
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.evaluations AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_submission_records_updated_at ON dbo.submission_records
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.submission_records AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_evaluation_policies_updated_at ON dbo.evaluation_policies
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.evaluation_policies AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_password_recovery_challenges_updated_at ON dbo.password_recovery_challenges
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE target SET updated_at = SYSUTCDATETIME()
  FROM dbo.password_recovery_challenges AS target INNER JOIN inserted AS i ON i.id = target.id;
END;
GO
