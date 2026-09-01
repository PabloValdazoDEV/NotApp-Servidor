const crypto = require("node:crypto");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const CLEANUP_INTERVAL = 30 * 1000;
const MAX_BUCKETS = 10_000;

const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== "false";

const getPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const hashKey = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const getClientIp = (req) =>
  req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";

const getAccountValue = (req) => {
  const value = req.body?.email || req.query?.email;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

const ipKeyGenerator = (req) => `ip:${getClientIp(req)}`;

const accountKeyGenerator = (req) => {
  const email = getAccountValue(req);
  return email ? `email:${hashKey(email)}` : ipKeyGenerator(req);
};

const userKeyGenerator = (req) =>
  req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req);

const createRateLimiter = ({
  name,
  windowMs,
  max,
  keyGenerator = ipKeyGenerator,
  message = "Demasiadas peticiones. Inténtalo de nuevo más tarde.",
}) => {
  const buckets = new Map();
  let lastCleanupAt = 0;

  const cleanup = (now) => {
    if (now - lastCleanupAt < CLEANUP_INTERVAL) return;
    lastCleanupAt = now;

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }

    while (buckets.size > MAX_BUCKETS) {
      const firstKey = buckets.keys().next().value;
      if (firstKey === undefined) break;
      buckets.delete(firstKey);
    }
  };

  return (req, res, next) => {
    if (!rateLimitEnabled) return next();

    const now = Date.now();
    cleanup(now);

    const key = `${name}:${keyGenerator(req)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, bucket);
    }

    bucket.count = Math.min(bucket.count + 1, max + 1);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - bucket.count))
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message,
        retry_after_seconds: retryAfterSeconds,
      });
    }

    return next();
  };
};

const globalApiRateLimiter = createRateLimiter({
  name: "api-ip",
  windowMs:
    getPositiveInteger(process.env.RATE_LIMIT_GLOBAL_WINDOW_MINUTES, 15) *
    MINUTE,
  max: getPositiveInteger(process.env.RATE_LIMIT_GLOBAL_MAX, 1000),
  message: "Has realizado demasiadas peticiones. Espera unos minutos.",
});

const authenticatedUserRateLimiter = createRateLimiter({
  name: "authenticated-user",
  windowMs: 15 * MINUTE,
  max: 600,
  keyGenerator: userKeyGenerator,
  message: "Has realizado demasiadas acciones. Espera unos minutos.",
});

const loginIpRateLimiter = createRateLimiter({
  name: "login-ip",
  windowMs: 15 * MINUTE,
  max: 20,
  message: "Demasiados intentos de inicio de sesión desde esta red.",
});

const loginAccountRateLimiter = createRateLimiter({
  name: "login-account",
  windowMs: 15 * MINUTE,
  max: 8,
  keyGenerator: accountKeyGenerator,
  message: "Demasiados intentos para esta cuenta. Espera unos minutos.",
});

const googleLoginRateLimiter = createRateLimiter({
  name: "google-login-ip",
  windowMs: 15 * MINUTE,
  max: 20,
  message: "Demasiados intentos con Google desde esta red.",
});

const registrationIpRateLimiter = createRateLimiter({
  name: "registration-ip",
  windowMs: HOUR,
  max: 10,
  message: "Demasiados registros desde esta red. Espera un rato.",
});

const registrationAccountRateLimiter = createRateLimiter({
  name: "registration-account",
  windowMs: HOUR,
  max: 3,
  keyGenerator: accountKeyGenerator,
  message: "Demasiados intentos de registro para este email.",
});

const verificationIpRateLimiter = createRateLimiter({
  name: "registration-verification-ip",
  windowMs: 15 * MINUTE,
  max: 12,
  message: "Demasiados códigos introducidos desde esta red.",
});

const verificationAccountRateLimiter = createRateLimiter({
  name: "registration-verification-account",
  windowMs: 15 * MINUTE,
  max: 8,
  keyGenerator: accountKeyGenerator,
  message: "Demasiados códigos introducidos para este email.",
});

const resendIpRateLimiter = createRateLimiter({
  name: "registration-resend-ip",
  windowMs: 15 * MINUTE,
  max: 3,
  message: "Has solicitado demasiados códigos. Espera unos minutos.",
});

const resendAccountRateLimiter = createRateLimiter({
  name: "registration-resend-account",
  windowMs: 15 * MINUTE,
  max: 3,
  keyGenerator: accountKeyGenerator,
  message: "Has solicitado demasiados códigos para este email.",
});

const passwordRecoveryIpRateLimiter = createRateLimiter({
  name: "password-recovery-ip",
  windowMs: 15 * MINUTE,
  max: 5,
  message: "Demasiadas solicitudes de recuperación de contraseña.",
});

const passwordRecoveryAccountRateLimiter = createRateLimiter({
  name: "password-recovery-account",
  windowMs: 15 * MINUTE,
  max: 3,
  keyGenerator: accountKeyGenerator,
  message: "Demasiadas solicitudes para este email.",
});

const tokenCheckRateLimiter = createRateLimiter({
  name: "token-check-ip",
  windowMs: 15 * MINUTE,
  max: 60,
  message: "Demasiadas comprobaciones. Espera unos minutos.",
});

const expensiveUserRateLimiter = createRateLimiter({
  name: "expensive-user",
  windowMs: 15 * MINUTE,
  max: 60,
  keyGenerator: userKeyGenerator,
  message: "Has realizado demasiadas operaciones pesadas. Espera unos minutos.",
});

const imageSearchRateLimiter = createRateLimiter({
  name: "image-search-user",
  windowMs: 15 * MINUTE,
  max: 30,
  keyGenerator: userKeyGenerator,
  message: "Has realizado demasiadas búsquedas de imágenes. Espera unos minutos.",
});

const accountDeletionRateLimiter = createRateLimiter({
  name: "account-deletion-user",
  windowMs: HOUR,
  max: 3,
  keyGenerator: userKeyGenerator,
  message: "Demasiados intentos de eliminación de cuenta. Espera una hora.",
});

const publicMenuRateLimiter = createRateLimiter({
  name: "public-menu-ip",
  windowMs: 15 * MINUTE,
  max: 120,
  message: "Demasiadas consultas al menú público. Espera unos minutos.",
});

const createSocketRateLimiter = ({
  name,
  windowMs,
  max,
  keyGenerator,
}) => {
  const buckets = new Map();
  let lastCleanupAt = 0;

  const cleanup = (now) => {
    if (now - lastCleanupAt < CLEANUP_INTERVAL) return;
    lastCleanupAt = now;

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }

    while (buckets.size > MAX_BUCKETS) {
      const firstKey = buckets.keys().next().value;
      if (firstKey === undefined) break;
      buckets.delete(firstKey);
    }
  };

  return (socket, eventName = "connection") => {
    if (!rateLimitEnabled) return { allowed: true };

    const now = Date.now();
    cleanup(now);

    const key = `${name}:${keyGenerator(socket, eventName)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, bucket);
    }

    bucket.count = Math.min(bucket.count + 1, max + 1);

    return {
      allowed: bucket.count <= max,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000)
      ),
    };
  };
};

