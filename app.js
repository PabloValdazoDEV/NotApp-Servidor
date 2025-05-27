const express = require("express");
const cors = require("cors");
const app = express();
const PORT = 3000;
const router = require("./router");
const methodOverride = require("method-override");
// const corsConfig = require('./config/corsConfig')

require("dotenv").config();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(cors(corsConfig));
// app.options("*", cors(corsConfig))

app.use(methodOverride("_method"));

app.use("/", router);

app.listen(PORT, () => {
  console.log(
    `El servidor esta activo y esta escuchando por el puerto ${PORT}`
  );
});