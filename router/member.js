const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const jwt = require("jsonwebtoken");
const { DateTime } = require("luxon");
const authMiddleware = require("../middleware/auth.middleware");
const {
  registrationAccountRateLimiter,
  registrationIpRateLimiter,
} = require("../middleware/rateLimit");
const transporter = require("../config/nodemailer");
const { renderEmail, getEmailAttachments } = require("../config/emailTemplate");
const { getInvitationContext } = require("../utils/invitationToken");
const {
  createPendingRegistration,
  findUserByEmail,
  sendRegistrationCodeEmail,
  validateRegistrationData,
} = require("../utils/registration");
const { getHomeLimits } = require("../utils/plans");
const {
  attachRegistrationInvitation,
  getPublicInvitePayload,
} = require("../utils/publicHomeInvite");
require("dotenv").config();

const ADMIN_ROLES = ["OWNER", "ADMIN"];
const MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER"];
const mailFrom = process.env.MAIL_FROM || '"NotApp" <no-reply@notapp.com>';

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const isHomeAdmin = async (userId, homeId) => {
  if (!userId || !homeId) return false;
  const member = await prisma.member.findFirst({
    where: {
      user_id: userId,
      home_id: homeId,
      role: {
        in: ADMIN_ROLES,
      },
    },
  });

  return Boolean(member);
};

