const { randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { pool, withTransaction } = require('../config/mysql');
const { normalizeEmail, isRoleEmailValid, accountEmailError } = require('../validators/account');

const transactionContext = new AsyncLocalStorage();

const definitions = {
  User: {
    table: 'users',
    hidden: ['password_hash'],
    boolean: ['is_active', 'phone_verified'],
    ref: { lecturer_id: 'Lecturer' },
  },
  Lecturer: { table: 'lecturers', ref: { user_id: 'User' } },
  Course: { table: 'courses' },
  Class: { table: 'classes', ref: { course_id: 'Course' } },
  TeachingAssignment: {
    table: 'teaching_assignments',
    ref: { lecturer_id: 'Lecturer', course_id: 'Course', class_id: 'Class' },
  },
  SurveyQuestion: { table: 'survey_questions', boolean: ['is_active'] },
  SurveyPeriod: {
    table: 'survey_periods',
    json: ['questions'],
    ref: { assignment_id: 'TeachingAssignment' },
  },
  LecturerQuestion: {
    table: 'lecturer_questions',
    boolean: ['is_required', 'is_active'],
    ref: {
      lecturer_id: 'Lecturer',
      assignment_id: 'TeachingAssignment',
      survey_id: 'SurveyPeriod',
    },
  },
  Enrollment: {
    table: 'enrollments',
    ref: { class_id: 'Class', student_id: 'User' },
  },
  SubmissionEligibility: { table: 'submission_eligibility' },
  Evaluation: {
    table: 'evaluations',
    json: ['answers'],
    ref: {
      survey_id: 'SurveyPeriod',
      assignment_id: 'TeachingAssignment',
      lecturer_id: 'Lecturer',
      course_id: 'Course',
    },
  },
  SubmissionRecord: { table: 'submission_records' },
  EvaluationPolicy: { table: 'evaluation_policies', boolean: ['allow_revisions'] },
  RecoveryChallenge: { table: 'password_recovery_challenges' },
  RecoveryThrottle: { table: 'password_recovery_limits' },
};

const models = {};

function columnName(field, definition) {
  if (field === '_id') return definition.idColumn || 'id';
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function propertyName(column) {
  if (column === 'id') return '_id';
  if (column === 'created_at') return 'createdAt';
  if (column === 'updated_at') return 'updatedAt';
  return column;
}

function asId(value) {
  return value && typeof value === 'object' && value._id !== undefined
    ? String(value._id)
    : value === undefined || value === null || typeof value !== 'object' ? value : String(value);
}

function toDatabaseValue(value, column, definition) {
  if (value === undefined) return undefined;
  if (definition.json?.includes(column)) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  return asId(value);
}

function fromDatabaseValue(value, field, definition) {
  if (value === null || value === undefined) return value;
  const column = columnName(field, definition);
  if (definition.boolean?.includes(column)) return Boolean(value);
  if (definition.json?.includes(column) && typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

function normalizeResult(result) {
  if (result && typeof result.toObject === 'function') return result.toObject();
  if (Array.isArray(result)) return result.map(normalizeResult);
  if (result && typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, normalizeResult(value)]));
  }
  return result;
}

function buildWhere(filter, definition, tableAlias = '') {
  const clauses = [];
  const params = [];
  const addField = (field, expected) => {
    const jsonPath = field.match(/^(questions|answers)\.([a-zA-Z0-9_]+)$/);
    if (jsonPath) {
      const column = jsonPath[1];
      const path = `'$[*].${jsonPath[2]}'`;
      const jsonValues = Array.isArray(expected?.$in) ? expected.$in : [expected];
      const tests = jsonValues.map((value) => {
        params.push(String(asId(value)));
        return `JSON_SEARCH(${tableAlias ? `${tableAlias}.` : ''}\`${column}\`, 'one', ?, NULL, ${path}) IS NOT NULL`;
      });
      clauses.push(`(${tests.join(' OR ')})`);
      return;
    }
    const column = columnName(field, definition);
    const quoted = `${tableAlias ? `${tableAlias}.` : ''}\`${column}\``;
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      for (const [operator, value] of Object.entries(expected)) {
        if (operator === '$in' || operator === '$nin') {
          if (!value.length) {
            clauses.push(operator === '$in' ? '1 = 0' : '1 = 1');
            continue;
          }
          clauses.push(`${quoted} ${operator === '$in' ? 'IN' : 'NOT IN'} (${value.map(() => '?').join(', ')})`);
          params.push(...value.map((item) => toDatabaseValue(item, column, definition)));
        } else if (operator === '$ne') {
          clauses.push(`(${quoted} <> ? OR ${quoted} IS NULL)`);
          params.push(toDatabaseValue(value, column, definition));
        } else if (operator === '$gt' || operator === '$gte' || operator === '$lt' || operator === '$lte') {
          clauses.push(`${quoted} ${({ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' })[operator]} ?`);
          params.push(toDatabaseValue(value, column, definition));
        } else if (operator === '$exists') {
          clauses.push(`${quoted} IS ${value ? 'NOT ' : ''}NULL`);
        } else {
          throw new Error(`Unsupported MySQL filter operator: ${operator}`);
        }
      }
      return;
    }
    if (expected === null) {
      clauses.push(`${quoted} IS NULL`);
    } else {
      clauses.push(`${quoted} = ?`);
      params.push(toDatabaseValue(expected, column, definition));
    }
  };

  for (const [field, expected] of Object.entries(filter || {})) {
    if (field === '$or' || field === '$and') {
      const groups = expected.map((part) => buildWhere(part, definition, tableAlias));
      clauses.push(`(${groups.map((group) => group.sql || '1 = 1').join(field === '$or' ? ' OR ' : ' AND ')})`);
      params.push(...groups.flatMap((group) => group.params));
    } else {
      addField(field, expected);
    }
  }
  return { sql: clauses.join(' AND '), params };
}

