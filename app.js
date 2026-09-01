require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const PORT = 3000;
const router = require("./router");
const methodOverride = require("method-override");
const corsConfig = require('./config/corsConfig')
const cloudinary = require('cloudinary').v2;
const prisma = require("./prisma/prisma");
const jwt = require("jsonwebtoken");
const { getAccessibleList } = require("./utils/permissions");
const { getAllowedGoogleClientIds } = require("./utils/googleAuth");
const {
  globalApiRateLimiter,
  socketConnectionRateLimiter,
  socketEventRateLimiter,
} = require("./middleware/rateLimit");
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsConfig,
});

app.set("io", io);

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
} else if (/^\d+$/.test(process.env.TRUST_PROXY || "")) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsConfig));
app.use(globalApiRateLimiter);


cloudinary.config({ 
  cloud_name: process.env.NAME_CLOUDINARY, 
  api_key: process.env.API_KEY_CLOUDINARY, 
  api_secret: process.env.API_SECRET_CLOUDINARY
});


app.use(methodOverride("_method"));

app.use("/", router);

io.use((socket, next) => {
  const connectionAllowance = socketConnectionRateLimiter(socket);
  if (!connectionAllowance.allowed) {
    return next(
      new Error(
        `Demasiadas conexiones. Reintenta en ${connectionAllowance.retryAfterSeconds} segundos.`
      )
    );
  }

  const authToken = socket.handshake.auth?.token;
  const headerToken = socket.handshake.headers?.authorization?.split(" ")[1];
  const token = authToken || headerToken;

  if (!token) {
    return next(new Error("No se proporcionó token de autenticación"));
  }

  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return next(new Error("Token inválido o expirado"));
  }
});

io.on("connection", (socket) => {
  const allowEvent = (eventName) => {
    const allowance = socketEventRateLimiter(socket, eventName);
    if (allowance.allowed) return true;

    socket.emit("rate-limit", {
      event: eventName,
      message: "Demasiadas acciones en tiempo real. Espera unos minutos.",
      retry_after_seconds: allowance.retryAfterSeconds,
    });
    return false;
  };

  socket.on("list:join", async ({ list_id } = {}) => {
    if (!allowEvent("list:join")) return;
    if (!list_id) return;

    try {
      const list = await getAccessibleList(socket.user?.id, list_id, {
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
                  is_recurring: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      });

      if (!list) {
        socket.emit("list:error", {
          list_id,
          message: "No tienes permisos para sincronizar esta lista",
        });
        return;
      }

      socket.join(`list:${list_id}`);

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
    if (!allowEvent("list:leave")) return;
    if (!list_id) return;
    socket.leave(`list:${list_id}`);
  });
});

server.listen(PORT, '0.0.0.0',() => {
  console.log(
    `El servidor esta activo y esta escuchando por el puerto ${PORT}`
  );
  console.log(
    `Google Sign-In: ${getAllowedGoogleClientIds().length > 0 ? "configurado" : "no configurado"}`
  );
});
