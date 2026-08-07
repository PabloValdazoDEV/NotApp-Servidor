const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { uploadImage } = require("../config/cloudinaryUpload");
const transporter = require("../config/nodemailer");
const { renderEmail, getEmailAttachments } = require("../config/emailTemplate");
const {
  DEFAULT_PREMIUM_HOME_SLOTS,
  getEffectiveUserPlan,
  getPremiumHomeSlots,
  USER_PLAN,
} = require("../utils/plans");
require("dotenv").config();

const PREMIUM_HOME_LOCK_DAYS = 30;
const ACCOUNT_DELETE_CONFIRMATION = "ELIMINAR";
const mailFrom = process.env.MAIL_FROM || '"NotApp" <no-reply@notapp.com>';

const addDays = (date, days) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const isFutureDate = (value, now = new Date()) =>
  value && new Date(value).getTime() > now.getTime();

const isActivePremiumAssignment = (value, now = new Date()) =>
  !value || new Date(value).getTime() > now.getTime();

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const addCloudinaryId = (set, publicId) => {
  if (publicId) set.add(publicId);
};

const compareMembersByAge = (a, b) => {
  const aCreatedAt = new Date(a.user?.createdAt || 0).getTime();
  const bCreatedAt = new Date(b.user?.createdAt || 0).getTime();

  if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
  return String(a.id).localeCompare(String(b.id));
};

const pickNextOwner = (members) => {
  const admins = members
    .filter((member) => member.role === "ADMIN")
    .sort(compareMembersByAge);

  if (admins.length > 0) return admins[0];

  return [...members].sort(compareMembersByAge)[0] || null;
};

const sendAccountDeletedEmail = async ({ email, name }) => {
  if (!email) return null;

  const link = process.env.URL || "https://notapp.com";
  const mailOptions = {
    from: mailFrom,
    to: email,
    subject: "Cuenta eliminada de NotApp",
    html: renderEmail({
      preheader: "Tu cuenta de NotApp se ha eliminado correctamente.",
      eyebrow: "Cuenta eliminada",
      title: "Tu cuenta se ha eliminado",
      body: `Hola${name ? ` ${name}` : ""}, confirmamos que tu cuenta de NotApp se ha eliminado correctamente. Gracias por haber usado NotApp.`,
      buttonText: "Volver a NotApp",
      link,
    }),
    attachments: getEmailAttachments(),
  };

  return transporter.sendMail(mailOptions);
};

