const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("node:crypto");
const { DateTime } = require("luxon");
const authMiddleware = require("../middleware/auth.middleware");
const transporter = require("../config/nodemailer");
const { renderEmail, getEmailAttachments } = require("../config/emailTemplate");
const {
  normalizeEmail,
  verifyGoogleIdToken,
} = require("../utils/googleAuth");
const { getInvitationContext } = require("../utils/invitationToken");
const {
  attachRegistrationInvitation,
  getRegistrationInvitationContext,
} = require("../utils/publicHomeInvite");
const {
  completePendingRegistration,
  createPendingRegistration,
  findUserByEmail,
  resendPendingRegistration,
  sendRegistrationCodeEmail,
  validateRegistrationData,
} = require("../utils/registration");
const {
  googleLoginRateLimiter,
  loginAccountRateLimiter,
  loginIpRateLimiter,
  passwordRecoveryAccountRateLimiter,
  passwordRecoveryIpRateLimiter,
  registrationAccountRateLimiter,
  registrationIpRateLimiter,
  resendAccountRateLimiter,
  resendIpRateLimiter,
  tokenCheckRateLimiter,
  verificationAccountRateLimiter,
  verificationIpRateLimiter,
} = require("../middleware/rateLimit");
require("dotenv").config();

const configuredRegisterPath = process.env.URL_REGISTER?.trim();
const registerPaths = ["/register", configuredRegisterPath].filter(
  (path, index, paths) => path && paths.indexOf(path) === index
);
const mailFrom = process.env.MAIL_FROM || '"NotApp" <no-reply@notapp.com>';

const createSessionToken = (user, authProvider = "password") =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      auth_provider: authProvider,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

