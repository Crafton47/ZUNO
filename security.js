const crypto = require('node:crypto');

function signingSecret(env = process.env) {
  const value = env.JWT_SECRET || '';
  if (Buffer.byteLength(value) < 32 || /^(replace|your[_-]|fallback|change[_-])/i.test(value)) {
    throw new Error('Set JWT_SECRET to a unique random secret of at least 32 bytes before starting ZUNO.');
  }
  return value;
}

// Single-process limits. Do not trust forwarded IP headers without a configured proxy.
// Bound the map as well as the requests; fail closed if a fresh key cannot be stored.
function rateLimit({ limit, windowMs, maxKeys = 10000, key = req => req.ip, now = Date.now }) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
    const id = key(req);
    let bucket = buckets.get(id);
    if (!bucket && buckets.size < maxKeys) {
      bucket = { count: 0, until: time + windowMs };
      buckets.set(id, bucket);
    }
    if (!bucket || ++bucket.count > limit) {
      res.set('Retry-After', String(Math.ceil(((bucket?.until || time + windowMs) - time) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
    }
    next();
  };
}

function accountKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return crypto.createHash('sha256').update(email).digest('hex');
}

module.exports = { signingSecret, rateLimit, accountKey };