function connectionFor(session) {
  return session?.connection || transactionContext.getStore() || pool;
}

async function execute(connection, ...args) {
  try {
    return await connection.execute(...args);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') error.code = 11000;
    throw error;
  }
}

function makeDocument(Model, row, includeHidden = false) {
  const definition = Model.definition;
  const values = {};
  for (const [column, value] of Object.entries(row)) {
    const field = propertyName(column);
    if (definition.hidden.includes(column) && !includeHidden) continue;
    values[field] = fromDatabaseValue(value, field, definition);
  }
  return new Model(values);
}

async function refreshDocument(Model, document, id, options) {
  const persisted = await Model.findById(id).session(options.session);
  if (!persisted) return;
  for (const [field, value] of Object.entries(persisted)) {
    if (document[field] === undefined || field === 'updatedAt') document[field] = value;
  }
}

class SqlDocument {
  constructor(values = {}) {
    Object.assign(this, this.constructor.normalize ? this.constructor.normalize(values) : values);
    this.isNew = !this[ModelId(this.constructor.definition)];
  }

  toObject() {
    return Object.fromEntries(Object.entries(this).filter(([key]) => key !== 'isNew'));
  }

  toJSON() {
    return this.toObject();
  }

  async save(options = {}) {
    const Model = this.constructor;
    await Model.persist(this, options);
    this.isNew = false;
    return this;
  }

  async validate() {
    const Model = this.constructor;
    if (Model.required) {
      for (const field of Model.required) {
        if (this[field] === undefined || this[field] === null || this[field] === '') {
          const error = new Error(`${field} is required`);
          error.name = 'ValidationError';
          throw error;
        }
      }
      if (Model.validateDocument) await Model.validateDocument(this);
    }
  }
}

function ModelId(definition) {
  return propertyName(definition.idColumn || 'id');
}

class SqlQuery {
  constructor(Model, operation, filter, projection = null) {
    this.Model = Model;
    this.operation = operation;
    this.filter = filter || {};
    this.projection = projection;
    this.sortOrder = null;
    this.maxRows = null;
    this.populations = [];
    this.asLean = false;
    this.sessionValue = null;
    this.distinctField = null;
  }

