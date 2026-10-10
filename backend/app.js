require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { connectDatabase } = require('./config/db');
const models = require('./models');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const required = ['MONGODB_URI', 'JWT_SECRET'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
const reportMinimum = Number(process.env.MIN_REPORT_RESPONSES || 5);
if (!Number.isInteger(reportMinimum) || reportMinimum < 1 || reportMinimum > 1000) {
  throw new Error('MIN_REPORT_RESPONSES must be an integer between 1 and 1000.');
}

const app = express();
app.disable('x-powered-by');
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
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', database: ready ? 'connected' : 'disconnected' });
});
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử. Vui lòng thử lại sau.' }
}), authRoutes);
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
  await Promise.all(Object.values(models).map((model) => model.createIndexes()));
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
      await mongoose.disconnect();
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
