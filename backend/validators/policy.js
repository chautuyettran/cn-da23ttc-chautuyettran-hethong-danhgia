const { z } = require('zod');

const evaluationPolicySchema = z.object({
  scope: z.enum(['survey', 'assignment_period']),
  max_submissions: z.coerce.number().int().min(1).max(10),
  allow_revisions: z.boolean(),
  min_report_responses: z.coerce.number().int().min(1).max(1000)
}).refine(
  (policy) => policy.allow_revisions ? policy.max_submissions > 1 : policy.max_submissions === 1,
  { message: 'Cho phép chỉnh sửa cần ít nhất hai lần gửi; nhiều lần gửi cũng yêu cầu bật chỉnh sửa.' }
);

function submissionScopeKey(policy, survey, assignment) {
  if (policy.scope === 'assignment_period') {
    return `assignment:${assignment._id}:${assignment.academic_year}:${assignment.semester}`;
  }
  return `survey:${survey._id}`;
}

module.exports = { evaluationPolicySchema, submissionScopeKey };