router.post(
  "/register-special",
  registrationIpRateLimiter,
  registrationAccountRateLimiter,
  async (req, res) => {
  const { name, email, password, token } = req.body || {};
  const validationError = validateRegistrationData({ name, email, password });
  if (validationError || !token) {
    return res.status(400).json({ message: validationError || "Faltan datos" });
  }

  const emailClean = normalizeEmail(email);
  try {
    const invitationContext = await getInvitationContext(token);
    if (invitationContext.invitedEmail !== emailClean) {
      return res.status(400).json({ message: "El email invitado no coincide" });
    }

    const existingUser = await findUserByEmail(emailClean);
    if (existingUser && existingUser.password_enabled !== false) {
      return res.status(400).json({ message: "El email ya está registrado" });
    }

    const registration = await createPendingRegistration({
      name,
      email: emailClean,
      password,
      inviteToken: token,
    });

    await sendRegistrationCodeEmail({
      email: emailClean,
      name,
      code: registration.code,
      expiresInMinutes: registration.expiresInMinutes,
      inviteToken: token,
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

router.get("/public-invite/:token", async (req, res) => {
  const decoded = getPublicInvitePayload(req.params.token);

  if (!decoded) {
    return res.status(400).json({
      success: false,
      message: "El enlace de invitación no es válido o ha caducado",
    });
  }

  try {
    const home = await prisma.home.findUnique({
      where: { id: decoded.home_id },
      select: { id: true, name: true, members: { select: { id: true } } },
    });

    if (!home) {
      return res.status(404).json({
        success: false,
        message: "El hogar ya no existe",
      });
    }

    const limits = await getHomeLimits(home.id);

    return res.json({
      success: true,
      home: {
        id: home.id,
        name: home.name,
        isFull: home.members.length >= limits.maxMembers,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/public-invite/create/:homeId",
  authMiddleware,
  async (req, res) => {
    const { homeId } = req.params;

    if (!(await isHomeAdmin(req.user?.id, homeId))) {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para invitar a este hogar",
      });
    }

    try {
      const home = await prisma.home.findUnique({
        where: { id: homeId },
        select: { id: true, name: true },
      });

      if (!home) {
        return res.status(404).json({
          success: false,
          message: "El hogar no existe",
        });
      }

      const token = jwt.sign(
        { home_id: home.id, purpose: "public-home-invite" },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        success: true,
        token,
        home,
        expiresInDays: 30,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

router.post("/public-invite/:token/join", authMiddleware, async (req, res) => {
  const decoded = getPublicInvitePayload(req.params.token);

  if (!decoded) {
    return res.status(400).json({
      success: false,
      message: "El enlace de invitación no es válido o ha caducado",
    });
  }

  try {
    const home = await prisma.home.findUnique({
      where: { id: decoded.home_id },
      select: { id: true, name: true },
    });

    if (!home) {
      return res.status(404).json({ success: false, message: "El hogar no existe" });
    }

    const alreadyMember = await prisma.$transaction(async (tx) => {
      // Use the same capacity lock as registration and Google sign-in.
      const currentMember = await tx.member.findFirst({
        where: { user_id: req.user.id, home_id: home.id },
      });
      await attachRegistrationInvitation(
        { publicHomeId: home.id },
        { id: req.user.id },
        tx
      );
      return Boolean(currentMember);
    });
    if (alreadyMember) {
      return res.json({
        success: true,
        alreadyMember: true,
        message: `Ya perteneces a ${home.name}`,
      });
    }

    return res.json({
      success: true,
      message: `Te has unido a ${home.name}`,
      home_id: home.id,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/invite-check", authMiddleware, async (req, res) => {
  const { id_invitation, accept } = req.body;
  try {
    if (!id_invitation || accept === null) {
      return res.status(400).json({
        message: "Faltan datos",
      });
    }

    const invitation = await prisma.invitation.findUnique({
      where: {
        id: id_invitation,
      },
      include: {
        user: true,
        home: true,
      },
    });

    if (!invitation) {
      return res.status(400).json({
        message: "Invitacion no encontrada.",
      });
    }

    if (!req.user?.id) {
      return res.status(401).json({ message: "No se proporcionó usuario" });
    }

    if (invitation.user_id && invitation.user_id !== req.user.id) {
      return res.status(403).json({
        message: "No tienes permisos para responder esta invitación.",
      });
    }

    if (!invitation.user_id) {
      const invitedEmail = normalizeEmail(invitation.email);
      const currentEmail = normalizeEmail(req.user?.email);

      if (!currentEmail || invitedEmail !== currentEmail) {
        return res.status(403).json({
          message: "No tienes permisos para responder esta invitación.",
        });
      }
    }

    if (accept) {
      const memberCount = await prisma.member.count({
        where: { home_id: invitation.home_id },
      });

      const limits = await getHomeLimits(invitation.home_id);

      if (memberCount >= limits.maxMembers) {
        return res.status(400).json({
          success: false,
          message: `Un hogar ${limits.plan === "FREE" ? "Free" : "Premium"} puede tener como máximo ${limits.maxMembers} miembros`,
        });
      }

      await prisma.member.create({
        data: {
          user_id: invitation.user_id || req.user.id,
          home_id: invitation.home_id,
          role: "MEMBER",
        },
      });
    }

    await prisma.invitation.delete({
      where: {
        id: id_invitation,
      },
    });

    const invitedName =
      invitation.user?.name ||
      req.user?.name ||
      invitation.email ||
      "El usuario";

    res.json({
      message: `${invitedName} se ha unido a ${invitation.home.name}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/invite/pending/:homeId", authMiddleware, async (req, res) => {
  const { homeId } = req.params;

  try {
    if (!homeId) {
      return res.status(400).json({ message: "Faltan datos." });
    }

    if (!(await isHomeAdmin(req.user?.id, homeId))) {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para consultar invitaciones.",
      });
    }

    const pendingInvitations = await prisma.invitation.findMany({
      where: {
        home_id: homeId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return res.json({
      success: true,
      pendingInvitations: pendingInvitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email || invitation.user?.email,
        home_id: invitation.home_id,
        createdAt: invitation.createdAt,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/invite/:invitationId", authMiddleware, async (req, res) => {
  const { invitationId } = req.params;

  try {
    if (!invitationId) {
      return res.status(400).json({ message: "Faltan datos." });
    }

    const invitation = await prisma.invitation.findUnique({
      where: {
        id: invitationId,
      },
      select: {
        id: true,
        home_id: true,
      },
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitación no encontrada.",
      });
    }

    if (!(await isHomeAdmin(req.user?.id, invitation.home_id))) {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para cancelar esta invitación.",
      });
    }

    await prisma.invitation.delete({
      where: {
        id: invitation.id,
      },
    });

    return res.json({ success: true, message: "Invitación cancelada" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/invite/:id_hogar", authMiddleware, async (req, res) => {
  const { email } = req.body;
  const { id_hogar } = req.params;
  const emailClean = normalizeEmail(email);
  const ahora = DateTime.now().setZone("Europe/Madrid");
  const en7dias = ahora.plus({ day: 7 });
  const formatoISO = en7dias.toISO();
  try {
    if (!emailClean || !id_hogar) {
      return res.status(400).json({
        message: "Faltan datos.",
      });
    }

    const home = await prisma.home.findUnique({
      where: {
        id: id_hogar,
      },
      include: {
        invitations: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    if (!home) {
      return res.status(400).json({
        message: "Hogar no encontrado.",
      });
    }

    if (home.is_tutorial) {
      return res.status(400).json({
        success: false,
        message: "No se pueden enviar invitaciones desde un hogar tutorial.",
      });
    }

    const requester = home.members.find(
      (member) =>
        member.user_id === req.user?.id && ADMIN_ROLES.includes(member.role)
    );

    if (!requester) {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para invitar a este hogar.",
      });
    }

    const emailMember = home.members.filter(
      (user) => normalizeEmail(user.user.email) === emailClean
    );

    if (emailMember.length !== 0) {
      return res.status(400).json({
        message: "Este usuario ya esta dentro del hogar.",
      });
    }
    const emailInvitation = home.invitations.filter(
      (invitation) =>
        normalizeEmail(invitation.email || invitation.user?.email) ===
        emailClean
    );

    if (emailInvitation.length !== 0) {
      return res.status(400).json({
        message: "Este usuario ya tiene una invitación pendiente",
      });
    }

    const limits = await getHomeLimits(id_hogar);
    if (home.members.length + home.invitations.length >= limits.maxMembers) {
      return res.status(400).json({
        success: false,
        message: `Un hogar ${limits.plan === "FREE" ? "Free" : "Premium"} puede tener como máximo ${limits.maxMembers} miembros`,
      });
    }

    const user = await prisma.user.findUnique({ where: { email: emailClean } });

    if (user === null) {
      const token = jwt.sign(
        { id_hogar: id_hogar, email: emailClean },
        process.env.JWT_SECRET,
        {
          expiresIn: "1d",
        }
      );

      await prisma.oneTimeToken.create({
        data: {
          token,
          purpose: "inivit-home",
          expiresAt: formatoISO,
        },
      });

      await prisma.invitation.create({
        data: {
          email: emailClean,
          home_id: id_hogar,
        },
      });

      const link = `${process.env.URL}register-special?token=${token}`;

      const mailOptions = {
        from: mailFrom,
        to: emailClean,
        subject: `Initación al hogar ${home.name}`,
        html: renderEmail({
          preheader: `Te han invitado a unirte al hogar ${home.name} en NotApp.`,
          eyebrow: "Invitacion a NotApp",
          title: "Te han invitado a un hogar",
          body: `Acepta la invitacion para unirte a ${home.name} y empezar a compartir listas, productos y compras con tu hogar.`,
          buttonText: "Aceptar invitacion",
          link,
        }),
        attachments: getEmailAttachments(),
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) {
          console.error("Error sending email: ", error);
        }
      });

      return res.json({ message: "Email de invitación enviado." });
    }
    await prisma.invitation.create({
      data: {
        user_id: user.id,
        email: user.email,
        home_id: id_hogar,
      },
    });

    res.json({ message: `Invitación enviada a ${user.name}` });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/delete/:id_member", authMiddleware, async (req, res) => {
  const { id_member } = req.params;
  try {
    if (!id_member) {
      return res.status(400).json({
        message: "Faltan datos",
      });
    }

    const miembro = await prisma.member.findUnique({
      where: {
        id: id_member,
      },
    });

    if (!miembro) {
      return res.status(400).json({
        message: "Miembro no encontrada.",
      });
    }

    if (!(await isHomeAdmin(req.user?.id, miembro.home_id))) {
      return res.status(403).json({
        message: "No tienes permisos para eliminar miembros de este hogar.",
      });
    }

    await prisma.member.delete({
      where: {
        id: id_member,
      },
    });

    res.json({
      message: "El miembro se ha eliminado correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/edit/:id_member", authMiddleware, async (req, res) => {
  const { id_member } = req.params;
  const { role } = req.body;
  try {
    if (!id_member || !role || !MEMBER_ROLES.includes(role)) {
      return res.status(400).json({
        message: "Faltan datos",
      });
    }

    const miembro = await prisma.member.findUnique({
      where: {
        id: id_member,
      },
    });

    if (!miembro) {
      return res.status(400).json({
        message: "Miembro no encontrada.",
      });
    }

    if (!(await isHomeAdmin(req.user?.id, miembro.home_id))) {
      return res.status(403).json({
        message: "No tienes permisos para editar miembros de este hogar.",
      });
    }

    await prisma.member.update({
      where: {
        id: id_member,
      },
      data: {
        role,
      },
    });

    res.json({
      message: "El miembro se ha editado correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
