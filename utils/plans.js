const prisma = require("../prisma/prisma");

const USER_PLAN = {
  FREE: "FREE",
  PREMIUM: "PREMIUM",
  APP_OWNER: "APP_OWNER",
};

const DEFAULT_PREMIUM_HOME_SLOTS = 2;

const HOME_LIMITS = {
  FREE: {
    plan: USER_PLAN.FREE,
    maxMembers: 4,
    maxProductImages: 50,
    autoImageImportEnabled: false,
    maxAutoImageLookupsPerRequest: 0,
  },
  PREMIUM: {
    plan: USER_PLAN.PREMIUM,
    maxMembers: 8,
    maxProductImages: 500,
    autoImageImportEnabled: true,
    maxAutoImageLookupsPerRequest: 60,
  },
  APP_OWNER: {
    plan: USER_PLAN.APP_OWNER,
    maxMembers: 8,
    maxProductImages: 5000,
    autoImageImportEnabled: true,
    maxAutoImageLookupsPerRequest: 200,
  },
};

const isFutureDate = (value, now = new Date()) =>
  !value || new Date(value).getTime() > now.getTime();

const getEffectiveUserPlan = (user, now = new Date()) => {
  if (!user) return USER_PLAN.FREE;
  if (user.plan === USER_PLAN.APP_OWNER) return USER_PLAN.APP_OWNER;

  if (user.plan === USER_PLAN.PREMIUM && isFutureDate(user.premium_expires_at, now)) {
    return USER_PLAN.PREMIUM;
  }

  return USER_PLAN.FREE;
};

const getPremiumHomeSlots = (user) => {
  const plan = getEffectiveUserPlan(user);

  if (plan === USER_PLAN.APP_OWNER) return Number.POSITIVE_INFINITY;
  if (plan !== USER_PLAN.PREMIUM) return 0;

  return Math.max(Number(user.premium_home_slots) || DEFAULT_PREMIUM_HOME_SLOTS, 1);
};

const getHomePlan = async (homeId, { tx = prisma, now = new Date() } = {}) => {
  if (!homeId) return USER_PLAN.FREE;

  const home = await tx.home.findUnique({
    where: { id: homeId },
    select: {
      id: true,
      is_tutorial: true,
      premium_ends_at: true,
      premiumAssignedBy: {
        select: {
          id: true,
          plan: true,
          premium_home_slots: true,
          premium_expires_at: true,
        },
      },
    },
  });

  if (
    !home ||
    home.is_tutorial ||
    !home.premiumAssignedBy ||
    !isFutureDate(home.premium_ends_at, now)
  ) {
    return USER_PLAN.FREE;
  }

  const assignedByPlan = getEffectiveUserPlan(home.premiumAssignedBy, now);
  if (assignedByPlan === USER_PLAN.APP_OWNER) return USER_PLAN.APP_OWNER;
  if (assignedByPlan === USER_PLAN.PREMIUM) {
    const slots = getPremiumHomeSlots(home.premiumAssignedBy);
    const assignedHomes = await tx.home.findMany({
      where: {
        is_tutorial: false,
        premium_assigned_by_user_id: home.premiumAssignedBy.id,
        OR: [{ premium_ends_at: null }, { premium_ends_at: { gt: now } }],
      },
      orderBy: [{ premium_assigned_at: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
      },
      take: slots,
    });

    return assignedHomes.some((assignedHome) => assignedHome.id === home.id)
      ? USER_PLAN.PREMIUM
      : USER_PLAN.FREE;
  }

  return USER_PLAN.FREE;
};

const getHomeLimits = async (homeId, options = {}) => {
  const plan = await getHomePlan(homeId, options);
  return HOME_LIMITS[plan] || HOME_LIMITS.FREE;
};

const countHomeProductImages = async (homeId, { tx = prisma } = {}) => {
  if (!homeId) return 0;

  return tx.item.count({
    where: {
      home_id: homeId,
      AND: [{ image: { not: null } }, { image: { not: "" } }],
    },
  });
};

const getHomeProductImageUsage = async (homeId, options = {}) => {
  const [limits, usedProductImages] = await Promise.all([
    getHomeLimits(homeId, options),
    countHomeProductImages(homeId, options),
  ]);
  const availableProductImages = Math.max(
    limits.maxProductImages - usedProductImages,
    0
  );

  return {
    ...limits,
    usedProductImages,
    availableProductImages,
  };
};

const canAddProductImages = async (homeId, imagesToAdd = 1, options = {}) => {
  const usage = await getHomeProductImageUsage(homeId, options);
  const requestedImages = Math.max(Number(imagesToAdd) || 0, 0);

  return {
    ...usage,
    requestedImages,
    allowed: requestedImages <= usage.availableProductImages,
  };
};

module.exports = {
  USER_PLAN,
  DEFAULT_PREMIUM_HOME_SLOTS,
  HOME_LIMITS,
  getEffectiveUserPlan,
  getPremiumHomeSlots,
  getHomePlan,
  getHomeLimits,
  countHomeProductImages,
  getHomeProductImageUsage,
  canAddProductImages,
};
