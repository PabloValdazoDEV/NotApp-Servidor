const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");

const CURRENT_ONBOARDING_VERSION = 2;

const tutorialHomeSelect = {
  id: true,
  lists: {
    orderBy: {
      createdAt: "asc",
    },
    take: 1,
    select: {
      id: true,
    },
  },
};

const getTutorialListId = (home) => home?.lists?.[0]?.id || null;

const tutorialItems = [
  {
    name: "Leche",
    description: "Producto de ejemplo para aprender a crear una lista.",
    categories: ["LACTEOS"],
    price: "1.25",
    quantity: 1,
  },
  {
    name: "Pan integral",
    description: "Otro producto de prueba del tutorial.",
    categories: ["PANADERIA"],
    price: "1.80",
    quantity: 2,
  },
  {
    name: "Manzanas",
    description: "Ejemplo de fruta para practicar categorías.",
    categories: ["FRUTAS_VERDURAS"],
    price: "2.50",
    quantity: 6,
  },
  {
    name: "Papel higiénico",
    description: "Producto de higiene para una compra de ejemplo.",
    categories: ["HIGIENE"],
    price: "3.95",
    quantity: 1,
  },
];

const getAuthenticatedUserId = (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ success: false, message: "Usuario no autenticado" });
    return null;
  }

  return userId;
};

const parseOnboardingVersion = (version) => {
  const parsedVersion = Number(version);
  return Number.isInteger(parsedVersion) && parsedVersion > 0
    ? parsedVersion
    : CURRENT_ONBOARDING_VERSION;
};

const findValidTutorialHome = async (userId, homeId, tx = prisma) => {
  if (!homeId) return null;

  return tx.home.findFirst({
    where: {
      id: homeId,
      is_tutorial: true,
      members: {
        some: {
          user_id: userId,
        },
        every: {
          user_id: userId,
        },
      },
    },
    select: tutorialHomeSelect,
  });
};

const findAnyTutorialHomeForUser = async (userId, tx = prisma) =>
  tx.home.findFirst({
    where: {
      is_tutorial: true,
      members: {
        some: {
          user_id: userId,
        },
        every: {
          user_id: userId,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: tutorialHomeSelect,
  });

const ensureTutorialHomeFavorite = async (userId, homeId, tx = prisma) =>
  tx.homeFavorite.upsert({
    where: {
      user_id_home_id: {
        user_id: userId,
        home_id: homeId,
      },
    },
    update: {},
    create: {
      user_id: userId,
      home_id: homeId,
    },
  });

const createTutorialHome = async (userId, tx) => {
  const home = await tx.home.create({
    data: {
      name: "Tutorial",
      is_tutorial: true,
      members: {
        create: {
          user_id: userId,
          role: "OWNER",
        },
      },
    },
    select: {
      id: true,
    },
  });

  const list = await tx.list.create({
    data: {
      title: "Compra de ejemplo",
      home_id: home.id,
    },
    select: {
      id: true,
    },
  });

  for (const tutorialItem of tutorialItems) {
    const item = await tx.item.create({
      data: {
        name: tutorialItem.name,
        home_id: home.id,
        description: tutorialItem.description,
        price: tutorialItem.price,
        categories: tutorialItem.categories,
        supermarket: "CUALQUIERA",
      },
      select: {
        id: true,
      },
    });

    await tx.itemList.create({
      data: {
        item_id: item.id,
        list_id: list.id,
        quantity: tutorialItem.quantity,
      },
    });
  }

  return {
    ...home,
    lists: [{ id: list.id }],
  };
};

const createAndAssignTutorialHome = async (userId, tx) => {
  const newTutorialHome = await createTutorialHome(userId, tx);
  await ensureTutorialHomeFavorite(userId, newTutorialHome.id, tx);

  await tx.user.update({
    where: {
      id: userId,
    },
    data: {
      tutorial_home_id: newTutorialHome.id,
    },
  });

  return newTutorialHome;
};

const getOrCreateTutorialHome = async (userId, options = {}) =>
  prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        tutorial_home_id: true,
      },
    });

    if (!user) {
      throw new Error("Usuario no encontrado");
    }

    const validTutorialHome = await findValidTutorialHome(
      userId,
      user.tutorial_home_id,
      tx
    );

    if (validTutorialHome) {
      return { home: validTutorialHome, reused: true };
    }

    const existingTutorialHome = await findAnyTutorialHomeForUser(userId, tx);

    if (existingTutorialHome) {
      await ensureTutorialHomeFavorite(userId, existingTutorialHome.id, tx);
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          tutorial_home_id: existingTutorialHome.id,
        },
      });

      return { home: existingTutorialHome, reused: true };
    }

    const newTutorialHome = await createAndAssignTutorialHome(userId, tx);

    return { home: newTutorialHome, reused: false };
  });

const buildOnboardingResponse = async (userId) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      onboarding_completed_at: true,
      onboarding_version: true,
      tutorial_home_id: true,
      install_prompt_completed_at: true,
      install_prompt_skipped_at: true,
    },
  });

  if (!user) {
    throw new Error("Usuario no encontrado");
  }

  const tutorialHome = await findValidTutorialHome(
    userId,
    user.tutorial_home_id
  );

  if (user.tutorial_home_id && !tutorialHome) {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        tutorial_home_id: null,
      },
    });
  }

  return {
    completed: Boolean(user.onboarding_completed_at),
    completedAt: user.onboarding_completed_at,
    version: user.onboarding_version || CURRENT_ONBOARDING_VERSION,
    tutorialHomeId: tutorialHome?.id || null,
    tutorialListId: getTutorialListId(tutorialHome),
    installPromptCompletedAt: user.install_prompt_completed_at,
    installPromptSkippedAt: user.install_prompt_skipped_at,
  };
};

router.get("/me", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    const onboarding = await buildOnboardingResponse(userId);

    return res.json({
      success: true,
      onboarding,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/complete", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        onboarding_completed_at: new Date(),
        onboarding_version: parseOnboardingVersion(req.body?.version),
      },
    });

    return res.json({ success: true, message: "Tutorial completado" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/skip", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        onboarding_completed_at: new Date(),
        onboarding_version: parseOnboardingVersion(req.body?.version),
      },
    });

    return res.json({ success: true, message: "Tutorial saltado" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/tutorial-home", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    const tutorialHomeResult = await getOrCreateTutorialHome(userId, {
      recreate: req.body?.recreate === true || req.body?.recreate === "true",
    });

    return res.json({
      success: true,
      homeId: tutorialHomeResult.home.id,
      listId: getTutorialListId(tutorialHomeResult.home),
      reused: tutorialHomeResult.reused,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/install-prompt/complete", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        install_prompt_completed_at: new Date(),
      },
    });

    return res.json({
      success: true,
      message: "Paso de instalación completado",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/install-prompt/skip", authMiddleware, async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        install_prompt_skipped_at: new Date(),
      },
    });

    return res.json({
      success: true,
      message: "Paso de instalación saltado",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
