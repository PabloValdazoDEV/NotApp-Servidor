const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
const { uploadImage } = require("../config/cloudinaryUpload");

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
        const result = await uploadImage(req.file.path);
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
      include: {
        members: true,
      },
      orderBy: { name: "asc" },
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
            name: "asc",
          },
        },
      },
    });
    const roleOrder = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

    hogar.members.sort((a, b) => {
      return roleOrder[a.role] - roleOrder[b.role];
    });
    res.send(hogar);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:home_id/transfer-owner", authMiddleware, async (req, res) => {
  const { home_id } = req.params;
  const { new_owner_member_id } = req.body;
  const userId = req.user?.id;

  try {
    if (!home_id || !new_owner_member_id || !userId) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentOwner = await tx.member.findFirst({
        where: {
          home_id,
          user_id: userId,
          role: "OWNER",
        },
      });

      if (!currentOwner) {
        return {
          status: 403,
          body: { message: "Solo el propietario puede transferir el hogar" },
        };
      }

      const newOwner = await tx.member.findUnique({
        where: {
          id: new_owner_member_id,
        },
      });

      if (!newOwner || newOwner.home_id !== home_id) {
        return {
          status: 400,
          body: { message: "El nuevo propietario no pertenece a este hogar" },
        };
      }

      if (newOwner.id === currentOwner.id) {
        return {
          status: 400,
          body: { message: "El nuevo propietario debe ser otro miembro" },
        };
      }

      const updatedOwner = await tx.member.update({
        where: {
          id: new_owner_member_id,
        },
        data: {
          role: "OWNER",
        },
      });

      await tx.member.delete({
        where: {
          id: currentOwner.id,
        },
      });

      return {
        status: 200,
        body: {
          message: "Propiedad transferida correctamente",
          owner: updatedOwner,
          removedMemberId: currentOwner.id,
        },
      };
    });

    return res.status(result.status).json(result.body);
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
          const result = await uploadImage(req.file.path);
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
