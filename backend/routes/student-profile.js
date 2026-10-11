const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { z } = require('zod');
const models = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { studentIdFromEmail } = require('../validators/account');

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const avatarStorageDirectory = path.resolve(
  process.env.AVATAR_STORAGE_DIR || path.join(__dirname, '..', '..', 'uploads', 'avatars')
);
const phoneSchema = z.union([z.string().regex(/^\+[1-9]\d{7,14}$/), z.literal('')]);
const githubSchema = z.string().max(255).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    const username = url.pathname.replace(/^\/|\/$/g, '');
    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      !url.username &&
      !url.password &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) &&
      !username.includes('--') &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}, 'Link GitHub phải là địa chỉ hồ sơ HTTPS hợp lệ, ví dụ https://github.com/ten-cua-ban.');
const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(1, 'Vui lòng nhập họ và tên.').max(150, 'Họ và tên không được vượt quá 150 ký tự.'),
  phone_number: phoneSchema,
  github_url: z.string().trim().transform((value) => value.replace(/\/+$/, '')).pipe(githubSchema)
}).strict();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE, files: 1, fields: 0, parts: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
      error.status = 415;
      return callback(error);
    }
    return callback(null, true);
  }
});

function createProfileRouter(role = 'student') {
  const router = express.Router();
  router.use(authenticate, requireRole(role));
  if (role === 'lecturer') {
    router.use((req, res, next) => {
      if (!req.user.lecturerId) {
        return res.status(403).json({ error: 'Tài khoản giảng viên chưa được liên kết hồ sơ giảng viên.' });
      }
      return next();
    });
  }

  router.get('/', async (req, res, next) => {
    try {
      const profile = await readProfile(req.user.id, role, req.user.lecturerId);
      if (!profile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ tài khoản.' });
      return res.json({ profile });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/', async (req, res, next) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Thông tin hồ sơ không hợp lệ.' });
    }
    try {
      const student = await models.User.findOne({
        _id: req.user.id, role, is_active: true
      });
      if (!student) return res.status(404).json({ error: 'Không tìm thấy hồ sơ tài khoản.' });
      const phoneChanged = student.phone_number !== parsed.data.phone_number;
      student.full_name = parsed.data.full_name;
      student.phone_number = parsed.data.phone_number;
      student.phone_verified = phoneChanged ? false : student.phone_verified;
      student.github_url = parsed.data.github_url;
      if (role === 'lecturer') {
        const session = await models.User.db.startSession();
        try {
          await session.withTransaction(async () => {
            await student.save({ session });
            const updatedLecturer = await models.Lecturer.updateOne(
              { _id: req.user.lecturerId },
              { $set: { full_name: parsed.data.full_name } },
              { runValidators: true, session }
            );
            if (!updatedLecturer.matchedCount) {
              throw new Error('Không tìm thấy hồ sơ giảng viên được liên kết.');
            }
          });
        } finally {
          await session.endSession();
        }
      } else {
        await student.save();
      }
      const profile = await readProfile(req.user.id, role, req.user.lecturerId);
      return res.json({ profile, message: 'Đã lưu thay đổi thông tin.' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/avatar', async (req, res, next) => {
    try {
      const student = await models.User.findOne({
        _id: req.user.id, role, is_active: true
      }).select('avatar_filename').lean();
      if (!student) return res.status(404).json({ error: 'Không tìm thấy hồ sơ tài khoản.' });
      const filePath = ownedAvatarPath(student.avatar_filename, req.user.id, role);
      if (!filePath) return res.status(404).json({ error: 'Chưa có ảnh đại diện.' });
      res.set({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': 'image/webp'
      });
      return res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          if (error.code === 'ENOENT') return res.status(404).json({ error: 'Không tìm thấy ảnh đại diện.' });
          return next(error);
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/avatar', (req, res, next) => {
    upload.single('avatar')(req, res, (error) => {
      if (error) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 400;
        return res.status(status).json({
          error: status === 413
            ? 'Ảnh không được vượt quá 2 MB.'
            : error.message || 'Tệp ảnh không hợp lệ.'
        });
      }
      return saveAvatar(req, res, next, role);
    });
  });

  router.delete('/avatar', async (req, res, next) => {
    try {
      const student = await models.User.findOne({
        _id: req.user.id, role, is_active: true
      }).select('avatar_filename').lean();
      if (!student) return res.status(404).json({ error: 'Không tìm thấy hồ sơ tài khoản.' });
      const filename = student.avatar_filename || '';
      if (!filename) return res.json({ message: 'Hồ sơ hiện chưa có ảnh đại diện.' });
      const updated = await models.User.findOneAndUpdate({
        _id: req.user.id,
        role,
        is_active: true,
        avatar_filename: filename
      }, { $set: { avatar_filename: '' } }, { new: true });
      if (!updated) return res.status(409).json({ error: 'Ảnh đại diện vừa được thay đổi. Vui lòng tải lại trang.' });
      const removed = await removeOwnedAvatar(filename, req.user.id, role);
      if (removed === 'failed') {
        console.error('Student avatar cleanup failed after removal.');
      }
      return res.json({
        message: removed === 'failed'
          ? 'Đã xóa ảnh khỏi hồ sơ; tệp cũ chưa thể được dọn dẹp.'
          : 'Đã xóa ảnh đại diện.'
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

async function saveAvatar(req, res, next, role) {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn ảnh JPEG, PNG hoặc WebP.' });
  let filename;
  try {
    const output = await normalizeAvatar(req.file.buffer);
    await fs.mkdir(avatarStorageDirectory, { recursive: true });
    filename = `${role}-${req.user.id}-${crypto.randomUUID()}.webp`;
    await fs.writeFile(path.join(avatarStorageDirectory, filename), output, { flag: 'wx', mode: 0o640 });
    const student = await models.User.findOne({
      _id: req.user.id, role, is_active: true
    }).select('avatar_filename').lean();
    if (!student) {
      await cleanupNewAvatar(filename, req.user.id, role);
      return res.status(404).json({ error: 'Không tìm thấy hồ sơ sinh viên.' });
    }
    const previousFilename = student.avatar_filename || '';
    const avatarFilter = {
      _id: req.user.id,
      role,
      is_active: true
    };
    if (previousFilename) avatarFilter.avatar_filename = previousFilename;
    else avatarFilter.$or = [
      { avatar_filename: '' },
      { avatar_filename: { $exists: false } }
    ];
    const updated = await models.User.findOneAndUpdate(
      avatarFilter,
      { $set: { avatar_filename: filename } },
      { new: true }
    ).select('avatar_filename');
    if (!updated) {
      await cleanupNewAvatar(filename, req.user.id, role);
      return res.status(409).json({ error: 'Ảnh đại diện vừa được thay đổi. Vui lòng tải lại trang.' });
    }
    const removed = await removeOwnedAvatar(previousFilename, req.user.id, role);
    if (removed === 'failed') console.error('Previous student avatar cleanup failed after replacement.');
    return res.status(201).json({
      avatarUrl: `/api/${role}/profile/avatar`,
      message: 'Đã cập nhật ảnh đại diện.',
      cleanupPending: removed === 'failed'
    });
  } catch (error) {
    if (filename) await cleanupNewAvatar(filename, req.user.id, role);
    if (error.status === 415) return res.status(415).json({ error: error.message });
    return next(error);
  }
}

async function normalizeAvatar(buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'error' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      const error = new Error('Nội dung tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ.');
      error.status = 415;
      throw error;
    }
    return await image
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    if (error.status === 415) throw error;
    const invalidImage = new Error('Tệp ảnh bị lỗi hoặc không được hỗ trợ.');
    invalidImage.status = 415;
    throw invalidImage;
  }
}

async function cleanupNewAvatar(filename, studentId, role) {
  const removed = await removeOwnedAvatar(filename, studentId, role);
  if (removed === 'failed') console.error('Could not remove an uncommitted student avatar file.');
}

function ownedAvatarPath(filename, studentId, role) {
  if (typeof filename !== 'string' ||
      !new RegExp(`^${role}-${studentId}-[a-f\\d-]{36}\\.webp$`, 'i').test(filename)) {
    return null;
  }
  return path.join(avatarStorageDirectory, filename);
}

async function removeOwnedAvatar(filename, studentId, role) {
  const filePath = ownedAvatarPath(filename, studentId, role);
  if (!filePath) return 'missing';
  try {
    await fs.unlink(filePath);
    return 'deleted';
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    return 'failed';
  }
}

async function readProfile(studentId, role, lecturerId) {
  const student = await models.User.findOne({
    _id: studentId, role, is_active: true
  }).select('full_name email phone_number github_url avatar_filename').lean();
  if (!student) return null;
  const [enrollments, lecturer] = await Promise.all([
    role === 'student'
      ? models.Enrollment.find({ student_id: student._id })
        .select('class_id')
        .populate('class_id', 'name code')
        .lean()
      : Promise.resolve([]),
    role === 'lecturer' && lecturerId
      ? models.Lecturer.findById(lecturerId).select('department').lean()
      : Promise.resolve(null)
  ]);
  const classes = enrollments
    .map(({ class_id: section }) => section && ({ name: section.name, code: section.code }))
    .filter(Boolean);
  const profile = {
    fullName: student.full_name,
    classNames: classes.map((section) => section.name),
    classCodes: classes.map((section) => section.code),
    studentId: studentIdFromEmail(student.email) || '',
    email: student.email,
    phoneNumber: student.phone_number || '',
    githubUrl: student.github_url || '',
    avatarUrl: student.avatar_filename ? `/api/${role}/profile/avatar` : ''
  };
  if (role === 'lecturer') profile.department = lecturer?.department || '';
  return profile;
}

const studentProfileRouter = createProfileRouter('student');
module.exports = studentProfileRouter;
module.exports.createProfileRouter = createProfileRouter;
