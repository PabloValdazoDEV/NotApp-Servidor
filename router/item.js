const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

router.post(
  "/create-item",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { hogar_id, name, price, description, categories } = req.body;
    if (req.file) {
      console.log(req.file.path);
    }
    try {
      if (!hogar_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const hogar = await prisma.home.findUnique({ where: { id: hogar_id } });

      if (!hogar) {
        return res.status(400).json({ message: "El hogar no existe" });
      }

      const image = [];

      if (req.file?.path) {
        const result = await cloudinary.uploader.upload(req.file.path);
        image.push(result);
      }
      const cleanedName = name?.trim();

      const data = await prisma.item.create({
        data: {
          home_id: hogar_id,
          name: cleanedName,
          image: image[0]?.public_id ? image[0]?.public_id : null,
          description,
          price,
          categories,
        },
      });
      res.json({ message: "Item creado correctamente", item: data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/:item_id",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { name, price, description, categories } = req.body;
    const { item_id } = req.params;
    try {
      if (!item_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const item = await prisma.item.findUnique({ where: { id: item_id } });

      if (!item) {
        return res.status(400).json({ message: "El producto no existe" });
      }

      const image = [];

      if (req.file?.path) {
        if (item.image) {
          cloudinary.uploader.destroy(item.image);
        }
        const result = await cloudinary.uploader.upload(req.file.path);
        image.push(result);
      }else if(item.image){
        image.push({public_id: item.image});
      }

      const cleanedName = name?.trim();

      const data = await prisma.item.update({
        where: { id: item_id },
        data: {
          name: cleanedName,
          image: image[0]?.public_id ? image[0]?.public_id : null,
          description,
          price,
          categories,
        },
      });
      res.json({ message: "Item actualizado correctamente", item: data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete("/:item_id", authMiddleware, async (req, res) => {
  const { item_id } = req.params;
  try {
    if (!item_id) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const item = await prisma.item.findUnique({ where: { id: item_id } });

    if (!item) {
      return res.status(400).json({ message: "El producto no existe" });
    }

    if (item.image) {
      cloudinary.uploader.destroy(item.image);
    }
    await prisma.item.delete({ where: { id: item_id } });
    res.json({ message: "Item borrado correctamentename" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
