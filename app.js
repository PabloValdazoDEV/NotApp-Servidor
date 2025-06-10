const express = require("express");
const cors = require("cors");
const app = express();
const PORT = 3000;
const router = require("./router");
const methodOverride = require("method-override");
const corsConfig = require('./config/corsConfig')
require("dotenv").config();
const cloudinary = require('cloudinary').v2;

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

app.listen(PORT, () => {
  console.log(
    `El servidor esta activo y esta escuchando por el puerto ${PORT}`
  );
});