const getSocketAddress = (socket) =>
  socket.handshake?.address || socket.conn?.remoteAddress || "unknown";

const socketConnectionRateLimiter = createSocketRateLimiter({
  name: "socket-connection-ip",
  windowMs: 15 * MINUTE,
  max: 60,
  keyGenerator: (socket) => `ip:${getSocketAddress(socket)}`,
});

const socketEventRateLimiter = createSocketRateLimiter({
  name: "socket-event-user",
  windowMs: 15 * MINUTE,
  max: 120,
  keyGenerator: (socket, eventName) => {
    const identity = socket.user?.id
      ? `user:${socket.user.id}`
      : `ip:${getSocketAddress(socket)}`;
    return `${identity}:${eventName}`;
  },
});

module.exports = {
  accountDeletionRateLimiter,
  authenticatedUserRateLimiter,
  createRateLimiter,
  expensiveUserRateLimiter,
  globalApiRateLimiter,
  googleLoginRateLimiter,
  imageSearchRateLimiter,
  loginAccountRateLimiter,
  loginIpRateLimiter,
  passwordRecoveryAccountRateLimiter,
  passwordRecoveryIpRateLimiter,
  publicMenuRateLimiter,
  registrationAccountRateLimiter,
  registrationIpRateLimiter,
  resendAccountRateLimiter,
  resendIpRateLimiter,
  socketConnectionRateLimiter,
  socketEventRateLimiter,
  tokenCheckRateLimiter,
  verificationAccountRateLimiter,
  verificationIpRateLimiter,
};