  select(value) {
    this.projection = value;
    return this;
  }

  sort(value) { this.sortOrder = value; return this; }
  limit(value) { this.maxRows = Number(value); return this; }
  populate(path, selectOrOptions, nested) {
    if (typeof path === 'object') this.populations.push(path);
    else {
      const item = { path };
      if (typeof selectOrOptions === 'string') item.select = selectOrOptions;
      else if (selectOrOptions && typeof selectOrOptions === 'object') Object.assign(item, selectOrOptions);
      if (nested) item.populate = nested;
      this.populations.push(item);
    }
    return this;
  }
  lean() { this.asLean = true; return this; }
  session(value) { this.sessionValue = value; return this; }
  distinct(field) { this.distinctField = field; return this; }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }

  async exec() {
    const { Model } = this;
    const definition = Model.definition;
    const where = buildWhere(this.filter, definition);
    const connection = connectionFor(this.sessionValue);
    if (this.distinctField) {
      const column = columnName(this.distinctField, definition);
      const [rows] = await execute(connection,
        `SELECT DISTINCT \`${column}\` AS value FROM \`${definition.table}\`${where.sql ? ` WHERE ${where.sql}` : ''}`,
        where.params,
      );
      return rows.map((row) => row.value);
    }
    let sql = `SELECT * FROM \`${definition.table}\`${where.sql ? ` WHERE ${where.sql}` : ''}`;
    if (this.sortOrder) {
      const order = Object.entries(this.sortOrder)
        .map(([field, direction]) => `\`${columnName(field, definition)}\` ${Number(direction) < 0 ? 'DESC' : 'ASC'}`)
        .join(', ');
      sql += ` ORDER BY ${order}`;
    }
    if (this.maxRows) sql += ` LIMIT ${Math.max(0, this.maxRows)}`;
    const [rows] = await execute(connection, sql, where.params);
    const includeHidden = typeof this.projection === 'string'
      && Model.definition.hidden.some((field) => this.projection.includes(`+${field}`));
    let results = rows.map((row) => makeDocument(Model, row, includeHidden));
    for (const population of this.populations) {
      results = await Promise.all(results.map((document) => populateDocument(document, population)));
    }
    if (this.asLean) results = results.map(normalizeResult);
    if (this.operation === 'one') return results[0] || null;
    return results;
  }
}

class SqlMutationQuery {
  constructor(Model, filter, update, options) {
    this.Model = Model;
    this.filter = filter;
    this.update = update;
    this.options = options;
    this.asLean = false;
    this.sessionValue = options.session || null;
  }

  lean() { this.asLean = true; return this; }
  session(value) { this.sessionValue = value; return this; }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }

  async exec() {
    const result = await updateModel(
      this.Model,
      this.filter,
      this.update,
      { ...this.options, session: this.sessionValue },
      true,
    );
    return this.asLean ? normalizeResult(result) : result;
  }
}

async function populateDocument(document, spec) {
  if (!document || !spec?.path) return document;
  const Model = document.constructor;
  const refName = Model.definition.ref?.[spec.path];
  if (!refName || !models[refName]) throw new Error(`No MySQL relation configured for ${Model.modelName}.${spec.path}`);
  const value = document[spec.path];
  if (value === null || value === undefined) return document;
  const Related = models[refName];
  const relatedQuery = Related.findById(asId(value));
  if (spec.select) relatedQuery.select(spec.select);
  let related = await relatedQuery;
  const nested = Array.isArray(spec.populate) ? spec.populate : spec.populate ? [spec.populate] : [];
  for (const child of nested) related = await populateDocument(related, child);
  document[spec.path] = related;
  return document;
}

