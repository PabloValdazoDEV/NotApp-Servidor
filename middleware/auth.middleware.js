const jwt = require("jsonwebtoken");
const { authenticatedUserRateLimiter } = require("./rateLimit");

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const apiKey = req.header("x-api-key");

    if (apiKey && apiKey === process.env.VITE_API_KEY) {
      return authenticatedUserRateLimiter(req, res, next);
    }

    if (!token) {
      return res
        .status(401)
        .json({ message: "No se proporcionó token de autenticación" });
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return authenticatedUserRateLimiter(req, res, next);
  } catch (error) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
};

module.exports = authMiddleware;
