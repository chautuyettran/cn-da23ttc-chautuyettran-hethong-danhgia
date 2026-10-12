require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { connectDatabase, closePool, getPool } = require('./config/mysql');
const { migrate } = require('./scripts/migrate-mysql');
const models = require('./models');
const authRoutes = require('./routes/auth');
const recoveryRoutes = require('./routes/recovery');
const studentProfileRoutes = require('./routes/student-profile');
const lecturerRoutes = require('./routes/lecturer');
const lecturerProfileRoutes = studentProfileRoutes.createProfileRouter('lecturer');
const apiRoutes = require('./routes/api');

const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'JWT_SECRET'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
const reportMinimum = Number(process.env.MIN_REPORT_RESPONSES || 5);
if (!Number.isInteger(reportMinimum) || reportMinimum < 1 || reportMinimum > 1000) {
  throw new Error('MIN_REPORT_RESPONSES must be an integer between 1 and 1000.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
for (const directory of ['assets', 'css', 'js', 'main']) {
  app.use(`/${directory}`, express.static(path.join(__dirname, '..', directory)));
}

app.get('/api/health', (req, res) => {
  getPool().query('SELECT 1')
    .then(() => res.status(200).json({ status: 'ok', database: 'connected' }))
    .catch(() => res.status(503).json({ status: 'unavailable', database: 'disconnected' }));
});
app.use('/api/auth', authRoutes);
app.use('/api/auth/recovery', recoveryRoutes);
app.use('/api/student/profile', studentProfileRoutes);
app.use('/api/lecturer', lecturerRoutes);
app.use('/api/lecturer/profile', lecturerProfileRoutes);
app.use('/api', apiRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status === 413) return res.status(413).json({ error: 'Dữ liệu gửi lên vượt quá giới hạn cho phép.' });
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Nội dung JSON không hợp lệ.' });
  }
  if (error.code === 11000) return res.status(409).json({ error: 'Dữ liệu bị trùng với một bản ghi hiện có.' });
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  }
  console.error('Request failed:', error.name, error.code || 'UNHANDLED');
  return res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau.' });
});

async function start() {
  await connectDatabase();
  await migrate();
  await Promise.all(Object.values(models)
    .filter((model) => typeof model.createIndexes === 'function')
    .map((model) => model.createIndexes()));
  await models.EvaluationPolicy.updateOne(
    { key: 'global' },
    { $setOnInsert: {
      key: 'global', scope: 'survey', max_submissions: 1, allow_revisions: false,
      min_report_responses: reportMinimum
    } },
    { upsert: true, runValidators: true }
  );
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`Ứng dụng đang chạy tại http://localhost:${port}`));
  const shutdown = async () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Không thể khởi động ứng dụng:', error.name);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
