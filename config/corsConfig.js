require("dotenv").config();

const configuredOrigins = (process.env.VITE_API_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Capacitor sirve la aplicación dentro de un WebView con estos orígenes.
// Se permiten solo para la app nativa; la autenticación sigue dependiendo del JWT.
const nativeOrigins = (
  process.env.CAPACITOR_ORIGINS ||
  "https://localhost,capacitor://localhost,http://localhost"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...configuredOrigins, ...nativeOrigins]);

const corsConfig = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET, POST, PUT, DELETE, OPTIONS",
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "Accept",
    "Origin",
    "User-Agent",
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

module.exports = corsConfig;
