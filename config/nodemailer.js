const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : true,
  auth: {
    user: process.env.SMTP_USER || process.env.GOOGLE_MAIL,
    pass: process.env.SMTP_PASS || process.env.GOOGLE_APP_PASSWORD,
  },
});

module.exports = transporter;
