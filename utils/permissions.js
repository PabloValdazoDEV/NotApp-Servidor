const prisma = require("../prisma/prisma");

const HOME_MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER"];
const HOME_ADMIN_ROLES = ["OWNER", "ADMIN"];

const buildHomeMemberFilter = (userId, roles) => {
  if (!userId) return null;

  return {
    user_id: userId,
    ...(Array.isArray(roles) && roles.length > 0
      ? {
          role: {
            in: roles,
          },
        }
      : {}),
  };
};

const getHomeMember = async (
  userId,
  homeId,
  { roles, select = { id: true, role: true }, tx = prisma } = {}
) => {
  const memberFilter = buildHomeMemberFilter(userId, roles);
  if (!memberFilter || !homeId) return null;

  return tx.member.findFirst({
    where: {
      ...memberFilter,
      home_id: homeId,
    },
    select,
  });
};

const hasHomeAccess = async (userId, homeId, roles, tx = prisma) =>
  Boolean(await getHomeMember(userId, homeId, { roles, tx }));

const getAccessibleHome = async (
  userId,
  homeId,
  { roles, select = { id: true }, tx = prisma } = {}
) => {
  const memberFilter = buildHomeMemberFilter(userId, roles);
  if (!memberFilter || !homeId) return null;

  return tx.home.findFirst({
    where: {
      id: homeId,
      members: {
        some: memberFilter,
      },
    },
    select,
  });
};

const getAccessibleList = async (
  userId,
  listId,
  { roles, select = { id: true, home_id: true }, tx = prisma } = {}
) => {
  const memberFilter = buildHomeMemberFilter(userId, roles);
  if (!memberFilter || !listId) return null;

  return tx.list.findFirst({
    where: {
      id: listId,
      home: {
        members: {
          some: memberFilter,
        },
      },
    },
    select,
  });
};

const getAccessibleListInHome = async (
  userId,
  homeId,
  listId,
  { roles, select = { id: true, home_id: true }, tx = prisma } = {}
) => {
  const memberFilter = buildHomeMemberFilter(userId, roles);
  if (!memberFilter || !homeId || !listId) return null;

  return tx.list.findFirst({
    where: {
      id: listId,
      home_id: homeId,
      home: {
        members: {
          some: memberFilter,
        },
      },
    },
    select,
  });
};

const getAccessibleItemList = async (
  userId,
  itemListId,
  { roles, select = { id: true, list_id: true }, tx = prisma } = {}
) => {
  const memberFilter = buildHomeMemberFilter(userId, roles);
  if (!memberFilter || !itemListId) return null;

  return tx.itemList.findFirst({
    where: {
      id: itemListId,
      list: {
        home: {
          members: {
            some: memberFilter,
          },
        },
      },
    },
    select,
  });
};

module.exports = {
  HOME_ADMIN_ROLES,
  HOME_MEMBER_ROLES,
  getHomeMember,
  hasHomeAccess,
  getAccessibleHome,
  getAccessibleList,
  getAccessibleListInHome,
  getAccessibleItemList,
};
