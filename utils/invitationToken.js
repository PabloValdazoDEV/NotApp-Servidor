const jwt = require("jsonwebtoken");
const prisma = require("../prisma/prisma");

const INVITATION_TOKEN_PURPOSES = new Set(["inivit-home", "invite-home"]);

const createInvitationError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getInvitationContext = async (inviteToken, db = prisma) => {
  if (!inviteToken) return null;

  let decoded;
  try {
    decoded = jwt.verify(inviteToken, process.env.JWT_SECRET);
  } catch {
    throw createInvitationError("La invitación no es válida o ha caducado");
  }

  const invitedEmail =
    typeof decoded?.email === "string" ? decoded.email.trim().toLowerCase() : "";

  if (!decoded?.id_hogar || !invitedEmail) {
    throw createInvitationError("La invitación no contiene los datos necesarios");
  }

  const tokenRecord = await db.oneTimeToken.findUnique({
    where: { token: inviteToken },
  });

  if (
    !tokenRecord ||
    tokenRecord.used ||
    tokenRecord.expiresAt <= new Date() ||
    !INVITATION_TOKEN_PURPOSES.has(tokenRecord.purpose)
  ) {
    throw createInvitationError("La invitación no es válida o ha caducado");
  }

  const invitation = await db.invitation.findFirst({
    where: {
      home_id: decoded.id_hogar,
      email: invitedEmail,
      user_id: null,
    },
  });

  if (!invitation) {
    throw createInvitationError("La invitación no existe o ya ha sido utilizada");
  }

  return { invitation, tokenRecord, invitedEmail };
};

module.exports = {
  createInvitationError,
  getInvitationContext,
};
