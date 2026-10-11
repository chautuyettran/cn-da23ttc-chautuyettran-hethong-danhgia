const models = require('../models');

async function getEvaluationPolicy() {
  const policy = await models.EvaluationPolicy.findOne({ key: 'global' }).lean();
  if (!policy) throw new Error('Evaluation policy has not been initialized.');
  return policy;
}

module.exports = { getEvaluationPolicy };