const buildPremiumHomeSelection = async (userId, tx = prisma) => {
  const now = new Date();
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      plan: true,
      premium_home_slots: true,
      premium_expires_at: true,
    },
  });

  if (!user) return null;

  const effectivePlan = getEffectiveUserPlan(user, now);
  const canOverridePremiumRelease = effectivePlan === USER_PLAN.APP_OWNER;
  const rawSlots = getPremiumHomeSlots(user);
  const premiumHomeSlots =
    rawSlots === Number.POSITIVE_INFINITY ? 20 : rawSlots;
  const selectableRoles = ["OWNER", "ADMIN"];
  const homes = await tx.home.findMany({
    where: {
      is_tutorial: false,
      members: {
        some: {
          user_id: userId,
          role: {
            in: selectableRoles,
          },
        },
      },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      image: true,
      premium_assigned_by_user_id: true,
      premium_assigned_at: true,
      premium_locked_until: true,
      premium_ends_at: true,
      premiumAssignedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          plan: true,
          premium_expires_at: true,
        },
      },
      items: {
        where: {
          AND: [{ image: { not: null } }, { image: { not: "" } }],
        },
        select: { id: true },
      },
      _count: {
        select: {
          members: true,
        },
      },
      members: {
        where: { user_id: userId },
        select: { role: true },
        take: 1,
      },
    },
  });

  const assignedByUserHomes = homes
    .filter(
      (home) =>
        home.premium_assigned_by_user_id === userId &&
        isActivePremiumAssignment(home.premium_ends_at, now)
    )
    .sort((a, b) => {
      const aTime = new Date(a.premium_assigned_at || 0).getTime();
      const bTime = new Date(b.premium_assigned_at || 0).getTime();
      return aTime - bTime;
    });
  const activeAssignedHomeIds = new Set(
    assignedByUserHomes.slice(0, premiumHomeSlots).map((home) => home.id)
  );
  const assignedPremiumHomesCount = activeAssignedHomeIds.size;

  return {
    plan: user.plan,
    effective_plan: effectivePlan,
    premium_home_slots:
      effectivePlan === USER_PLAN.APP_OWNER ? 20 : premiumHomeSlots,
    default_premium_home_slots: DEFAULT_PREMIUM_HOME_SLOTS,
    assigned_premium_homes_count: assignedPremiumHomesCount,
    available_premium_home_slots: Math.max(
      (effectivePlan === USER_PLAN.APP_OWNER ? 20 : premiumHomeSlots) -
        assignedPremiumHomesCount,
      0
    ),
    premium_expires_at: user.premium_expires_at,
    lock_days: PREMIUM_HOME_LOCK_DAYS,
    homes: homes.map((home) => {
      const assignedByCurrentUser = home.premium_assigned_by_user_id === userId;
      const assignedByUserPlan = getEffectiveUserPlan(home.premiumAssignedBy, now);
      const hasActivePremium =
        activeAssignedHomeIds.has(home.id) ||
        (Boolean(home.premium_assigned_by_user_id) &&
          isActivePremiumAssignment(home.premium_ends_at, now) &&
          [USER_PLAN.PREMIUM, USER_PLAN.APP_OWNER].includes(assignedByUserPlan));
      const lockedUntil = home.premium_locked_until;
      const locked = assignedByCurrentUser && isFutureDate(lockedUntil, now);
      const assignedByOtherUser =
        Boolean(home.premium_assigned_by_user_id) && !assignedByCurrentUser;
      const canReleasePremium =
        hasActivePremium &&
        (canOverridePremiumRelease || (assignedByCurrentUser && !locked));

      return {
        id: home.id,
        name: home.name,
        image: home.image,
        role: home.members[0]?.role || null,
        members_count: home._count.members,
        product_image_count: home.items.length,
        has_premium: hasActivePremium,
        premium_assigned_by_current_user: assignedByCurrentUser,
        premium_assigned_by_other_user: assignedByOtherUser,
        premium_can_release: canReleasePremium,
        premium_assigned_by_name:
          home.premiumAssignedBy?.name || home.premiumAssignedBy?.email || null,
        premium_assigned_at: home.premium_assigned_at,
        premium_locked_until: lockedUntil,
        premium_locked: locked,
        premium_ends_at: home.premium_ends_at,
      };
    }),
  };
};

