const express = require("express");
const router = express.Router();

const auth = require("./auth");
const home = require("./home");
const list = require("./list");
const item = require("./item");

router.use("/home", home);
router.use("/list", list);
router.use("/item", item);
router.use("/", auth);

module.exports = router;