const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client();

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const getAllowedGoogleClientIds = () =>
  [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_SERVER_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS || "").split(","),
  ]
    .map((clientId) => (typeof clientId === "string" ? clientId.trim() : ""))
    .filter(Boolean)
    .filter((clientId, index, clientIds) => clientIds.indexOf(clientId) === index);

const verifyGoogleIdToken = async (idToken) => {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("No se recibió el token de Google");
  }

  const audience = getAllowedGoogleClientIds();
  if (audience.length === 0) {
    const error = new Error("Google Sign-In no está configurado en el servidor");
    error.code = "GOOGLE_NOT_CONFIGURED";
    throw error;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience,
  });
  const payload = ticket.getPayload();

  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true
  ) {
    throw new Error("La cuenta de Google no tiene un email verificado");
  }

  return {
    sub: payload.sub,
    email: normalizeEmail(payload.email),
    name: payload.name?.trim() || null,
    picture: payload.picture || null,
  };
};

module.exports = {
  getAllowedGoogleClientIds,
  normalizeEmail,
  verifyGoogleIdToken,
};
