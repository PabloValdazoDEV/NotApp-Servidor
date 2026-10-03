const { createHash, randomInt, timingSafeEqual } = require("node:crypto");
const bcrypt = require("bcrypt");
const prisma = require("../prisma/prisma");
const transporter = require("../config/nodemailer");
const { renderEmail, getEmailAttachments } = require("../config/emailTemplate");
const {
  attachRegistrationInvitation,
  getRegistrationInvitationContext,
} = require("./publicHomeInvite");

const DEFAULT_CODE_EXPIRY_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{7,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mailFrom = process.env.MAIL_FROM || '"NotApp" <no-reply@notapp.com>';

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const getCodeExpiryMinutes = () => {
  const configured = Number(process.env.REGISTRATION_CODE_EXPIRES_MINUTES);
  if (!Number.isFinite(configured)) return DEFAULT_CODE_EXPIRY_MINUTES;
  return Math.min(Math.max(Math.trunc(configured), 15), 30);
};

const validateRegistrationData = ({ name, email, password } = {}) => {
  const emailClean = normalizeEmail(email);
  const nameClean = typeof name === "string" ? name.trim() : "";
  const passwordClean = typeof password === "string" ? password.trim() : "";

  if (!nameClean || !emailClean || !passwordClean) {
    return "Faltan datos";
  }

  if (!EMAIL_REGEX.test(emailClean)) {
    return "El formato del email no es válido";
  }

  if (!PASSWORD_REGEX.test(passwordClean)) {
    return "La contraseña debe tener al menos 7 caracteres, una mayúscula, un número y un carácter especial";
  }

  return null;
};

const findUserByEmail = async (email, db = prisma) =>
  db.user.findFirst({
    where: {
      email: {
        equals: normalizeEmail(email),
        mode: "insensitive",
      },
    },
  });

const hashCode = (code) =>
  createHash("sha256").update(String(code)).digest("hex");

const createVerificationCode = () =>
  String(randomInt(100000, 1000000));

const createPendingRegistration = async ({
  name,
  email,
  password,
  inviteToken = null,
}) => {
  const emailClean = normalizeEmail(email);
  const code = createVerificationCode();
  const passwordHash = await bcrypt.hash(password.trim(), 10);
  const expiresAt = new Date(
    Date.now() + getCodeExpiryMinutes() * 60 * 1000
  );

  const pending = await prisma.pendingRegistration.upsert({
    where: { email: emailClean },
    create: {
      email: emailClean,
      name: name.trim(),
      password: passwordHash,
      code_hash: hashCode(code),
      invite_token: inviteToken,
      expiresAt,
    },
    update: {
      name: name.trim(),
      password: passwordHash,
      code_hash: hashCode(code),
      invite_token: inviteToken,
      attempts: 0,
      expiresAt,
    },
  });

  return { pending, code, expiresAt, expiresInMinutes: getCodeExpiryMinutes() };
};

const resendPendingRegistration = async (email) => {
  const emailClean = normalizeEmail(email);
  const pending = await prisma.pendingRegistration.findUnique({
    where: { email: emailClean },
  });

  if (!pending) {
    const error = new Error("No hay ningún registro pendiente para ese email");
    error.status = 404;
    throw error;
  }

  const code = createVerificationCode();
  const expiresAt = new Date(
    Date.now() + getCodeExpiryMinutes() * 60 * 1000
  );
  const updatedPending = await prisma.pendingRegistration.update({
    where: { id: pending.id },
    data: {
      code_hash: hashCode(code),
      attempts: 0,
      expiresAt,
    },
  });

  return {
    pending: updatedPending,
    code,
    expiresAt,
    expiresInMinutes: getCodeExpiryMinutes(),
  };
};

const sendRegistrationCodeEmail = async ({
  email,
  name,
  code,
  expiresInMinutes,
  inviteToken,
}) => {
  const verificationParams = new URLSearchParams({
    email: normalizeEmail(email),
  });
  if (inviteToken) verificationParams.set("inviteToken", inviteToken);

  const link = `${process.env.URL}verify-registration?${verificationParams.toString()}`;
  await transporter.sendMail({
    from: mailFrom,
    to: email,
    subject: "Verifica tu email de NotApp",
    html: renderEmail({
      preheader: "Confirma tu email para terminar el registro en NotApp.",
      eyebrow: "Verificacion de cuenta",
      title: "Confirma tu email",
      body: `Hola ${name.trim()}, tu codigo de verificacion es ${code}. Caduca en ${expiresInMinutes} minutos.`,
      buttonText: "Verificar email",
      link,
    }),
    attachments: getEmailAttachments(),
  });
};

const completePendingRegistration = async ({ email, code, inviteToken }) => {
  const emailClean = normalizeEmail(email);
  const pending = await prisma.pendingRegistration.findUnique({
    where: { email: emailClean },
  });

  if (!pending) {
    const error = new Error("No hay ningún registro pendiente para ese email");
    error.status = 404;
    throw error;
  }

  if (pending.expiresAt <= new Date()) {
    const error = new Error("El código ha caducado. Solicita uno nuevo");
    error.status = 400;
    throw error;
  }

  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    const error = new Error("Has superado los intentos. Solicita un código nuevo");
    error.status = 429;
    throw error;
  }

  const receivedHash = Buffer.from(hashCode(code));
  const expectedHash = Buffer.from(pending.code_hash);
  const isValidCode =
    receivedHash.length === expectedHash.length &&
    timingSafeEqual(receivedHash, expectedHash);

  if (!isValidCode) {
    await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    const error = new Error("El código no es correcto");
    error.status = 400;
    throw error;
  }

  if (
    inviteToken &&
    pending.invite_token &&
    inviteToken !== pending.invite_token
  ) {
    const error = new Error("La invitación no coincide con el registro");
    error.status = 400;
    throw error;
  }

  const effectiveInviteToken = pending.invite_token || inviteToken;
  const invitationContext = effectiveInviteToken
    ? await getRegistrationInvitationContext(effectiveInviteToken)
    : null;

  const user = await prisma.$transaction(async (tx) => {
    const existingUser = await findUserByEmail(emailClean, tx);

    if (existingUser && existingUser.password_enabled !== false) {
      const error = new Error("El email ya está registrado");
      error.status = 409;
      throw error;
    }

    const currentUser = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            password: pending.password,
            password_enabled: true,
            name: existingUser.name || pending.name,
          },
        })
      : await tx.user.create({
          data: {
            email: emailClean,
            name: pending.name,
            password: pending.password,
            password_enabled: true,
          },
        });

    const joinedHomeId = await attachRegistrationInvitation(
      invitationContext,
      currentUser,
      tx
    );
    await tx.pendingRegistration.delete({ where: { id: pending.id } });
    return { ...currentUser, joinedHomeId };
  });

  return user;
};

module.exports = {
  DEFAULT_CODE_EXPIRY_MINUTES,
  EMAIL_REGEX,
  MAX_CODE_ATTEMPTS,
  PASSWORD_REGEX,
  completePendingRegistration,
  createPendingRegistration,
  findUserByEmail,
  getCodeExpiryMinutes,
  normalizeEmail,
  resendPendingRegistration,
  sendRegistrationCodeEmail,
  validateRegistrationData,
};