router.post(
  registerPaths,
  registrationIpRateLimiter,
  registrationAccountRateLimiter,
  async (req, res) => {
  const { name, email, password, inviteToken = null } = req.body || {};
  const validationError = validateRegistrationData({ name, email, password });
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const emailClean = normalizeEmail(email);
  try {
    await getRegistrationInvitationContext(inviteToken);
    const existingUser = await findUserByEmail(emailClean);
    if (existingUser && existingUser.password_enabled !== false) {
      return res.status(400).json({ message: "El email ya está registrado" });
    }

    const registration = await createPendingRegistration({
      name,
      email: emailClean,
      password,
      inviteToken,
    });

    await sendRegistrationCodeEmail({
      email: emailClean,
      name,
      code: registration.code,
      expiresInMinutes: registration.expiresInMinutes,
      inviteToken,
    });

    return res.json({
      message: "Código de verificación enviado",
      email: emailClean,
      expires_in_minutes: registration.expiresInMinutes,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error(error);
    return res.status(500).json({ message: "No se pudo iniciar el registro" });
  }
  }
);

router.post("/auth/google", googleLoginRateLimiter, async (req, res) => {
  const idToken = req.body?.idToken || req.body?.credential;
  const inviteToken = req.body?.inviteToken || null;

  try {
    const googleProfile = await verifyGoogleIdToken(idToken);
    const invitationContext = await getRegistrationInvitationContext(inviteToken);

    const { user, joinedHomeId } = await prisma.$transaction(async (tx) => {
      const userByGoogle = await tx.user.findUnique({
        where: { google_sub: googleProfile.sub },
      });
      const userByEmail = await findUserByEmail(googleProfile.email, tx);

      if (userByGoogle && userByEmail && userByGoogle.id !== userByEmail.id) {
        throw createHttpError(
          "La cuenta de Google ya está vinculada a otra cuenta de NotApp",
          409
        );
      }

      let currentUser = userByGoogle || userByEmail;

      if (!currentUser) {
        const generatedPassword = randomBytes(32).toString("base64url");
        const password = await bcrypt.hash(generatedPassword, 10);

        currentUser = await tx.user.create({
          data: {
            email: googleProfile.email,
            google_sub: googleProfile.sub,
            password_enabled: false,
            name: googleProfile.name || googleProfile.email.split("@")[0],
            image: googleProfile.picture,
            password,
          },
        });
      } else if (!currentUser.google_sub) {
        currentUser = await tx.user.update({
          where: { id: currentUser.id },
          data: {
            google_sub: googleProfile.sub,
            image: currentUser.image || googleProfile.picture,
          },
        });
      }

      const joinedHomeId = await attachRegistrationInvitation(
        invitationContext,
        currentUser,
        tx
      );
      return { user: currentUser, joinedHomeId };
    });

    return res.json({
      message: "Google conectado correctamente",
      token: createSessionToken(user, "google"),
      invitationLinked: Boolean(invitationContext),
      joinedHomeId,
    });
  } catch (error) {
    if (error.code === "GOOGLE_NOT_CONFIGURED") {
      return res.status(503).json({
        message: "Google Sign-In no está configurado en el servidor",
      });
    }

    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.error("Error validando el login de Google:", error);
    return res.status(401).json({
      message: "No se pudo validar la cuenta de Google",
    });
  }
});

router.post(
  "/auth/register/verify",
  verificationIpRateLimiter,
  verificationAccountRateLimiter,
  async (req, res) => {
  const { email, code, inviteToken } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ message: "Introduce el email y el código" });
  }

  try {
    const user = await completePendingRegistration({
      email,
      code,
      inviteToken,
    });

    return res.json({
      message: "Usuario registrado correctamente",
      token: createSessionToken(user, "password"),
      joinedHomeId: user.joinedHomeId || null,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.error("Error verificando el registro:", error);
    return res.status(500).json({ message: "No se pudo verificar el registro" });
  }
  }
);

router.post(
  "/auth/register/resend",
  resendIpRateLimiter,
  resendAccountRateLimiter,
  async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Falta el email" });
  }

  try {
    const registration = await resendPendingRegistration(email);
    await sendRegistrationCodeEmail({
      email: registration.pending.email,
      name: registration.pending.name,
      code: registration.code,
      expiresInMinutes: registration.expiresInMinutes,
      inviteToken: registration.pending.invite_token,
    });

    return res.json({
      message: "Código de verificación reenviado",
      expires_in_minutes: registration.expiresInMinutes,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.error("Error reenviando el código de registro:", error);
    return res.status(500).json({ message: "No se pudo reenviar el código" });
  }
  }
);

router.post("/auth/claim-invitation", authMiddleware, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "No se proporcionó usuario" });
    }

    const invitationContext = await getInvitationContext(req.body?.inviteToken);
    if (!invitationContext) {
      throw createHttpError("Falta el enlace de invitación");
    }

    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitationContext.invitation.id },
        data: { user_id: req.user.id },
      });
      await tx.oneTimeToken.update({
        where: { id: invitationContext.tokenRecord.id },
        data: { used: true },
      });
    });

    return res.json({
      success: true,
      message: "Invitación vinculada correctamente",
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.error("Error vinculando la invitación:", error);
    return res.status(500).json({ message: "No se pudo vincular la invitación" });
  }
});

router.post(
  "/login",
  loginIpRateLimiter,
  loginAccountRateLimiter,
  async (req, res) => {
  const { email, password } = req.body;
  const emailClean = normalizeEmail(email);
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: emailClean, mode: "insensitive" } },
    });

    if (user === null) {
      return res
        .status(401)
        .json({ message: "Ese correo no esta registrado." });
    }

    if (user.password_enabled === false) {
      return res.status(401).json({
        message:
          "Esta cuenta usa Google. Inicia sesión con Google o completa el registro con código para añadir una contraseña.",
      });
    }
    const ahora = DateTime.now().setZone("Europe/Madrid");

    const haceDiezMinutos = ahora.minus({ minutes: 10 }).toJSDate();

    const erroresLogin = await prisma.errorLogin.findMany({
      where: {
        user_id: user.id,
        date_try: {
          gte: haceDiezMinutos,
        },
      },
      orderBy: { date_try: "desc" },
    });

    if (erroresLogin.length >= 3) {
      return res.status(401).json({
        message:
          "Ha superado el número máximo de intentos. Intentelo más tarde.",
      });
    }

    if (!user || !(await bcrypt.compare(password.trim(), user.password))) {
      await prisma.errorLogin.create({
        data: {
          user_id: user.id,
          date_try: DateTime.now().setZone("Europe/Madrid").toJSDate(),
        },
      });
      if (erroresLogin.length >= 2) {
        return res.status(401).json({
          message:
            "Ha superado el número máximo de intentos. Intentelo más tarde.",
        });
      }
      return res.status(401).json({
        message:
          "Credenciales invalidas, tienes " +
          (erroresLogin.length == "null" ? 2 : 2 - erroresLogin.length) +
          " intentos.",
      });
    }

    const token = createSessionToken(user, "password");
    res.json({ message: "Credenciales correctas", token });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
  }
);

