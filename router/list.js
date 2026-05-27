const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

const itemSelect = {
  id: true,
  name: true,
  home_id: true,
  image: true,
  price: true,
  description: true,
  categories: true,
  supermarket: true,
  createdAt: true,
  updatedAt: true,
};

const itemListSelect = {
  id: true,
  item_id: true,
  list_id: true,
  quantity: true,
  purchased_quantity: true,
  check_take: true,
  status: true,
  updatedAt: true,
  item: {
    select: itemSelect,
  },
};

const itemListStatsSelect = {
  id: true,
  item_id: true,
  list_id: true,
  quantity: true,
  purchased_quantity: true,
  check_take: true,
  status: true,
};

const listStatsSelect = {
  id: true,
  title: true,
  home_id: true,
  fav: true,
  listCheck: true,
  copied_from_not_found_list_id: true,
  createdAt: true,
  updatedAt: true,
  itemsList: {
    select: itemListStatsSelect,
  },
};

const itemListStatuses = ["PENDING", "FOUND", "NOT_FOUND"];

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
    copies.map((copy) => [copy.copied_from_not_found_list_id, copy.id])
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

const emitToList = (req, listId, event, payload) => {
  const io = req.app.get("io");
  if (!io || !listId) return;
  io.to(`list:${listId}`).emit(event, payload);
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (value === "1") return true;
  if (value === "0") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
};

const statusFromCheckTake = (checkTake) => (checkTake ? "FOUND" : "PENDING");

const normalizeStatus = (status) => {
  if (typeof status !== "string") return null;
  const normalizedStatus = status.toUpperCase();
  return itemListStatuses.includes(normalizedStatus) ? normalizedStatus : null;
};

const parseNonNegativeInteger = (value) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : null;
};

const getPaginationParams = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.max(Number(query.pageSize || query.limit) || 10, 1);
  return {
    page,
    pageSize,
    skip: pageSize * (page - 1),
  };
};

