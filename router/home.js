const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
const { uploadImage } = require("../config/cloudinaryUpload");
const { parseExplicitBoolean } = require("../utils/boolean");
const {
  findAndUploadFirstProductImage,
  mapWithConcurrency,
} = require("./item");

const starterProductCategories = new Set([
  "FRUTAS_VERDURAS",
  "LACTEOS",
  "CARNE",
  "PESCADO",
  "BEBIDAS",
  "PANADERIA",
  "DESAYUNOS",
  "CAFE_INFUSIONES",
  "PASTA_ARROZ_LEGUMBRES",
  "CONSERVAS",
  "HUEVOS",
  "ACEITES_SALSAS_CONDIMENTOS",
  "CHARCUTERIA",
  "DULCES",
  "APERITIVOS",
  "PLATOS_PREPARADOS",
  "CONGELADOS",
  "HIGIENE",
  "BELLEZA",
  "LIMPIEZA",
  "MASCOTAS",
  "BEBE",
  "FARMACIA",
  "OTROS",
]);

const starterProductSupermarkets = new Set([
  "CUALQUIERA",
  "MERCADONA",
  "AHORRAMAS",
  "CARREFOUR",
  "LIDL",
  "ALDI",
  "DIA",
  "ALCAMPO",
  "EROSKI",
  "CONSUM",
  "OTROS",
]);

const parseInitialItems = (rawItems) => {
  if (rawItems === undefined || rawItems === null || rawItems === "") return [];

  let parsedItems = rawItems;

  if (typeof rawItems === "string") {
    try {
      parsedItems = JSON.parse(rawItems);
    } catch {
      throw new Error("initial_items debe ser una lista");
    }
  }

  if (!Array.isArray(parsedItems)) {
    throw new Error("initial_items debe ser una lista");
  }

  const seenNames = new Set();

  return parsedItems
    .slice(0, 60)
    .map((item) => {
      const name = String(item?.name || "").trim();
      if (!name) return null;

      const normalizedName = name.toLowerCase();
      if (seenNames.has(normalizedName)) return null;
      seenNames.add(normalizedName);

      const categories = Array.isArray(item.categories)
        ? item.categories
            .map((category) => String(category).trim())
            .filter((category) => starterProductCategories.has(category))
        : [];
      const supermarket = starterProductSupermarkets.has(item.supermarket)
        ? item.supermarket
        : "CUALQUIERA";

      return {
        name,
        description: item.description ? String(item.description).trim() : "",
        price: item.price ? String(item.price).trim() : "",
        categories,
        supermarket,
        is_recurring: Boolean(item.is_recurring),
      };
    })
    .filter(Boolean);
};

const getNotFoundCopyMap = async (lists) => {
  const listIds = lists.map((list) => list.id).filter(Boolean);

  if (listIds.length === 0) return new Map();

  const copies = await prisma.list.findMany({
    where: {
      copied_from_not_found_list_id: {
        in: listIds,
      },
    },
    select: {
      id: true,
      copied_from_not_found_list_id: true,
    },
  });

  return new Map(
    copies.map((copy) => [copy.copied_from_not_found_list_id, copy.id]),
  );
};

const addNotFoundCopyFields = (list, copyMap = new Map()) => {
  if (!list) return list;

  const notFoundCopyListId = copyMap.get(list.id) || null;

  return {
    ...list,
    not_found_copy_list_id: notFoundCopyListId,
    has_not_found_copy: Boolean(notFoundCopyListId),
  };
};

const attachNotFoundCopyFields = async (lists) => {
  const copyMap = await getNotFoundCopyMap(lists);
  return lists.map((list) => addNotFoundCopyFields(list, copyMap));
};

