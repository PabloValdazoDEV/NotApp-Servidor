const express = require("express");
const router = express.Router();

const auth = require("./auth");
const home = require("./home");
const list = require("./list");
const item = require("./item");
const member = require("./member");
const profile = require("./profile");
const onboarding = require("./onboarding");

router.use("/home", home);
router.use("/member", member);
router.use("/list", list);
router.use("/item", item);
router.use("/profile", profile);
router.use("/onboarding", onboarding);
router.use("/", auth);

module.exports = router;
