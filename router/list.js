const express = require("express");
const router = express.Router();
router.use(require("./shoppingCarry"));
const { getCarryMap } = require("../utils/shoppingCarry");
const { shoppingState, ShoppingStateError, integer } = require("../utils/shoppingState");
const { shoppingTransaction } = require("../utils/shoppingTransaction");
const { mutationKey, replayMutation, recordMutation } = require("../utils/shoppingMutation");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
const { DateTime } = require("luxon");
const { parseExplicitBoolean } = require("../utils/boolean");
const {
  getAccessibleHome,
  getAccessibleItemList,
  getAccessibleList,
  getAccessibleListInHome,
} = require("../utils/permissions");

const itemSelect = {
  id: true,
  name: true,
  home_id: true,
  image: true,
  price: true,
  description: true,
  categories: true,
  supermarket: true,
  is_recurring: true,
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

const listCreateSelect = {
  id: true,
  title: true,
  home_id: true,
  fav: true,
  listCheck: true,
  copied_from_not_found_list_id: true,
  createdAt: true,
  updatedAt: true,
  itemsList: {
    orderBy: {
      item: {
        name: "asc",
      },
    },
    select: itemListSelect,
  },
};

const itemListStatuses = ["PENDING", "FOUND", "NOT_FOUND"];
const LIST_DATE_ZONE = "Europe/Madrid";

const getNotFoundCopyMap = async (lists) => {
  const listIds = lists.map((list) => list.id).filter(Boolean);

  if (listIds.length === 0) return new Map();

  return getCarryMap(prisma, listIds);
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
  return integer(value);
};

const parsePositiveInteger = (value) => {
  return integer(value, 1);
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

const buildAutomaticListTitle = async (tx, homeId) => {
  const baseTitle = `Compra - ${DateTime.now()
    .setZone(LIST_DATE_ZONE)
    .toFormat("dd/MM/yyyy")}`;
  const existingLists = await tx.list.findMany({
    where: {
      home_id: homeId,
      title: {
        startsWith: baseTitle,
      },
    },
    select: {
      title: true,
    },
  });
  const existingTitles = new Set(existingLists.map((list) => list.title));

  if (!existingTitles.has(baseTitle)) return baseTitle;

  let suffix = 2;
  while (existingTitles.has(`${baseTitle} (${suffix})`)) {
    suffix += 1;
  }

  return `${baseTitle} (${suffix})`;
};

router.post("/create-list", authMiddleware, async (req, res) => {
  const { title, id_home, include_recurring_items } = req.body;
  try {
    if (!id_home || typeof id_home !== "string") {
      return res.status(400).json({ message: "Faltan datos" });
    }

    if (title !== undefined && title !== null && typeof title !== "string") {
      return res.status(400).json({ message: "El titulo debe ser un texto" });
    }

    const includeRecurringItems = parseExplicitBoolean(
      include_recurring_items,
      false
    );
    if (!includeRecurringItems.valid) {
      return res.status(400).json({
        message: "include_recurring_items debe ser un valor booleano valido",
      });
    }

    const home = await getAccessibleHome(req.user?.id, id_home, {
      select: {
        id: true,
      },
    });

    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para crear listas en este hogar",
      });
    }

    const titleClean = title?.trim();
    const data = await prisma.$transaction(async (tx) => {
      const resolvedTitle =
        titleClean || (await buildAutomaticListTitle(tx, id_home));
      const recurringItems = includeRecurringItems.value
        ? await tx.item.findMany({
            where: {
              home_id: id_home,
              is_recurring: true,
            },
            select: {
              id: true,
            },
          })
        : [];

      return tx.list.create({
        data: {
          title: resolvedTitle,
          home_id: id_home,
          ...(recurringItems.length > 0
            ? {
                itemsList: {
                  create: recurringItems.map((item) => ({
                    item_id: item.id,
                    quantity: 1,
                    purchased_quantity: 0,
                    check_take: false,
                    status: "PENDING",
                  })),
                },
              }
            : {}),
        },
        select: listCreateSelect,
      });
    });

    res.json({
      success: true,
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

      const sourceList = await getAccessibleList(req.user?.id, id_list, {
        select: {
          id: true,
          home_id: true,
        },
      });

      if (!sourceList) {
        return res.status(403).json({
          message: "No tienes permisos para consultar esta lista",
        });
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
    if (!id_list || typeof id_item !== "string" || !id_item) throw new ShoppingStateError("Faltan datos.");
    const mutationId = mutationKey(clientMutationId);
    const nextQuantity = quantity === undefined ? 1 : parsePositiveInteger(quantity);
    if (nextQuantity === null) throw new ShoppingStateError("La cantidad no es válida.");
    const result = await shoppingTransaction(async tx => {
      const list = await getAccessibleList(req.user?.id, id_list, { select: { id: true, home_id: true }, tx });
      if (!list) throw new ShoppingStateError("No tienes permisos para modificar esta lista.", 403);
      const replay = await replayMutation(tx, { listId: list.id, mutationId, userId: req.user.id, select: itemListSelect });
      if (replay) return { itemList: replay, reused: true };
      const item = await tx.item.findFirst({ where: { id: id_item, home_id: list.home_id }, select: { id: true } });
      if (!item) throw new ShoppingStateError("El producto no pertenece al hogar de la lista.");
      const pending = await tx.itemList.findMany({ where: { item_id: id_item, list_id: list.id, status: "PENDING" }, select: itemListSelect });
      const existing = pending.find(row => row.purchased_quantity < row.quantity);
      const itemList = existing || await tx.itemList.create({
        data: { item_id: id_item, list_id: list.id, quantity: nextQuantity, purchased_quantity: 0, created_mutation_id: mutationId },
        select: itemListSelect,
      });
      await recordMutation(tx, { listId: list.id, mutationId, userId: req.user.id, rowId: itemList.id, operation: "add" });
      return { itemList, reused: Boolean(existing) };
    });
    if (!result.reused) emitToList(req, id_list, "itemlist:created", { ...result.itemList, clientMutationId });
    res.json({ message: result.reused ? "Producto ya estaba en la lista" : "Producto añadido correctamente", ...result, clientMutationId });
  } catch (error) {
    if (error instanceof ShoppingStateError) return res.status(error.status).json({ success: false, message: error.message });
    console.error(error);
    res.status(500).json({ success: false, message: "No se pudo añadir el producto. Se conservan tus datos." });
  }
});

router.post("/update-list/:id_list", authMiddleware, async (req, res) => {
  const { id_list } = req.params;
  const { title } = req.body;
  const titleClean = typeof title === "string" ? title.trim() : "";
  try {
    if (!id_list || !titleClean) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await getAccessibleList(req.user?.id, id_list);

    if (!list) {
      return res.status(403).json({
        message: "No tienes permisos para modificar esta lista",
      });
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

router.post("/update-itemlist/:id_itemList", authMiddleware, async (req, res) => {
  const { id_itemList } = req.params;
  const { quantity, quantity_delta, purchased_quantity, check_take, status, clientMutationId } = req.body;
  try {
    const mutationId = mutationKey(clientMutationId);
    const result = await shoppingTransaction(async tx => {
      const itemList = await getAccessibleItemList(req.user?.id, id_itemList, {
        select: { id: true, item_id: true, list_id: true, quantity: true, purchased_quantity: true, check_take: true, status: true }, tx,
      });
      if (!itemList) throw new ShoppingStateError("No tienes permisos para modificar este producto.", 403);
      const replay = await replayMutation(tx, { listId: itemList.list_id, mutationId, userId: req.user.id, select: itemListSelect });
      if (replay) return { itemList: replay, changed: false, reused: true };
      const next = shoppingState(itemList, { quantity, quantity_delta, purchased_quantity, check_take, status });
      const data = Object.fromEntries(Object.entries(next).filter(([key, value]) => itemList[key] !== value));
      const updated = Object.keys(data).length
        ? await tx.itemList.update({ where: { id: itemList.id }, data, select: itemListSelect })
        : await tx.itemList.findUnique({ where: { id: itemList.id }, select: itemListSelect });
      await recordMutation(tx, { listId: itemList.list_id, mutationId, userId: req.user.id, rowId: updated.id, operation: quantity_delta === undefined ? "update" : "increment" });
      return { itemList: updated, changed: Boolean(Object.keys(data).length), reused: false };
    });
    if (result.changed || clientMutationId) emitToList(req, result.itemList.list_id, "itemlist:updated", { ...result.itemList, clientMutationId });
    res.json({ message: "Producto actualizado correctamente", itemList: result.itemList, reused: result.reused, clientMutationId });
  } catch (error) {
    if (error instanceof ShoppingStateError) return res.status(error.status).json({ success: false, message: error.message });
    console.error(error);
    res.status(500).json({ success: false, message: "No se pudo actualizar el producto. Se conservan tus datos." });
  }
});

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

      const itemList = await getAccessibleItemList(req.user?.id, id_itemList, {
        select: {
          id: true,
          list_id: true,
        },
      });

      if (!itemList) {
        const existingItemList = await prisma.itemList.findUnique({
          where: { id: id_itemList },
          select: { id: true },
        });

        if (existingItemList) {
          return res.status(403).json({
            message: "No tienes permisos para eliminar este producto",
          });
        }

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

    const list = await getAccessibleList(req.user?.id, id_list);

    if (!list) {
      return res.status(403).json({
        message: "No tienes permisos para eliminar esta lista",
      });
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
    const list = await getAccessibleList(req.user?.id, id_list);

    if (!list) {
      return res.status(403).json({
        message: "No tienes permisos para consultar esta lista",
      });
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
    const home = await getAccessibleHome(req.user?.id, id_home);

    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para consultar este hogar",
      });
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

    const home = await getAccessibleHome(req.user?.id, id_home, {
      select: {
        id: true,
        name: true,
        image: true,
        is_tutorial: true,
        createdAt: true,
        updatedAt: true,
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
      return res.status(403).json({
        message: "No tienes permisos para consultar este hogar",
      });
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

    const listAccess = await getAccessibleListInHome(req.user?.id, id_home, id_list, {
      select: {
        id: true,
      },
    });

    if (!listAccess) {
      return res.status(403).json({
        message: "No tienes permisos para consultar esta lista",
      });
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
