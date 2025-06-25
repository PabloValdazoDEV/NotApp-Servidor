const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

router.get("/:id_user", authMiddleware, async (req, res) => {
  const { id_user } = req.params;
  try {
    if (!id_user) {
      return res.status(400).json({
        message: "Faltan datos",
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
        invitations: true,
      },
    });
    if (user === null) {
      return res.status(400).json({
        message: "Usuario no encontrada.",
      });
    }

    res.json({
      message: "Datos enviados",
      user: user,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:id_user",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { id_user } = req.params;
    const { name, email } = req.body;
    try {
      if (!id_user) {
        return res.status(400).json({
          message: "Faltan datos",
        });
      }
      const user = await prisma.user.findUnique({
        where: {
          id: id_user
        },
      });
      if (user === null) {
        return res.status(400).json({
          message: "Usuario no encontrada.",
        });
      }

      const image = [];

      if (req.file?.path) {
        if (user.image) {
          cloudinary.uploader.destroy(user.image);
        }
        const result = await cloudinary.uploader.upload(req.file.path);
        image.push(result);
      } else if (user.image) {
        image.push({ public_id: user.image });
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
