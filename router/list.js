const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

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
    });

    res.json({
      message: "Lista creada correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/add-item/:id_list", authMiddleware, async (req, res) => {
  const { id_item, quantity } = req.body;
  const { id_list } = req.params;
  // console.log(id_item)
  // console.log(id_list)
  try {
    if (!id_list || !id_item) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await prisma.list.findUnique({ where: { id: id_list } });

    if (!list) {
      return res.status(400).json({ message: "La lista no existe" });
    }

    await prisma.itemList.create({
      data: {
        item_id: id_item,
        list_id: id_list,
        quantity,
      },
    });

    res.json({
      message: "Producto añadido correctamente",
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

router.post("/update-itemlist/:id_itemList", authMiddleware, async (req, res) => {
  const { id_itemList } = req.params;
  const { quantity } = req.body;
  try {
    if (!id_itemList) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const itemList = await prisma.itemList.findUnique({ where: { id: id_itemList } });

    if (!itemList) {
      return res.status(400).json({ message: "El producto no existe" });
    }
    await prisma.itemList.update({
      where: {
        id: id_itemList,
      },
      data: {
        quantity: +quantity,
      },
    });
    res.json({
      message: "Producto actualizado correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/delete-itemlist/:id_itemList", authMiddleware, async (req, res) => {
  const { id_itemList } = req.params;
  try {
    if (!id_itemList) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const itemList = await prisma.itemList.findUnique({ where: { id: id_itemList } });

    if (!itemList) {
      return res.status(400).json({ message: "El producto no existe" });
    }
    await prisma.itemList.delete({
      where: {
        id: id_itemList,
      }
    });
    res.json({
      message: "Producto eliminado correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

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
      }
    });
    res.json({
      message: "Lista eliminada correctamente",
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
            id:true
          },
        },
      },
    });

    if (!home) {
      return res.status(400).json({ message: "No hay lista en el hogar" });
    }
    res.send(home);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Ver todos los porductos y sus datos de una lista

router.get("/:id_list", authMiddleware, async (req, res) => {
  const { id_list } = req.params;
  try {
    if (!id_list) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const list = await prisma.itemList.findMany({
      where: { list_id: id_list },
      orderBy: {
        item: {name: "asc"},
      },
      select: {
        quantity: true,
        item: true,
        check_take: true,
        id: true
      },
    });

    if (list.length === 0) {
      return res.status(400).json({ message: "No hay productos en la lista" });
    }
    res.send(list);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
