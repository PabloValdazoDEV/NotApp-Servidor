const fs = require("fs");
const path = require("path");

const logoPath = path.join(__dirname, "..", "public", "email", "logo.png");
const headerPath = path.join(__dirname, "..", "public", "email", "header.png");

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const renderEmail = ({ preheader, eyebrow, title, body, buttonText, link }) => {
  const safePreheader = escapeHtml(preheader);
  const safeEyebrow = escapeHtml(eyebrow);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeButtonText = escapeHtml(buttonText);
  const safeLink = escapeHtml(link);
  const hasHeader = fs.existsSync(headerPath);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no">
  <title>NotApp</title>
  <style>
    @media only screen and (max-width:600px) {
      .container { width: 100% !important; }
      .shell { padding: 18px 12px !important; }
      .content { padding: 30px 24px 34px !important; }
      .title { font-size: 28px !important; line-height: 34px !important; }
      .hero { height: auto !important; }
      .button { display: block !important; }
    }
  </style>
</head>
<body style="Margin:0;padding:0;background-color:#f3f4f6;font-family:Inter, Arial, Helvetica, sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;border-spacing:0;">
    <tr>
      <td class="shell" align="center" style="padding:32px 12px;">
        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;border-spacing:0;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 28px rgba(15,23,42,0.08);">
          <tr>
            <td align="left" style="background-color:#ffffff;padding:28px 34px 20px;">
              <img src="cid:notapp_logo" width="142" alt="NotApp" style="display:block;border:0;outline:none;text-decoration:none;width:142px;height:auto;">
            </td>
          </tr>
          ${
            hasHeader
              ? `<tr><td align="center" style="padding:0 34px 8px;"><img class="hero" src="cid:notapp_header" width="532" alt="" style="display:block;width:532px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;"></td></tr>`
              : ""
          }
          <tr>
            <td class="content" align="left" style="padding:34px 46px 42px;">
              <p style="Margin:0 0 14px;color:#3b82f6;font-size:14px;line-height:20px;font-weight:700;">${safeEyebrow}</p>
              <h1 class="title" style="Margin:0;color:#111827;font-size:34px;line-height:40px;font-weight:800;letter-spacing:0;">${safeTitle}</h1>
              <p style="Margin:18px 0 28px;color:#4b5563;font-size:16px;line-height:25px;">${safeBody}</p>
              <a class="button" href="${safeLink}" target="_blank" style="background-color:#3b82f6;border-radius:10px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;line-height:20px;padding:14px 24px;text-decoration:none;min-width:176px;text-align:center;">${safeButtonText}</a>
              <p style="Margin:28px 0 0;color:#6b7280;font-size:13px;line-height:20px;">Si el boton no funciona, copia este enlace en tu navegador:<br><a href="${safeLink}" target="_blank" style="color:#3b82f6;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeLink}</a></p>
            </td>
          </tr>
          <tr>
            <td align="left" style="background-color:#f9fafb;padding:22px 34px;color:#6b7280;font-size:12px;line-height:18px;border-top:1px solid #eef2f7;">
              NotApp - Email automatico. Si no esperabas este mensaje, puedes ignorarlo.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const getEmailAttachments = () => {
  const attachments = [
    {
      filename: "notapp-logo.png",
      path: logoPath,
      cid: "notapp_logo",
    },
  ];

  if (fs.existsSync(headerPath)) {
    attachments.push({
      filename: "notapp-header.png",
      path: headerPath,
      cid: "notapp_header",
    });
  }

  return attachments;
};

module.exports = {
  renderEmail,
  getEmailAttachments,
};
