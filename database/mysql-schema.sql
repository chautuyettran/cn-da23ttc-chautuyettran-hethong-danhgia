CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lecturers (
  id CHAR(24) NOT NULL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  department VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(24) NOT NULL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'lecturer', 'student') NOT NULL,
  lecturer_id CHAR(24) NULL UNIQUE,
  phone_number VARCHAR(16) NOT NULL DEFAULT '',
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  github_url VARCHAR(255) NOT NULL DEFAULT '',
  avatar_filename VARCHAR(100) NOT NULL DEFAULT '',
  auth_version INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_users_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE RESTRICT,
  CONSTRAINT chk_users_phone_verified CHECK (phone_verified = FALSE OR phone_number <> ''),
  INDEX idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS courses (
  id CHAR(24) NOT NULL PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS classes (
  id CHAR(24) NOT NULL PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS teaching_assignments (
  id CHAR(24) NOT NULL PRIMARY KEY,
  lecturer_id CHAR(24) NOT NULL,
  course_id CHAR(24) NOT NULL,
  class_id CHAR(24) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_assignment_period (lecturer_id, course_id, class_id, academic_year, semester),
  INDEX idx_assignments_lecturer (lecturer_id),
  INDEX idx_assignments_course (course_id),
  INDEX idx_assignments_class (class_id),
  CONSTRAINT fk_assignments_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignments_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS survey_questions (
  id CHAR(24) NOT NULL PRIMARY KEY,
  text VARCHAR(1000) NOT NULL,
  category VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_survey_questions_category (category),
  INDEX idx_survey_questions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS survey_periods (
  id CHAR(24) NOT NULL PRIMARY KEY,
  assignment_id CHAR(24) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  status ENUM('draft', 'open', 'closed') NOT NULL DEFAULT 'draft',
  questions JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_surveys_status_dates (status, starts_at, ends_at),
  CONSTRAINT fk_surveys_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT chk_surveys_dates CHECK (starts_at < ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lecturer_questions (
  id CHAR(24) NOT NULL PRIMARY KEY,
  lecturer_id CHAR(24) NOT NULL,
  assignment_id CHAR(24) NOT NULL,
  survey_id CHAR(24) NULL,
  text VARCHAR(1000) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  question_type ENUM('likert') NOT NULL DEFAULT 'likert',
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_lecturer_questions_scope (lecturer_id, assignment_id, survey_id, is_active),
  CONSTRAINT fk_lq_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lq_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lq_survey FOREIGN KEY (survey_id) REFERENCES survey_periods(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS enrollments (
  id CHAR(24) NOT NULL PRIMARY KEY,
  class_id CHAR(24) NOT NULL,
  student_id CHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_enrollment (class_id, student_id),
  INDEX idx_enrollment_student (student_id),
  CONSTRAINT fk_enrollment_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollment_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS submission_eligibility (
  id CHAR(24) NOT NULL PRIMARY KEY,
  survey_id CHAR(24) NOT NULL,
  assignment_id CHAR(24) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL,
  student_id CHAR(24) NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_eligibility_assignment_period_student (assignment_id, academic_year, semester, student_id),
  UNIQUE KEY uq_eligibility_survey_student (survey_id, student_id),
  CONSTRAINT fk_eligibility_survey FOREIGN KEY (survey_id) REFERENCES survey_periods(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eligibility_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eligibility_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS evaluations (
  id CHAR(24) NOT NULL PRIMARY KEY,
  survey_id CHAR(24) NOT NULL,
  assignment_id CHAR(24) NOT NULL,
  lecturer_id CHAR(24) NOT NULL,
  course_id CHAR(24) NOT NULL,
  feedback VARCHAR(2000) NOT NULL DEFAULT '',
  answers JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_evaluations_survey_created (survey_id, created_at),
  INDEX idx_evaluations_lecturer_created (lecturer_id, created_at),
  INDEX idx_evaluations_course_created (course_id, created_at),
  CONSTRAINT fk_evaluations_survey FOREIGN KEY (survey_id) REFERENCES survey_periods(id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluations_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluations_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluations_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS submission_records (
  id CHAR(24) NOT NULL PRIMARY KEY,
  scope_key VARCHAR(200) NOT NULL,
  survey_id CHAR(24) NOT NULL,
  assignment_id CHAR(24) NOT NULL,
  student_id CHAR(24) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 1,
  evaluation_id CHAR(24) NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_submission_scope_student (scope_key, student_id),
  INDEX idx_submission_survey_date (survey_id, submitted_at),
  CONSTRAINT fk_records_survey FOREIGN KEY (survey_id) REFERENCES survey_periods(id) ON DELETE RESTRICT,
  CONSTRAINT fk_records_assignment FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_records_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_records_evaluation FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_submission_attempts CHECK (attempts BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS evaluation_policies (
  id CHAR(24) NOT NULL PRIMARY KEY,
  `key` VARCHAR(50) NOT NULL UNIQUE,
  scope ENUM('survey', 'assignment_period') NOT NULL DEFAULT 'survey',
  max_submissions TINYINT UNSIGNED NOT NULL DEFAULT 1,
  allow_revisions BOOLEAN NOT NULL DEFAULT FALSE,
  min_report_responses SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_policy_submissions CHECK (max_submissions BETWEEN 1 AND 10),
  CONSTRAINT chk_policy_responses CHECK (min_report_responses BETWEEN 1 AND 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_recovery_challenges (
  id CHAR(24) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  stage ENUM('captcha', 'checking', 'otp', 'verified', 'used') NOT NULL,
  purpose ENUM('recover', 'change') NOT NULL,
  captcha_hash VARCHAR(64) NOT NULL DEFAULT '',
  captcha_expires_at DATETIME(3) NULL,
  user_id CHAR(24) NULL,
  email_hash VARCHAR(64) NOT NULL DEFAULT '',
  phone_hash VARCHAR(64) NOT NULL DEFAULT '',
  ip_hash VARCHAR(64) NOT NULL DEFAULT '',
  otp_hash VARCHAR(64) NOT NULL DEFAULT '',
  otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  otp_expires_at DATETIME(3) NULL,
  next_resend_at DATETIME(3) NULL,
  reset_token_hash VARCHAR(64) NOT NULL DEFAULT '',
  reset_expires_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_recovery_stage_expiry (stage, expires_at),
  INDEX idx_recovery_user_stage (user_id, stage),
  INDEX idx_recovery_reset_expiry (reset_expires_at),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_recovery_otp_attempts CHECK (otp_attempts <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_recovery_limits (
  id CHAR(24) NOT NULL PRIMARY KEY,
  `key` VARCHAR(64) NOT NULL UNIQUE,
  count INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_recovery_limits_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
