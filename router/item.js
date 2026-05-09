const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

const supermarkets = [
  "CUALQUIERA",
  "MERCADONA",
  "CARREFOUR",
  "LIDL",
  "ALDI",
  "DIA",
  "ALCAMPO",
  "EROSKI",
  "CONSUM",
  "OTROS",
];

const normalizeSupermarket = (supermarket) => {
  if (typeof supermarket !== "string") return "CUALQUIERA";
  const normalizedSupermarket = supermarket.trim().toUpperCase();
  return supermarkets.includes(normalizedSupermarket)
    ? normalizedSupermarket
    : "CUALQUIERA";
};

const duplicateCloudinaryImage = async (publicId) => {
  if (!publicId) return null;
  const imageUrl = cloudinary.url(publicId, { secure: true });
  const result = await cloudinary.uploader.upload(imageUrl);
  return result.public_id;
};

router.post(
  "/create-item",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { hogar_id, name, price, description, categories, supermarket } =
      req.body;
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
          supermarket: normalizeSupermarket(supermarket),
        },
      });
      res.json({ message: "Item creado correctamente", item: data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/import-from-home", authMiddleware, async (req, res) => {
  const { source_home_id, target_home_id, item_ids } = req.body;
  const userId = req.user?.id;

  try {
    if (
      !userId ||
      !source_home_id ||
      !target_home_id ||
      source_home_id === target_home_id ||
      !Array.isArray(item_ids) ||
      item_ids.length === 0
    ) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const itemIds = [
      ...new Set(
        item_ids
          .filter((itemId) => typeof itemId === "string" && itemId.trim())
          .map((itemId) => itemId.trim())
      ),
    ];

    if (itemIds.length === 0) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const homes = await prisma.home.findMany({
      where: {
        id: {
          in: [source_home_id, target_home_id],
        },
      },
      select: {
        id: true,
      },
    });

    if (homes.length !== 2) {
      return res.status(404).json({ message: "Hogar no encontrado" });
    }

    const [sourceMember, targetMember] = await Promise.all([
      prisma.member.findFirst({
        where: {
          user_id: userId,
          home_id: source_home_id,
        },
      }),
      prisma.member.findFirst({
        where: {
          user_id: userId,
          home_id: target_home_id,
          role: {
            in: ["ADMIN", "OWNER"],
          },
        },
      }),
    ]);

    if (!sourceMember || !targetMember) {
      return res.status(403).json({
        message: "No tienes permisos para importar productos entre estos hogares",
      });
    }

    const sourceItems = await prisma.item.findMany({
      where: {
        id: {
          in: itemIds,
        },
        home_id: source_home_id,
      },
      select: {
        id: true,
        name: true,
        price: true,
        description: true,
        categories: true,
        supermarket: true,
        image: true,
      },
    });

    if (sourceItems.length !== itemIds.length) {
      return res.status(404).json({
        message: "No se encontraron todos los productos en el hogar origen",
      });
    }

    const duplicatedItems = await Promise.all(
      sourceItems.map(async (item) => ({
        name: item.name,
        home_id: target_home_id,
        price: item.price,
        description: item.description,
        categories: item.categories,
        supermarket: item.supermarket,
        image: await duplicateCloudinaryImage(item.image),
      }))
    );

    const items = await prisma.$transaction(
      duplicatedItems.map((item) =>
        prisma.item.create({
          data: item,
        })
      )
    );

    return res.json({
      message: "Productos importados correctamente",
      count: items.length,
      items,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:item_id",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { name, price, description, categories, imageDelete, supermarket } =
      req.body;
    const categoriesFilter = categories?.filter((category) => category !== "0");
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

      if (imageDelete === "true") {
        if (item.image) {
          cloudinary.uploader.destroy(item.image);
        }
      } else {
        if (req.file?.path) {
          if (item.image) {
            cloudinary.uploader.destroy(item.image);
          }
          const result = await cloudinary.uploader.upload(req.file.path);
          image.push(result);
        } else if (item.image) {
          image.push({ public_id: item.image });
        }
      }

      const cleanedName = name?.trim();

      const data = await prisma.item.update({
        where: { id: item_id },
        data: {
          name: cleanedName,
          image: image[0]?.public_id || null,
          description,
          price,
          categories: categoriesFilter,
          ...(supermarket !== undefined
            ? { supermarket: normalizeSupermarket(supermarket) }
            : {}),
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

router.get("/params/:id_home", authMiddleware, async (req, res) => {
  const { element, page, name, category, supermarket } = req.query;
  const { id_home } = req.params;
  const salto = 10 * (page - 1);
  const supermarketFilter = supermarket
    ? normalizeSupermarket(supermarket)
    : null;
  try {
    if (!page && !element && !id_home) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const home = await prisma.home.findUnique({ where: { id: id_home } });

    if (!home) {
      return res.status(400).json({ message: "No existe ese hogar" });
    }

    const items = await prisma.item.findMany({
      where: {
        home_id: id_home,
        AND: [
          name
            ? {
                name: {
                  contains: name,
                  mode: "insensitive",
                },
              }
            : {},
          category
            ? {
                categories: {
                  has: category,
                },
              }
            : {},
          supermarketFilter && supermarketFilter !== "CUALQUIERA"
            ? {
                supermarket: supermarketFilter,
              }
            : {},
        ],
      },
      orderBy: {
        name: "asc",
      },
      skip: salto,
      take: 10,
    });

    return res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