function createModel(name, definition) {
  class Model extends SqlDocument {}
  Model.modelName = name;
  Model.definition = { hidden: [], ...definition };
  Model.db = { startSession: async () => new SqlSession() };
  Model.find = (filter = {}, projection = null) => new SqlQuery(Model, 'many', filter, projection);
  Model.findOne = (filter = {}, projection = null) => new SqlQuery(Model, 'one', filter, projection);
  Model.findById = (id, projection = null) => new SqlQuery(Model, 'one', { _id: asId(id) }, projection);
  Model.findByIdAndDelete = async (id) => {
    const previous = await Model.findById(id);
    if (previous) await Model.deleteOne({ _id: asId(id) });
    return previous;
  };
  Model.countDocuments = async (filter = {}) => {
    const where = buildWhere(filter, Model.definition);
    const [rows] = await execute(connectionFor(),
      `SELECT COUNT(*) AS count FROM \`${Model.definition.table}\`${where.sql ? ` WHERE ${where.sql}` : ''}`,
      where.params,
    );
    return Number(rows[0].count);
  };
  Model.exists = async (filter = {}) => (await Model.findOne(filter)) ? { _id: 'present' } : null;
  Model.create = async (input, options = {}) => {
    if (Array.isArray(input)) return Promise.all(input.map((values) => Model.insert(values, options)));
    return Model.insert(input, options);
  };
  Model.insert = async (values, options = {}) => {
    const document = values instanceof Model ? values : new Model(values);
    await Model.persist(document, options);
    document.isNew = false;
    return document;
  };
  Model.persist = async (document, options = {}) => {
    const columns = Object.keys(document)
      .filter((field) => field !== 'isNew' && !field.includes('.'))
      .map((field) => [field, columnName(field, Model.definition), document[field]])
      .filter(([, , value]) => value !== undefined);
    const idField = ModelId(Model.definition);
    const idColumn = Model.definition.idColumn || 'id';
    if (!document[idField] && idColumn === 'id') document[idField] = randomBytes(12).toString('hex');
    const id = document[idField];
    const existing = id ? await Model.findById(id).session(options.session) : null;
    const connection = connectionFor(options.session);
    if (existing) {
      const mutable = columns.filter(([, column]) => column !== idColumn);
      if (!mutable.length) return document;
      const set = mutable.map(([, column]) => `\`${column}\` = ?`).join(', ');
      const params = mutable.map(([, column, value]) => toDatabaseValue(value, column, Model.definition));
      params.push(asId(id));
      await execute(connection,
        `UPDATE \`${Model.definition.table}\` SET ${set} WHERE \`${idColumn}\` = ?`,
        params,
      );
      await refreshDocument(Model, document, id, options);
    } else {
      const insertColumns = columns.filter(([field]) => field !== idField);
      const all = id ? [[idField, idColumn, id], ...insertColumns] : insertColumns;
      await execute(connection,
        `INSERT INTO \`${Model.definition.table}\` (${all.map(([, column]) => `\`${column}\``).join(', ')}) VALUES (${all.map(() => '?').join(', ')})`,
        all.map(([, column, value]) => toDatabaseValue(value, column, Model.definition)),
      );
      await refreshDocument(Model, document, id, options);
    }
    return document;
  };
  Model.updateOne = async (filter, update, options = {}) => updateModel(Model, filter, update, options, false);
  Model.findOneAndUpdate = (filter, update, options = {}) => new SqlMutationQuery(Model, filter, update, options);
  Model.deleteOne = async (filter) => deleteModels(Model, filter, false);
  Model.deleteMany = async (filter) => deleteModels(Model, filter, true);
  Model.aggregate = async () => {
    throw new Error(`${name}.aggregate is not supported by the MySQL data layer; use an explicit SQL report query`);
  };
  Model.createIndexes = async () => {};
  Model.prototype.deleteOne = async function deleteOne() {
    return Model.deleteOne({ _id: this[ModelId(Model.definition)] });
  };
  Model.required = definition.required || [];
  return Model;
}

async function updateModel(Model, filter, update, options, returnDocument) {
  const before = await Model.findOne(filter).session(options.session);
  const definition = Model.definition;
  const where = buildWhere(filter, definition);
  const setValues = update.$set || (Object.keys(update).some((key) => key.startsWith('$')) ? {} : update);
  const increments = update.$inc || {};
  const unsets = update.$unset || {};
  const assignments = [];
  const parameters = [];

  for (const [field, value] of Object.entries(setValues)) {
    const column = columnName(field, definition);
    assignments.push(`\`${column}\` = ?`);
    parameters.push(toDatabaseValue(value, column, definition));
  }
  for (const [field, value] of Object.entries(increments)) {
    const column = columnName(field, definition);
    assignments.push(`\`${column}\` = \`${column}\` + ?`);
    parameters.push(Number(value));
  }
  for (const field of Object.keys(unsets)) {
    const column = columnName(field, definition);
    assignments.push(`\`${column}\` = ?`);
    parameters.push(column.endsWith('_at') ? null : '');
  }

  const connection = connectionFor(options.session);
  let matchedCount = before ? 1 : 0;
  let modifiedCount = 0;
  let upsertedId = null;
  if (assignments.length || (options.upsert && update.$setOnInsert)) {
    if (options.upsert) {
      const base = Object.fromEntries(Object.entries(filter)
        .filter(([field, value]) => !field.startsWith('$') && !(value && typeof value === 'object')));
      const values = { ...base, ...(update.$setOnInsert || {}), ...setValues };
      for (const [field, value] of Object.entries(increments)) {
        values[field] = Number(values[field] || 0) + Number(value);
      }
      for (const field of Object.keys(unsets)) values[field] = field.endsWith('_at') ? null : '';
      const document = new Model(values);
      const idField = ModelId(definition);
      const idColumn = definition.idColumn || 'id';
      if (!document[idField] && idColumn === 'id') document[idField] = randomBytes(12).toString('hex');
      const columns = Object.keys(document)
        .filter((field) => field !== 'isNew' && document[field] !== undefined)
        .map((field) => [field, columnName(field, definition), document[field]]);
      const duplicateParams = [];
      const duplicateAssignments = [
        ...Object.keys(setValues).map((field) => {
          const column = columnName(field, definition);
          duplicateParams.push(toDatabaseValue(setValues[field], column, definition));
          return `\`${column}\` = ?`;
        }),
        ...Object.keys(increments).map((field) => {
          const column = columnName(field, definition);
          duplicateParams.push(Number(increments[field]));
          return `\`${column}\` = \`${column}\` + ?`;
        }),
        ...Object.keys(unsets).map((field) => {
          const column = columnName(field, definition);
          duplicateParams.push(column.endsWith('_at') ? null : '');
          return `\`${column}\` = ?`;
        })
      ];
      if (!duplicateAssignments.length) duplicateAssignments.push(`\`${idColumn}\` = \`${idColumn}\``);
      const insertParams = columns.map(([, column, value]) => toDatabaseValue(value, column, definition));
      const [result] = await execute(connection,
        `INSERT INTO \`${definition.table}\` (${columns.map(([, column]) => `\`${column}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${duplicateAssignments.join(', ')}`,
        [...insertParams, ...duplicateParams],
      );
      matchedCount = result.affectedRows ? 1 : 0;
      modifiedCount = result.affectedRows ? 1 : 0;
      if (result.affectedRows === 1) upsertedId = document[idField];
    } else {
      const [result] = await execute(connection,
        `UPDATE \`${definition.table}\` SET ${assignments.join(', ')}${where.sql ? ` WHERE ${where.sql}` : ''}`,
        [...parameters, ...where.params],
      );
      matchedCount = before ? 1 : Number(result.affectedRows);
      modifiedCount = Number(result.affectedRows);
    }
  }
  if (returnDocument) {
    if (!options.new && options.returnDocument !== 'after') return before;
    return Model.findOne(filter).session(options.session);
  }
  return { acknowledged: true, matchedCount, modifiedCount, upsertedId };
}

