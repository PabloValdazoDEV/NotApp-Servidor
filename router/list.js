const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;

// router.post(
//   "/create-list",
//   authMiddleware,
//   upload.single("file"),
//   async (req, res) => {
//     const { hogar_id, name, items } = req.body;
//     try {
//         if (!hogar_id || name) {
//             return res.status(400).json({ message: "Faltan datos" });
//           }
//           const hogar = await prisma.home.findUnique({ where: { id: hogar_id } });
      
//           if (!hogar) {
//             return res.status(400).json({ message: "El hogar no existe" });
//           }
      
//           if(hogar.image){
//               cloudinary.uploader.destroy(hogar.image);
//           }

//           const cleanedName = name?.trim();
//     } catch (error) {
//       console.error(error);
//       res.status(500).json({ message: "Server error" });
//     }
//   }
// );

module.exports = router;
