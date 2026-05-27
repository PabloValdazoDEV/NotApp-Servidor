const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const PORT = 3000;
const router = require("./router");
const methodOverride = require("method-override");
const corsConfig = require('./config/corsConfig')
require("dotenv").config();
const cloudinary = require('cloudinary').v2;
const prisma = require("./prisma/prisma");
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsConfig,
});

app.set("io", io);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsConfig));


cloudinary.config({ 
  cloud_name: process.env.NAME_CLOUDINARY, 
  api_key: process.env.API_KEY_CLOUDINARY, 
  api_secret: process.env.API_SECRET_CLOUDINARY
});


app.use(methodOverride("_method"));

app.use("/", router);

io.on("connection", (socket) => {
  socket.on("list:join", async ({ list_id } = {}) => {
    if (!list_id) return;

    socket.join(`list:${list_id}`);

    try {
      const list = await prisma.list.findUnique({
        where: { id: list_id },
        select: {
          id: true,
          title: true,
          home_id: true,
          fav: true,
          listCheck: true,
          updatedAt: true,
          createdAt: true,
          copied_from_not_found_list_id: true,
          itemsList: {
            orderBy: {
              item: { name: "asc" },
            },
            select: {
              id: true,
              item_id: true,
              list_id: true,
              quantity: true,
              purchased_quantity: true,
              check_take: true,
              status: true,
              updatedAt: true,
              item: {
                select: {
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
                },
              },
            },
          },
        },
      });

      const notFoundCopyList = list
        ? await prisma.list.findFirst({
            where: {
              copied_from_not_found_list_id: list.id,
            },
            select: {
              id: true,
            },
          })
        : null;
      const notFoundCopyListId = notFoundCopyList?.id || null;
      const syncedList = list
        ? {
            ...list,
            not_found_copy_list_id: notFoundCopyListId,
            has_not_found_copy: Boolean(notFoundCopyListId),
          }
        : null;

      socket.emit("list:sync", {
        list_id,
        list: syncedList,
        items: list?.itemsList || [],
      });
    } catch (error) {
      console.error(error);
    }
  });

  socket.on("list:leave", ({ list_id } = {}) => {
    if (!list_id) return;
    socket.leave(`list:${list_id}`);
  });
});

server.listen(PORT, '0.0.0.0',() => {
  console.log(
    `El servidor esta activo y esta escuchando por el puerto ${PORT}`
  );
});