async function deleteModels(Model, filter, many) {
  const where = buildWhere(filter, Model.definition);
  const [result] = await execute(connectionFor(),
    `DELETE FROM \`${Model.definition.table}\`${where.sql ? ` WHERE ${where.sql}` : ''}${many ? '' : ' LIMIT 1'}`,
    where.params,
  );
  return { acknowledged: true, deletedCount: result.affectedRows };
}

async function averageEvaluationScore(filter = {}) {
  const where = buildWhere(filter, models.Evaluation.definition, 'e');
  const [rows] = await execute(connectionFor(),
    `SELECT AVG(ans.score) AS average FROM evaluations e
     JOIN JSON_TABLE(e.answers, '$[*]' COLUMNS (score TINYINT PATH '$.score')) ans
     ${where.sql ? `WHERE ${where.sql}` : ''}`,
    where.params,
  );
  return rows[0].average === null ? null : Number(rows[0].average);
}

async function evaluationReportRows(filter = {}) {
  const where = buildWhere(filter, models.Evaluation.definition, 'e');
  const [rows] = await execute(connectionFor(),
    `SELECT
       survey.id AS survey_id, survey.title AS survey_title, survey.created_at AS survey_created_at,
       assignment.academic_year, assignment.semester,
       lecturer.full_name AS lecturer_name, lecturer.department,
       course.title AS course_title, course.code AS course_code, classroom.name AS class_name,
       COUNT(DISTINCT e.id) AS responses,
       ans.question_id, ans.text_value AS question_text, ans.category,
       COUNT(ans.score) AS answer_count, AVG(ans.score) AS average,
       SUM(ans.score = 1) AS score_1, SUM(ans.score = 2) AS score_2,
       SUM(ans.score = 3) AS score_3, SUM(ans.score = 4) AS score_4,
       SUM(ans.score = 5) AS score_5
     FROM evaluations e
     JOIN survey_periods survey ON survey.id = e.survey_id
     JOIN teaching_assignments assignment ON assignment.id = survey.assignment_id
     JOIN lecturers lecturer ON lecturer.id = assignment.lecturer_id
     JOIN courses course ON course.id = assignment.course_id
     JOIN classes classroom ON classroom.id = assignment.class_id
     JOIN JSON_TABLE(e.answers, '$[*]' COLUMNS (
       question_id CHAR(24) PATH '$.question_id',
       text_value VARCHAR(1000) PATH '$.text',
       category VARCHAR(100) PATH '$.category',
       score TINYINT PATH '$.score'
     )) ans
     ${where.sql ? `WHERE ${where.sql}` : ''}
     GROUP BY survey.id, survey.title, survey.created_at, assignment.academic_year,
       assignment.semester, lecturer.full_name, lecturer.department, course.title,
       course.code, classroom.name, ans.question_id, ans.text_value, ans.category
     ORDER BY survey.created_at DESC, ans.category, ans.question_id`,
    where.params,
  );
  return rows;
}

class SqlSession {
  constructor() { this.connection = null; }
  async withTransaction(callback) {
    return withTransaction(async (connection) => {
      this.connection = connection;
      return transactionContext.run(connection, callback);
    });
  }
  async endSession() { this.connection = null; }
}

for (const [name, definition] of Object.entries(definitions)) {
  models[name] = createModel(name, definition);
}
models.ClassSection = models.Class;
models.User.normalize = (values) => ({
  ...values,
  ...(values.email === undefined ? {} : { email: normalizeEmail(values.email) })
});
models.User.required = ['full_name', 'email', 'password_hash', 'role'];
models.User.validateDocument = (user) => {
  if (!isRoleEmailValid(user.role, user.email)) {
    throw new Error(accountEmailError(user.role));
  }
};

module.exports = {
  ...models,
  averageEvaluationScore,
  evaluationReportRows,
  Types: { ObjectId: String, isValidObjectId: (value) => /^[a-f\d]{24}$/i.test(String(value)) },
  async close() {
    const { closePool } = require('../config/mysql');
    await closePool();
  },
};
