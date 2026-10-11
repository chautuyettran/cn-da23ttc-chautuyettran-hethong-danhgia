const rateLimit = require('express-rate-limit');

function createRateLimiter(limit, windowMs, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(req, res) {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfter = resetTime instanceof Date && Number.isFinite(resetTime.getTime())
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      return respondRateLimited(req, res, message, retryAfter);
    }
  });
}

function respondRateLimited(req, res, message, retryAfterSeconds = 60) {
  const retryAfter = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 60));
  const endpoint = `${req.baseUrl}${req.path}`;
  console.warn('Rate limit exceeded:', req.method, endpoint, 'status=429');
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message, retryAfterSeconds: retryAfter });
}

module.exports = { createRateLimiter, respondRateLimited };