router.post("/logout", authMiddleware, (req, res) => {
  res.json({
    message: "Cierre de sessión exitoso. Se ha borrado el token del cliente.",
  });
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        email: true,
        name: true,
        id: true,
        image:true,
        password_enabled: true,
        plan: true,
        premium_home_slots: true,
        premium_expires_at: true,
        invitations:true
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.json({ loggedIn: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error retrieving user" });
  }
});

router.post(
  "/forgot-password",
  passwordRecoveryIpRateLimiter,
  passwordRecoveryAccountRateLimiter,
  async (req, res) => {
  const { email } = req.body;
  const ahora = DateTime.now().setZone("Europe/Madrid");
  const en30Min = ahora.plus({ minutes: 30 });
  const formatoISO = en30Min.toISO();

  try {
    const emailClean = normalizeEmail(email);
    const user = await prisma.user.findFirst({
      where: { email: { equals: emailClean, mode: "insensitive" } },
    });
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30m",
    });

    await prisma.oneTimeToken.create({
      data: {
        token,
        purpose: "reset-password",
        user_id: user.id,
        expiresAt: formatoISO,
      },
    });

    const link = `${process.env.URL}reset-password?token=${token}`;

    const mailOptions = {
      from: mailFrom,
      to: user.email,
      subject: "Restablecer contraseña",
      html: renderEmail({
        preheader: "Restablece tu contraseña de NotApp.",
        eyebrow: "Recuperacion de cuenta",
        title: "Restablece tu contraseña",
        body: "Hemos recibido una solicitud para cambiar la contraseña de tu cuenta. Este enlace caduca en 30 minutos.",
        buttonText: "Cambiar contraseña",
        link,
      }),
      attachments: getEmailAttachments(),
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error("Error sending email: ", error);
      }
    });

    res.json({ message: "Correo de recuperación enviado" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
  }
);

router.post("/reset-password/:token", tokenCheckRateLimiter, async (req, res) => {
  const { password, passwordConfirm } = req.body;
  const { token } = req.params;

  if (!password || !passwordConfirm) {
    return res.status(400).json({
      message: "Faltan datos",
    });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{7,}$/;
  const passwordClean = password.trim();
  const passwordConfirmClean = passwordConfirm.trim();

  try {
    if (passwordClean !== passwordConfirmClean) {
      return res.status(400).json({
        message: "Las Contraseñas no son iguales",
      });
    }

    if (!passwordRegex.test(passwordClean)) {
      return res.status(400).json({
        message:
          "La contraseña debe tener al menos 7 caracteres, una mayúscula, un número y un carácter especial",
      });
    }

    const tokenValidate = await prisma.oneTimeToken.findUnique({
      where: { token },
    });

    if (!tokenValidate || tokenValidate.used || tokenValidate.expiresAt < Date.now()) {
      return res.status(400).json({ message: "Token invalido" });
    }

    await prisma.oneTimeToken.update({
      where: { id: tokenValidate.id },
      data: { used: true },
    });

    const hashedPassword = await bcrypt.hash(passwordClean, 10);

    await prisma.user.update({
      where: { id: tokenValidate.user_id },
      data: { password: hashedPassword, password_enabled: true },
    });

    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/check-token/:token", tokenCheckRateLimiter, async (req, res) => {
    const { token } = req.params;

    try {
  
      const tokenValidate = await prisma.oneTimeToken.findUnique({
        where: { token },
      });

      if (!tokenValidate) {
        return res.status(400).json({ message: "El token no existe" });
      }
  
      if (tokenValidate.used || tokenValidate.expiresAt < Date.now()) {
        return res.status(400).json({ message: "Token invalido" });
      }
  
      let decodedToken = {};
      try {
        decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      } catch (error) {
        return res.status(400).json({ message: "Token invalido" });
      }

      res.json({
        message: "Token valido",
        purpose: tokenValidate.purpose,
        email: decodedToken.email || null,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  });

module.exports = router;
