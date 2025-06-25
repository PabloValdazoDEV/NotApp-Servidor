const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { DateTime } = require("luxon");
const authMiddleware = require("../middleware/auth.middleware");
const transporter = require("../config/nodemailer");
require("dotenv").config();

router.post("/register-special", async (req, res) => {
  const { name, email, emailConfirm, password, passwordConfirm, token } =
    req.body;

  if (
    !email ||
    !emailConfirm ||
    !password ||
    !name ||
    !passwordConfirm ||
    !token
  ) {
    return res.status(400).json({
      message: "Faltan datos",
    });
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (decoded.email !== email) {
    return res.status(400).json({ message: "El email invitado no conincide" });
  }

  if (email !== emailConfirm) {
    return res.status(400).json({
      message: "Los Emails no son iguales",
    });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({
      message: "Las Contraseñas no son iguales",
    });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{7,}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const passwordClean = password.trim();
  const emailClean = email.trim();

  try {
    if (
      !passwordRegex.test(passwordClean) ||
      !emailRegex.test(emailClean) ||
      !password ||
      !email
    ) {
      return res.status(400).json({
        message: "El formato de la contraseña o del email no es valida",
      });
    }

    if (!passwordRegex.test(passwordClean)) {
      return res.status(400).json({
        message:
          "La contraseña debe tener al menos 7 caracteres, una mayúscula, un número y un carácter especial",
      });
    }

    if (password !== passwordConfirm) {
      return res.status(400).json({ message: "Las contraseñas no coinciden" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "El email ya está registrado" });
    }

    const tokenValidate = await prisma.oneTimeToken.findUnique({
      where: { token },
    });

    if (tokenValidate.used || tokenValidate.expiresAt < Date.now()) {
      return res.status(400).json({ message: "Token invalido" });
    }

    await prisma.oneTimeToken.update({
      where: { id: tokenValidate.id },
      data: { used: true },
    });

    const hashedPassword = await bcrypt.hash(passwordClean, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
    });

    const tokenAuth = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    await prisma.invitation.create({
      data: {
        user_id: user.id,
        home_id: decoded.id_hogar,
      },
    });

    res.json({ message: "Usuario registrado correctamente", token: tokenAuth });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
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

    if (accept) {
      await prisma.member.create({
        data: {
          user_id: invitation.user_id,
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

    res.json({
      message: `${invitation.user.name} se ha unido a ${invitation.home.name}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/invite/:id_hogar", authMiddleware, async (req, res) => {
  const { email } = req.body;
  const { id_hogar } = req.params;
  const ahora = DateTime.now().setZone("Europe/Madrid");
  const en7dias = ahora.plus({ day: 7 });
  const formatoISO = en7dias.toISO();
  try {
    if (!email || !id_hogar) {
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
    const emailMember = home.members.filter(
      (user) => user.user.email === email
    );

    if (emailMember.length !== 0) {
      return res.status(400).json({
        message: "Este usuario ya esta dentro del hogar.",
      });
    }
    const emailInvitation = home.invitations.filter(
      (user) => user.user.email === email
    );

    if (emailInvitation.length !== 0) {
      return res.status(400).json({
        message: "Este usuario ya tiene una invitación pendiente",
      });
    }
    const user = await prisma.user.findUnique({ where: { email } });

    if (user === null) {
      const token = jwt.sign(
        { id_hogar: id_hogar, email: email },
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

      const link = `${process.env.URL}register-special?token=${token}`;

      const mailOptions = {
        from: '"NotApp" <no-reply@notapp.com>',
        to: email,
        subject: `Initación al hogar ${home.name}`,
        html: `<p>Haz clic aquí para registrarte:</p><a href="${link}">${link}</a>`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending email: ", error);
        } else {
          console.log("Email sent: ", info.response);
        }
      });

      return res.json({ message: "Email de invitación enviado." });
    }
    await prisma.invitation.create({
      data: {
        user_id: user.id,
        home_id: id_hogar,
      },
    });

    res.json({ message: `Invitación enviada a ${user.name}` });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
