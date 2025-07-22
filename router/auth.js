const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { DateTime } = require("luxon");
const authMiddleware = require("../middleware/auth.middleware");
const transporter = require("../config/nodemailer");
require("dotenv").config();

const register = process.env.URL_REGISTER;

router.post(register, async (req, res) => {
  const { name, email, emailConfirm, password, passwordConfirm } = req.body;

  if (!email || !emailConfirm || !password || !name || !passwordConfirm) {
    return res.status(400).json({
      message: "Faltan datos",
    });
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

    const hashedPassword = await bcrypt.hash(passwordClean, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
    });

    const token = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ message: "Usuario registrado correctamente", token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user === null) {
      return res
        .status(401)
        .json({ message: "Ese correo no esta registrado." });
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );
    res.json({ message: "Credenciales correctas", token });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

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

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const ahora = DateTime.now().setZone("Europe/Madrid");
  const en30Min = ahora.plus({ minutes: 30 });
  const formatoISO = en30Min.toISO();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
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
      from: '"NotApp" <no-reply@notapp.com>',
      to: email,
      subject: "Restablecer contraseña",
      html: `<p>Haz clic aquí para restablecer tu contraseña:</p><a href="${link}">${link}</a>`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email: ", error);
      } else {
        console.log("Email sent: ", info.response);
      }
    });
    console.log("Mail Enviado");

    res.json({ message: "Correo de recuperación enviado" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/reset-password/:token", async (req, res) => {
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

    if (tokenValidate.used || tokenValidate.expiresAt < Date.now()) {
      return res.status(400).json({ message: "Token invalido" });
    }

    await prisma.oneTimeToken.update({
      where: { id: tokenValidate.id },
      data: { used: true },
    });

    const hashedPassword = await bcrypt.hash(passwordClean, 10);

    await prisma.user.update({
      where: { id: tokenValidate.user_id },
      data: { password: hashedPassword },
    });

    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/check-token/:token", async (req, res) => {
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
  
      res.json({ message: "Token valido" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  });

module.exports = router;