const buildPagination = (page, pageSize, total) => {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

router.post("/create-list", authMiddleware, async (req, res) => {
  const { title, id_home } = req.body;
  const titleClean = title.trim();
  try {
    if (!id_home || !titleClean) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const home = await prisma.home.findUnique({ where: { id: id_home } });

    if (!home) {
      return res.status(400).json({ message: "El hogar no existe" });
    }

    const data = await prisma.list.create({
      data: {
        title,
        home_id: id_home,
      },
      select: listStatsSelect,
    });

    res.json({
      message: "Lista creada correctamente",
      list: addNotFoundCopyFields(data),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/create-from-not-found/:id_list",
  authMiddleware,
  async (req, res) => {
    const { id_list } = req.params;
    const { title, clientMutationId } = req.body;
    const titleClean = title?.trim();

    try {
      if (!id_list || !titleClean) {
        return res.status(400).json({ message: "Faltan datos" });
      }

      const sourceList = await prisma.list.findUnique({
        where: { id: id_list },
        select: {
          id: true,
          home_id: true,
        },
      });

      if (!sourceList) {
        return res.status(400).json({ message: "La lista origen no existe" });
      }

      const existingCopy = await prisma.list.findFirst({
        where: {
          copied_from_not_found_list_id: id_list,
        },
        select: listStatsSelect,
      });

      if (existingCopy) {
        return res.json({
          message: "Lista ya creada anteriormente",
          list: addNotFoundCopyFields(existingCopy),
          reused: true,
          clientMutationId,
        });
      }

      const notFoundItems = await prisma.itemList.findMany({
        where: {
          list_id: id_list,
          status: "NOT_FOUND",
        },
        select: {
          item_id: true,
          quantity: true,
          purchased_quantity: true,
        },
      });

      const remainingItems = notFoundItems
        .map((itemList) => ({
          item_id: itemList.item_id,
          quantity: itemList.quantity - itemList.purchased_quantity,
        }))
        .filter((itemList) => itemList.quantity > 0);

      if (remainingItems.length === 0) {
        return res.status(400).json({
          message: "No hay productos no encontrados para crear una lista",
        });
      }

      const list = await prisma.list.create({
        data: {
          title: titleClean,
          home_id: sourceList.home_id,
          copied_from_not_found_list_id: sourceList.id,
          itemsList: {
            create: remainingItems.map((itemList) => ({
              item_id: itemList.item_id,
              quantity: itemList.quantity,
              purchased_quantity: 0,
              check_take: false,
              status: "PENDING",
            })),
          },
        },
        select: listStatsSelect,
      });

      return res.json({
        message: "Lista creada correctamente",
        list: addNotFoundCopyFields(list),
        reused: false,
        clientMutationId,
      });
    } catch (error) {
      if (error.code === "P2002") {
        const existingCopy = await prisma.list.findFirst({
          where: {
            copied_from_not_found_list_id: req.params.id_list,
          },
          select: listStatsSelect,
        });

        if (existingCopy) {
          return res.json({
            message: "Lista ya creada anteriormente",
            list: addNotFoundCopyFields(existingCopy),
            reused: true,
            clientMutationId: req.body?.clientMutationId,
          });
        }
      }

      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/add-item/:id_list", authMiddleware, async (req, res) => {
  const { id_item, quantity, clientMutationId } = req.body;
  const { id_list } = req.params;
  try {
    if (!id_list || !id_item) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await prisma.list.findUnique({ where: { id: id_list } });

    if (!list) {
      return res.status(400).json({ message: "La lista no existe" });
    }

    const existingItemList = await prisma.itemList.findUnique({
      where: {
        item_id_list_id: {
          item_id: id_item,
          list_id: id_list,
        },
      },
      select: itemListSelect,
    });

    if (existingItemList) {
      return res.json({
        message: "Producto ya estaba en la lista",
        itemList: existingItemList,
        clientMutationId,
      });
    }

    const itemList = await prisma.itemList.create({
      data: {
        item_id: id_item,
        list_id: id_list,
        quantity: quantity === undefined ? undefined : +quantity,
        purchased_quantity: 0,
      },
      select: itemListSelect,
    });

    emitToList(req, id_list, "itemlist:created", {
      ...itemList,
      clientMutationId,
    });

    res.json({
      message: "Producto añadido correctamente",
      itemList,
      clientMutationId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/update-list/:id_list", authMiddleware, async (req, res) => {
  const { id_list } = req.params;
  const { title } = req.body;
  const titleClean = title.trim();
  try {
    if (!id_list) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await prisma.list.findUnique({ where: { id: id_list } });

    if (!list) {
      return res.status(400).json({ message: "La lista no existe" });
    }
    await prisma.list.update({
      where: {
        id: id_list,
      },
      data: {
        title: titleClean,
      },
    });
    res.json({
      message: "Lista actualizada correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/update-itemlist/:id_itemList",
  authMiddleware,
  async (req, res) => {
    const { id_itemList } = req.params;
    const { quantity, purchased_quantity, check_take, status, clientMutationId } =
      req.body;
    try {
      if (!id_itemList) {
        return res.status(400).json({ message: "Faltan datos" });
      }

      const itemList = await prisma.itemList.findUnique({
        where: { id: id_itemList },
      });

      if (!itemList) {
        return res.status(400).json({ message: "El producto no existe" });
      }

      const data = {};
      if (quantity !== undefined) {
        const nextQuantity = +quantity;
        if (itemList.quantity !== nextQuantity) data.quantity = nextQuantity;
      }
      if (purchased_quantity !== undefined) {
        const nextPurchasedQuantity =
          parseNonNegativeInteger(purchased_quantity);
        if (nextPurchasedQuantity === null) {
          return res
            .status(400)
            .json({ message: "La cantidad comprada no es valida" });
        }

        if (itemList.purchased_quantity !== nextPurchasedQuantity) {
          data.purchased_quantity = nextPurchasedQuantity;
        }

        const targetQuantity = data.quantity ?? itemList.quantity;
        const nextStatus =
          nextPurchasedQuantity >= targetQuantity ? "FOUND" : "PENDING";
        const nextCheckTake = nextStatus === "FOUND";

        if (itemList.status !== nextStatus) data.status = nextStatus;
        if (itemList.check_take !== nextCheckTake) {
          data.check_take = nextCheckTake;
        }
      }
      if (check_take !== undefined && purchased_quantity === undefined) {
        const nextCheckTake = parseBoolean(check_take);
        if (itemList.check_take !== nextCheckTake) {
          data.check_take = nextCheckTake;
        }

        const nextStatus = statusFromCheckTake(nextCheckTake);
        if (itemList.status !== nextStatus) {
          data.status = nextStatus;
        }
      }
      if (status !== undefined) {
        const nextStatus = normalizeStatus(status);
        if (!nextStatus) {
          return res.status(400).json({ message: "Estado no valido" });
        }

        if (itemList.status !== nextStatus) data.status = nextStatus;
        const nextCheckTake = nextStatus === "FOUND";
        if (itemList.check_take !== nextCheckTake) {
          data.check_take = nextCheckTake;
        }
        if (
          nextStatus === "NOT_FOUND" &&
          purchased_quantity === undefined &&
          itemList.purchased_quantity !== 0
        ) {
          data.purchased_quantity = 0;
        }
      }

      const updatedItemList = Object.keys(data).length
        ? await prisma.itemList.update({
            where: {
              id: id_itemList,
            },
            data,
            select: itemListSelect,
          })
        : await prisma.itemList.findUnique({
            where: { id: id_itemList },
            select: itemListSelect,
          });

      if (Object.keys(data).length || clientMutationId) {
        emitToList(req, updatedItemList.list_id, "itemlist:updated", {
          ...updatedItemList,
          clientMutationId,
        });
      }

      res.json({
        message: "Producto actualizado correctamente",
        itemList: updatedItemList,
        clientMutationId,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/delete-itemlist/:id_itemList",
  authMiddleware,
  async (req, res) => {
    const { id_itemList } = req.params;
    const { clientMutationId } = req.body;
    try {
      if (!id_itemList) {
        return res.status(400).json({ message: "Faltan datos" });
      }

      const itemList = await prisma.itemList.findUnique({
        where: { id: id_itemList },
      });

      if (!itemList) {
        return res.json({
          message: "Producto ya eliminado",
          itemList: {
            id: id_itemList,
          },
          clientMutationId,
        });
      }
      await prisma.itemList.delete({
        where: {
          id: id_itemList,
        },
      });

      const deletedItemList = {
        id: id_itemList,
        list_id: itemList.list_id,
      };

      emitToList(req, itemList.list_id, "itemlist:deleted", {
        ...deletedItemList,
        clientMutationId,
      });

      res.json({
        message: "Producto eliminado correctamente",
        itemList: deletedItemList,
        clientMutationId,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete("/delete-list/:id_list", authMiddleware, async (req, res) => {
  const { id_list } = req.params;
  try {
    if (!id_list) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await prisma.list.findUnique({ where: { id: id_list } });

    if (!list) {
      return res.status(400).json({ message: "La lista no existe" });
    }
    await prisma.list.delete({
      where: {
        id: id_list,
      },
    });
    res.json({
      message: "Lista eliminada correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/params/items/:id_list", authMiddleware, async (req, res) => {
  const { page, name } = req.query;
  const { id_list } = req.params;
  const { page: pageNumber, pageSize, skip } = getPaginationParams(req.query);
  try {
    if (!id_list) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const list = await prisma.list.findUnique({ where: { id: id_list } });

    if (!list) {
      return res.status(400).json({ message: "No existe ese hogar" });
    }

    const where = {
      list_id: id_list,
      item: {
        name: {
          contains: name,
          mode: "insensitive",
        },
      },
    };

    const total = await prisma.itemList.count({ where });

    const items = await prisma.itemList.findMany({
      where,
      include: {
        item: {
          select: itemSelect,
        },
      },
      orderBy: {
        item: {
          name: "asc",
        },
      },
      skip,
      take: pageSize,
    });

    return res.json({
      items,
      pagination: buildPagination(pageNumber, pageSize, total),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/params/:id_home", authMiddleware, async (req, res) => {
  const { page, title } = req.query;
  const { id_home } = req.params;
  const { page: pageNumber, pageSize, skip } = getPaginationParams(req.query);
  try {
    if (!id_home) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const home = await prisma.home.findUnique({ where: { id: id_home } });

    if (!home) {
      return res.status(400).json({ message: "No existe ese hogar" });
    }

    const lists = await prisma.list.findMany({
      where: {
        home_id: id_home,
        ...(title
          ? {
              title: {
                contains: title,
                mode: "insensitive",
              },
            }
          : {}),
      },
      include: {
        itemsList: {
          select: itemListStatsSelect,
        },
      },
    });

    const sortedLists = lists.sort((a, b) => {
      const aHasPending = a.itemsList.some(
        (itemList) => itemList.status === "PENDING"
      );
      const bHasPending = b.itemsList.some(
        (itemList) => itemList.status === "PENDING"
      );

      if (aHasPending !== bHasPending) return aHasPending ? -1 : 1;

      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    const paginatedLists = sortedLists.slice(skip, skip + pageSize);

    return res.json({
      items: await attachNotFoundCopyFields(paginatedLists),
      pagination: buildPagination(pageNumber, pageSize, sortedLists.length),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Ver todas las listas con ciertos datos de los productos para las estadisticas

router.get("/home/:id_home", authMiddleware, async (req, res) => {
  const { id_home } = req.params;
  try {
    if (!id_home) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const home = await prisma.home.findUnique({
      where: { id: id_home },
      include: {
        lists: {
          orderBy: {
            title: "asc",
          },
          select: {
            title: true,
            fav: true,
            listCheck: true,
            itemsList: true,
            id: true,
            copied_from_not_found_list_id: true,
          },
        },
      },
    });

    if (!home) {
      return res.status(400).json({ message: "No hay lista en el hogar" });
    }
    res.send({
      ...home,
      lists: await attachNotFoundCopyFields(home.lists),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Ver todos los porductos y sus datos de una lista

router.get("/:id_home/:id_list", authMiddleware, async (req, res) => {
  const { id_list, id_home } = req.params;
  try {
    if (!id_list || !id_home) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const exist = await prisma.home.findFirst({
      where: {
        id: id_home,
        lists: {
          some: { id: id_list },
        },
      },
      select: {
        lists: {
          where: {
            id: id_list,
          },
        },
      },
    });

    if (exist === null) {
      return res.status(400).json({ message: "Error al busca la lista." });
    }

    const list = await prisma.itemList.findMany({
      where: { list_id: id_list },
      orderBy: {
        item: { name: "asc" },
      },
      select: {
        item_id: true,
        list_id: true,
        quantity: true,
        purchased_quantity: true,
        item: {
          select: itemSelect,
        },
        check_take: true,
        status: true,
        id: true,
        updatedAt: true,
      },
    });

    res.send(list);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
