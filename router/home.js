const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

router.post(
  "/create-home",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { user_id, name } = req.body;

    try {
      if (!user_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const image = [];

      if (req.file?.path) {
        const result = await cloudinary.uploader.upload(req.file.path);
        image.push(result);
      }

      await prisma.home.create({
        data: {
          name: name,
          image: image[0]?.public_id ? image[0]?.public_id : null,
          members: {
            create: {
              user_id: user_id,
              role: "OWNER",
            },
          },
        },
      });

      res.json({ message: "Hogar creado correctamentename" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get("/user-home/:user_id", authMiddleware, async (req, res) => {
  const { user_id } = req.params;
  try {
    if (!user_id) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const user = await prisma.user.findUnique({ where: { id: user_id } });

    if (!user) {
      return res.status(400).json({ message: "No existe ese usuario" });
    }
    const data = await prisma.home.findMany({
      where: { members: { some: { user_id } } },
      orderBy: { updatedAt: "desc" },
    });

    res.send(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    if (!id) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const hogar = await prisma.home.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        lists: true,
        items: {
          orderBy: {
            updatedAt: "desc",
          },
        },
      },
    });
    res.send(hogar);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:hogar_id",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { hogar_id } = req.params;
    const { name, imageDelete } = req.body;
    try {
      if (!hogar_id) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const hogar = await prisma.home.findUnique({ where: { id: hogar_id } });

      if (!hogar) {
        return res.status(400).json({ message: "El hogar no existe" });
      }
      const image = [];

      if (imageDelete === "true") {
        if (hogar.image) {
          cloudinary.uploader.destroy(hogar.image);
        }
      } else {
        if (req.file?.path) {
          if (hogar.image) {
            cloudinary.uploader.destroy(hogar.image);
          }
          const result = await cloudinary.uploader.upload(req.file.path);
          image.push(result);
        } else if (hogar.image) {
          image.push({ public_id: hogar.image });
        }
      }

      const cleanedName = name?.trim();

      await prisma.home.update({
        where: {
          id: hogar_id,
        },
        data: {
          name: cleanedName ? cleanedName : hogar.name,
          image: image[0]?.public_id ? image[0].public_id : null,
        },
      });

      res.json({ message: "Hogar actualizado correctamentename" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete("/:hogar_id", authMiddleware, async (req, res) => {
  const { hogar_id } = req.params;
  try {
    if (!hogar_id) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const hogar = await prisma.home.findUnique({ where: { id: hogar_id } });

    if (!hogar) {
      return res.status(400).json({ message: "El hogar no existe" });
    }

    if (hogar.image) {
      cloudinary.uploader.destroy(hogar.image);
    }
    await prisma.home.delete({ where: { id: hogar_id } });
    res.json({ message: "Hogar borrado correctamentename" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