router.get("/:id_user", authMiddleware, async (req, res) => {
  const { id_user } = req.params;
  try {
    if (!id_user) {
      return res.status(400).json({
        message: "Faltan datos",
      });
    }
    if (req.user?.id !== id_user) {
      return res.status(403).json({
        message: "No tienes permisos para consultar este perfil",
      });
    }
    const user = await prisma.user.findUnique({
      where: {
        id: id_user,
      },
      select: {
        name: true,
        email: true,
        image: true,
        plan: true,
        premium_home_slots: true,
        premium_expires_at: true,
        invitations: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });
    if (user === null) {
      return res.status(400).json({
        message: "Usuario no encontrada.",
      });
    }

    const premiumHomes = await buildPremiumHomeSelection(id_user);

    res.json({
      message: "Datos enviados",
      user: user,
      premium_homes: premiumHomes,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id_user/premium-homes/:home_id", authMiddleware, async (req, res) => {
  const { id_user, home_id } = req.params;
  const authenticatedUserId = req.user?.id;
  const now = new Date();

  try {
    if (!id_user || !home_id || !authenticatedUserId) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    if (authenticatedUserId !== id_user) {
      return res.status(403).json({
        message: "No tienes permisos para gestionar este plan",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: id_user },
        select: {
          id: true,
          plan: true,
          premium_home_slots: true,
          premium_expires_at: true,
        },
      });

      const effectivePlan = getEffectiveUserPlan(user, now);
      if (![USER_PLAN.PREMIUM, USER_PLAN.APP_OWNER].includes(effectivePlan)) {
        return {
          status: 403,
          body: {
            success: false,
            message: "Tu usuario no tiene plan premium activo",
          },
        };
      }

      const home = await tx.home.findFirst({
        where: {
          id: home_id,
          members: {
            some: {
              user_id: id_user,
              role: {
                in: ["OWNER", "ADMIN"],
              },
            },
          },
        },
        select: {
          id: true,
          is_tutorial: true,
          premium_assigned_by_user_id: true,
          premium_locked_until: true,
          premium_ends_at: true,
        },
      });

      if (!home) {
        return {
          status: 403,
          body: {
            success: false,
            message:
              "Solo puedes asignar premium a hogares donde eres owner o admin",
          },
        };
      }

      if (home.is_tutorial) {
        return {
          status: 403,
          body: {
            success: false,
            message: "El hogar Tutorial no puede recibir premium",
          },
        };
      }

      const alreadyAssignedByCurrentUser =
        home.premium_assigned_by_user_id === id_user &&
        isActivePremiumAssignment(home.premium_ends_at, now);

      if (alreadyAssignedByCurrentUser) {
        return {
          status: 200,
          body: {
            success: true,
            message: "Este hogar ya tenía premium asignado",
            premium_homes: await buildPremiumHomeSelection(id_user, tx),
          },
        };
      }

      if (
        home.premium_assigned_by_user_id &&
        home.premium_assigned_by_user_id !== id_user &&
        isActivePremiumAssignment(home.premium_ends_at, now)
      ) {
        return {
          status: 409,
          body: {
            success: false,
            message: "Este hogar ya tiene premium asignado por otra persona",
          },
        };
      }

      const premiumHomeSlots =
        effectivePlan === USER_PLAN.APP_OWNER ? 20 : getPremiumHomeSlots(user);
      const assignedHomesCount = await tx.home.count({
        where: {
          is_tutorial: false,
          premium_assigned_by_user_id: id_user,
          OR: [{ premium_ends_at: null }, { premium_ends_at: { gt: now } }],
        },
      });

      if (assignedHomesCount >= premiumHomeSlots) {
        return {
          status: 403,
          body: {
            success: false,
            message: `Ya has usado tus ${premiumHomeSlots} hogares premium`,
          },
        };
      }

      await tx.home.update({
        where: { id: home_id },
        data: {
          premium_assigned_by_user_id: id_user,
          premium_assigned_at: now,
          premium_locked_until: addDays(now, PREMIUM_HOME_LOCK_DAYS),
          premium_ends_at:
            effectivePlan === USER_PLAN.PREMIUM ? user.premium_expires_at : null,
        },
      });

      return {
        status: 200,
        body: {
          success: true,
          message: "Hogar premium asignado correctamente",
          premium_homes: await buildPremiumHomeSelection(id_user, tx),
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id_user/premium-homes/:home_id", authMiddleware, async (req, res) => {
  const { id_user, home_id } = req.params;
  const authenticatedUserId = req.user?.id;
  const now = new Date();

  try {
    if (!id_user || !home_id || !authenticatedUserId) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    if (authenticatedUserId !== id_user) {
      return res.status(403).json({
        message: "No tienes permisos para gestionar este plan",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: id_user },
        select: {
          id: true,
          plan: true,
          premium_home_slots: true,
          premium_expires_at: true,
        },
      });
      const effectivePlan = getEffectiveUserPlan(user, now);
      const canOverridePremiumRelease = effectivePlan === USER_PLAN.APP_OWNER;
      const home = await tx.home.findFirst({
        where: {
          id: home_id,
          is_tutorial: false,
          premium_assigned_by_user_id: canOverridePremiumRelease
            ? { not: null }
            : id_user,
          ...(canOverridePremiumRelease
            ? {
                members: {
                  some: {
                    user_id: id_user,
                    role: {
                      in: ["OWNER", "ADMIN"],
                    },
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          premium_locked_until: true,
        },
      });

      if (!home) {
        return {
          status: 404,
          body: {
            success: false,
            message: canOverridePremiumRelease
              ? "No puedes quitar premium de este hogar"
              : "Este hogar no tiene premium asignado por ti",
          },
        };
      }

      if (!canOverridePremiumRelease && isFutureDate(home.premium_locked_until, now)) {
        return {
          status: 403,
          body: {
            success: false,
            message:
              "Este hogar todavía está bloqueado. Podrás quitar el premium cuando termine el periodo de 30 días.",
            premium_locked_until: home.premium_locked_until,
          },
        };
      }

      await tx.home.update({
        where: { id: home_id },
        data: {
          premium_assigned_by_user_id: null,
          premium_assigned_at: null,
          premium_locked_until: null,
          premium_ends_at: null,
        },
      });

      return {
        status: 200,
        body: {
          success: true,
          message: "Hogar premium liberado correctamente",
          premium_homes: await buildPremiumHomeSelection(id_user, tx),
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id_user/account", authMiddleware, async (req, res) => {
  const { id_user } = req.params;
  const authenticatedUserId = req.user?.id;
  const { password, confirmation } = req.body || {};

  try {
    if (!id_user || !authenticatedUserId || !password || !confirmation) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    if (authenticatedUserId !== id_user) {
      return res.status(403).json({
        message: "No tienes permisos para eliminar esta cuenta",
      });
    }

    if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
      return res.status(400).json({
        message: `Escribe ${ACCOUNT_DELETE_CONFIRMATION} para confirmar`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: id_user },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        image: true,
        members: {
          select: {
            id: true,
            role: true,
            home_id: true,
            home: {
              select: {
                id: true,
                name: true,
                image: true,
                items: {
                  select: {
                    image: true,
                  },
                },
                members: {
                  select: {
                    id: true,
                    user_id: true,
                    role: true,
                    user: {
                      select: {
                        createdAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "La contraseña no es correcta" });
    }

    const emailToNotify = user.email;
    const nameToNotify = user.name;
    const emailClean = normalizeEmail(user.email);
    const cloudinaryPublicIds = new Set();
    const homesToDeleteIds = new Set();
    const ownerTransfers = [];
    const visitedHomes = new Set();

    addCloudinaryId(cloudinaryPublicIds, user.image);

    user.members.forEach((member) => {
      const home = member.home;
      if (!home || visitedHomes.has(home.id)) return;

      visitedHomes.add(home.id);

      const otherMembers = home.members.filter(
        (homeMember) => homeMember.user_id !== id_user
      );

      if (otherMembers.length === 0) {
        homesToDeleteIds.add(home.id);
        addCloudinaryId(cloudinaryPublicIds, home.image);
        home.items.forEach((item) => {
          addCloudinaryId(cloudinaryPublicIds, item.image);
        });
        return;
      }

      const hasOtherOwner = otherMembers.some(
        (homeMember) => homeMember.role === "OWNER"
      );

      if (member.role === "OWNER" && !hasOtherOwner) {
        const nextOwner = pickNextOwner(otherMembers);
        if (nextOwner) {
          ownerTransfers.push({
            homeId: home.id,
            memberId: nextOwner.id,
          });
        }
      }
    });

    const invitationTokens = await prisma.oneTimeToken.findMany({
      where: {
        used: false,
        purpose: {
          in: ["inivit-home", "invite-home"],
        },
      },
      select: {
        id: true,
        token: true,
      },
    });
    const invitationTokenIdsToDelete = invitationTokens
      .filter((oneTimeToken) => {
        try {
          const decoded = jwt.verify(oneTimeToken.token, process.env.JWT_SECRET);
          return normalizeEmail(decoded.email) === emailClean;
        } catch (error) {
          return false;
        }
      })
      .map((oneTimeToken) => oneTimeToken.id);

    await prisma.$transaction(async (tx) => {
      for (const transfer of ownerTransfers) {
        await tx.member.update({
          where: {
            id: transfer.memberId,
          },
          data: {
            role: "OWNER",
          },
        });
      }

      if (homesToDeleteIds.size > 0) {
        const homeIds = [...homesToDeleteIds];

        await tx.user.updateMany({
          where: {
            tutorial_home_id: {
              in: homeIds,
            },
          },
          data: {
            tutorial_home_id: null,
          },
        });

        await tx.home.deleteMany({
          where: {
            id: {
              in: homeIds,
            },
          },
        });
      }

      await tx.home.updateMany({
        where: {
          premium_assigned_by_user_id: id_user,
        },
        data: {
          premium_assigned_by_user_id: null,
          premium_assigned_at: null,
          premium_locked_until: null,
          premium_ends_at: null,
        },
      });

      await tx.invitation.deleteMany({
        where: {
          OR: [{ user_id: id_user }, { email: emailClean }],
        },
      });

      if (invitationTokenIdsToDelete.length > 0) {
        await tx.oneTimeToken.deleteMany({
          where: {
            id: {
              in: invitationTokenIdsToDelete,
            },
          },
        });
      }

      await tx.user.delete({
        where: {
          id: id_user,
        },
      });
    });

    const cloudinaryResults = await Promise.allSettled(
      [...cloudinaryPublicIds].map((publicId) =>
        cloudinary.uploader.destroy(publicId)
      )
    );
    cloudinaryResults.forEach((result) => {
      if (result.status === "rejected") {
        console.error("Error deleting Cloudinary asset: ", result.reason);
      }
    });

    let accountDeletedEmailSent = false;
    try {
      await sendAccountDeletedEmail({
        email: emailToNotify,
        name: nameToNotify,
      });
      accountDeletedEmailSent = true;
    } catch (emailError) {
      console.error("Error sending account deletion email: ", emailError);
    }

    return res.json({
      success: true,
      email_sent: accountDeletedEmailSent,
      message: accountDeletedEmailSent
        ? "Cuenta eliminada correctamente. Te hemos enviado un correo de confirmacion."
        : "Cuenta eliminada correctamente, pero no se pudo enviar el correo de confirmacion.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:id_user",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { id_user } = req.params;
    const { name, email, imageDelete } = req.body;
    try {
      if (!id_user) {
        return res.status(400).json({
          message: "Faltan datos",
        });
      }
      if (req.user?.id !== id_user) {
        return res.status(403).json({
          message: "No tienes permisos para editar este perfil",
        });
      }
      const user = await prisma.user.findUnique({
        where: {
          id: id_user,
        },
      });
      if (user === null) {
        return res.status(400).json({
          message: "Usuario no encontrada.",
        });
      }

      const image = [];

      if (imageDelete === "true") {
        if (user.image) {
          cloudinary.uploader.destroy(user.image);
        }
      } else {
        if (req.file?.path) {
          if (user.image) {
            cloudinary.uploader.destroy(user.image);
          }
          const result = await uploadImage(req.file.path);
          image.push(result);
        } else if (user.image) {
          image.push({ public_id: user.image });
        }
      }

      const cleanedName = name?.trim();

      await prisma.user.update({
        where: {
          id: id_user,
        },
        data: {
          name: cleanedName ? cleanedName : user.name,
          email: email ? email : user.email,
          image: image[0]?.public_id ? image[0]?.public_id : null,
        },
      });

      res.json({
        message: "Datos actualizados correctamente",
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