router.post(
  "/create-home",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { user_id, name, initial_items, include_initial_item_images } =
      req.body;

    try {
      if (!user_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const includeInitialItemImages = parseExplicitBoolean(
        include_initial_item_images,
        false
      );
      if (!includeInitialItemImages.valid) {
        return res.status(400).json({
          message:
            "include_initial_item_images debe ser un valor booleano valido",
        });
      }

      const initialItems = parseInitialItems(initial_items);
      const initialItemsWithImages =
        includeInitialItemImages.value && initialItems.length > 0
          ? await mapWithConcurrency(initialItems, 3, async (item) => ({
              ...item,
              image: await findAndUploadFirstProductImage(item),
            }))
          : initialItems;
      const image = [];

      if (req.file?.path) {
        const result = await uploadImage(req.file.path);
        image.push(result);
      }

      const home = await prisma.home.create({
        data: {
          name: name,
          image: image[0]?.public_id ? image[0]?.public_id : null,
          members: {
            create: {
              user_id: user_id,
              role: "OWNER",
            },
          },
          ...(initialItems.length > 0
            ? {
                items: {
                  create: initialItemsWithImages,
                },
              }
            : {}),
        },
      });

      res.json({
        success: true,
        message: "Hogar creado correctamente",
        home,
        imported_items_count: initialItemsWithImages.length,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message:
          error.message === "initial_items debe ser una lista"
            ? error.message
            : "Server error",
      });
    }
  },
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

    const favorites = await prisma.homeFavorite.findMany({
      where: { user_id },
      select: { home_id: true },
    });
    const favoriteHomeIds = new Set(
      favorites.map((favorite) => favorite.home_id),
    );

    const homes = await prisma.home.findMany({
      where: { members: { some: { user_id } } },
      include: {
        members: true,
      },
      orderBy: { name: "asc" },
    });

    const data = homes
      .map((home) => ({
        ...home,
        is_favorite: favoriteHomeIds.has(home.id),
      }))
      .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));

    res.send(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    if (!id || !userId) {
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

    if (!hogar) {
      return res.status(404).json({ message: "El hogar no existe" });
    }

    const currentMember = hogar.members.find(
      (member) => member.user_id === userId,
    );

    if (!currentMember) {
      return res.status(403).json({ message: "No perteneces a este hogar" });
    }

    const roleOrder = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

    hogar.members.sort((a, b) => {
      return roleOrder[a.role] - roleOrder[b.role];
    });
    res.send({
      ...hogar,
      lists: await attachNotFoundCopyFields(hogar.lists),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/invitation/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const hogar = await prisma.home.findUnique({
      where: { id },
      include: {
        members: true,
      },
    });

    if (!hogar) {
      return res.status(404).json({ message: "El hogar no existe" });
    }

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

router.post("/:home_id/favorite", authMiddleware, async (req, res) => {
  const { home_id } = req.params;
  const userId = req.user?.id;

  try {
    if (!home_id || !userId) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const member = await prisma.member.findFirst({
      where: {
        home_id,
        user_id: userId,
      },
    });

    if (!member) {
      return res.status(403).json({
        message: "No perteneces a este hogar",
      });
    }

    const favorite = await prisma.homeFavorite.upsert({
      where: {
        user_id_home_id: {
          user_id: userId,
          home_id,
        },
      },
      update: {},
      create: {
        user_id: userId,
        home_id,
      },
    });

    res.json({
      message: "Hogar marcado como favorito",
      favorite,
    });
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
  },
);

router.delete("/:home_id/favorite", authMiddleware, async (req, res) => {
  const { home_id } = req.params;
  const userId = req.user?.id;

  try {
    if (!home_id || !userId) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    await prisma.homeFavorite.deleteMany({
      where: {
        home_id,
        user_id: userId,
      },
    });

    res.json({
      message: "Hogar eliminado de favoritos",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:hogar_id", authMiddleware, async (req, res) => {
  const { hogar_id } = req.params;
  const userId = req.user?.id;

  try {
    if (!hogar_id || !userId) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const hogar = await prisma.home.findUnique({
      where: { id: hogar_id },
      include: {
        members: {
          select: {
            user_id: true,
            role: true,
          },
        },
      },
    });

    if (!hogar) {
      return res.status(400).json({ message: "El hogar no existe" });
    }

    const ownerMember = hogar.members.find(
      (member) => member.user_id === userId && member.role === "OWNER",
    );

    if (!ownerMember) {
      return res
        .status(403)
        .json({ message: "Solo el propietario puede borrar este hogar" });
    }

    if (
      hogar.is_tutorial &&
      !hogar.members.every((member) => member.user_id === userId)
    ) {
      return res.status(403).json({
        message: "No puedes borrar un hogar tutorial compartido",
      });
    }

    if (hogar.image) {
      await cloudinary.uploader.destroy(hogar.image);
    }

    await prisma.$transaction([
      ...(hogar.is_tutorial
        ? [
            prisma.user.updateMany({
              where: {
                id: userId,
                tutorial_home_id: hogar_id,
              },
              data: {
                tutorial_home_id: null,
              },
            }),
          ]
        : []),
      prisma.home.delete({ where: { id: hogar_id } }),
    ]);

    res.json({ message: "Hogar borrado correctamentename" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
