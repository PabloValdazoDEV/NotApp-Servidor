const prisma = require("../prisma/prisma");
async function shoppingTransaction(fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: "Serializable", timeout: 10000 }); }
    catch (error) {
      if (!["P2034", "P2002"].includes(error.code) || attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
}
module.exports = { shoppingTransaction };
