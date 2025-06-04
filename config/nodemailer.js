const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
    service: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GOOGLE_MAIL,
      pass: process.env.GOOGLE_APP_PASSWORD,
    },
  });

  module.exports = transporter;