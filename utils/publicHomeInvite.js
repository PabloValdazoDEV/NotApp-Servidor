const jwt = require("jsonwebtoken");
const prisma = require("../prisma/prisma");
const { createInvitationError, getInvitationContext } = require("./invitationToken");
const { getHomeLimits } = require("./plans");

const getPublicInvitePayload = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.purpose === "public-home-invite" && decoded.home_id
      ? decoded
      : null;
  } catch {
    return null;
  }
};

const getRegistrationInvitationContext = async (inviteToken, db = prisma) => {
  if (!inviteToken) return null;
  const publicInvite = getPublicInvitePayload(inviteToken);
  if (!publicInvite) return getInvitationContext(inviteToken, db);

  const home = await db.home.findUnique({
    where: { id: publicInvite.home_id },
    select: { id: true },
  });
  if (!home) throw createInvitationError("El hogar ya no existe", 404);
  return { publicHomeId: home.id };
};

// The caller owns the transaction. Lock the home while checking its capacity
// so two invitations cannot consume the same last member slot.
const attachRegistrationInvitation = async (context, user, tx) => {
  if (!context) return null;
  if (!context.publicHomeId) {
    const userEmail = typeof user.email === "string"
      ? user.email.trim().toLowerCase()
      : "";
    if (userEmail !== context.invitedEmail) {
      throw createInvitationError("El email invitado no coincide");
    }
    await tx.invitation.update({
      where: { id: context.invitation.id },
      data: { user_id: user.id },
    });
    await tx.oneTimeToken.update({
      where: { id: context.tokenRecord.id },
      data: { used: true },
    });
    return null;
  }

  const homeId = context.publicHomeId;
  const homes = await tx.$queryRaw`SELECT "id" FROM "Home" WHERE "id" = ${homeId} FOR UPDATE`;
  if (!homes.length) throw createInvitationError("El hogar ya no existe", 404);
  const existingMember = await tx.member.findFirst({
    where: { user_id: user.id, home_id: homeId },
  });
  if (existingMember) return homeId;

  const memberCount = await tx.member.count({ where: { home_id: homeId } });
  const limits = await getHomeLimits(homeId, { tx });
  if (memberCount >= limits.maxMembers) {
    throw createInvitationError("Este hogar ya ha alcanzado el límite de miembros");
  }
  await tx.member.create({
    data: { user_id: user.id, home_id: homeId, role: "MEMBER" },
  });
  return homeId;
};

module.exports = {
  attachRegistrationInvitation,
  getPublicInvitePayload,
  getRegistrationInvitationContext,
};
