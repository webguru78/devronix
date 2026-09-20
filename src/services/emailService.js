import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/**
 * Configure Nodemailer SMTP Transporter
 * Supports Gmail Service, Custom SMTP, or falls back to development console
 */
function createTransporter() {
  const service = process.env.SMTP_SERVICE;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!user || !pass) {
    console.warn(
      "[Email Service Warning]: SMTP_USER or SMTP_PASS not set. Emails will be logged to console.",
    );
    return null;
  }

  // If explicit SMTP_SERVICE=gmail and no custom host provided, use gmail service
  if (
    service &&
    service.toLowerCase() === "gmail" &&
    (!process.env.SMTP_HOST || process.env.SMTP_HOST === "smtp.gmail.com")
  ) {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: port || 587,
      secure: secure,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

const transporter = createTransporter();

/**
 * Reusable minimal Black & White email HTML wrapper matching Verbatim AI brand
 */
function getHtmlTemplate({
  title,
  preheader,
  contentHtml,
  buttonText,
  buttonUrl,
  footerNote,
}) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 0; background-color: #0A0A0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF; }
      .wrapper { max-width: 580px; margin: 0 auto; padding: 40px 20px; }
      .card { background-color: #121216; border: 1px solid #27272F; border-radius: 16px; padding: 36px 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); }
      .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
      .brand-title { font-size: 18px; font-weight: 800; letter-spacing: 0.05em; color: #FFFFFF; text-transform: uppercase; }
      .brand-sub { font-weight: 400; opacity: 0.6; }
      .title { font-size: 22px; font-weight: 700; color: #FFFFFF; margin: 0 0 16px 0; letter-spacing: -0.02em; }
      .paragraph { font-size: 15px; line-height: 1.6; color: #A1A1AA; margin: 0 0 24px 0; }
      .btn-container { text-align: center; margin: 32px 0; }
      .btn { display: inline-block; background-color: #FFFFFF; color: #000000 !important; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 32px; border-radius: 9999px; letter-spacing: -0.01em; }
      .link-box { background-color: #18181F; border: 1px solid #2A2A35; border-radius: 8px; padding: 12px; font-size: 12px; color: #71717A; word-break: break-all; margin-top: 20px; }
      .footer { margin-top: 32px; text-align: center; font-size: 12px; color: #71717A; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="brand">
          <div style="background:#000;border:1px solid #333;width:32px;height:32px;border-radius:8px;display:inline-block;vertical-align:middle;text-align:center;line-height:30px;color:#fff;font-weight:900;font-size:16px;">V</div>
          <span class="brand-title">VERBATIM<span class="brand-sub">.AI</span></span>
        </div>
        
        <h1 class="title">${title}</h1>
        <div class="paragraph">
          ${contentHtml}
        </div>

        ${
          buttonText && buttonUrl
            ? `
          <div class="btn-container">
            <a href="${buttonUrl}" target="_blank" class="btn">${buttonText} &rarr;</a>
          </div>
          <div class="link-box">
            If the button above does not work, copy and paste this URL into your browser:<br/>
            <a href="${buttonUrl}" style="color:#A1A1AA;text-decoration:none;">${buttonUrl}</a>
          </div>
        `
            : ""
        }

        ${
          footerNote
            ? `<div class="paragraph" style="margin-top:24px;font-size:13px;color:#71717A;">${footerNote}</div>`
            : ""
        }
      </div>

      <div class="footer">
        &copy; ${new Date().getFullYear()} Verbatim AI. All rights reserved.<br/>
        Ultra-fast AI video captions and viral short clip generation engine.
      </div>
    </div>
  </body>
  </html>
  `;
}

/**
 * Universal email dispatcher
 */
export async function sendEmail({ to, subject, html, text }) {
  let from = process.env.EMAIL_FROM || "info@devronix.agency";
  // If user passed a simple email like info@devronix.agency, format with nice display name safely in JS:
  if (from && !from.includes("<")) {
    from = `"Verbatim AI" <${from.trim()}>`;
  }

  if (!transporter) {
    console.log(`\n================= [DEV EMAIL LOG] =================`);
    console.log(`TO: ${to}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(`TEXT: ${text}`);
    console.log(`====================================================\n`);
    return { success: true, simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || "",
      html,
    });
    console.log(
      `[Email Service]: Sent "${subject}" to ${to} (MessageId: ${info.messageId})`,
    );
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(
      `[Email Service Error]: Failed to send to ${to}:`,
      err.message,
    );
    throw err;
  }
}

export const emailService = {
  /**
   * Send Account Verification Email with unique token link
   */
  async sendVerificationEmail(user, token) {
    const baseUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(
      /\/$/,
      "",
    );
    const verificationUrl = `${baseUrl}/verify-email?token=${token}`;

    const html = getHtmlTemplate({
      title: "Verify your email address",
      contentHtml: `
        Hello <strong>${user.name || "Creator"}</strong>,<br/><br/>
        Welcome to <strong>Verbatim AI</strong>! To activate your account and start generating viral captions and short clips with your free credits, please verify your email address.
      `,
      buttonText: "Verify Email & Activate Account",
      buttonUrl: verificationUrl,
      footerNote:
        "This verification link will expire in 24 hours. If you did not create a Verbatim AI account, please disregard this message.",
    });

    return await sendEmail({
      to: user.email,
      subject: "Verify your email — Verbatim AI",
      text: `Hello ${user.name},\n\nPlease verify your email by clicking the following link:\n${verificationUrl}\n\nThis link will expire in 24 hours.`,
      html,
    });
  },

  /**
   * Send Password Reset Email
   */
  async sendPasswordResetEmail(user, token) {
    const baseUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(
      /\/$/,
      "",
    );
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const html = getHtmlTemplate({
      title: "Reset your password",
      contentHtml: `
        Hello <strong>${user.name || "Creator"}</strong>,<br/><br/>
        We received a request to reset the password for your Verbatim AI account. Click the button below to choose a new password.
      `,
      buttonText: "Reset My Password",
      buttonUrl: resetUrl,
      footerNote:
        "This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email — your account remains secure.",
    });

    return await sendEmail({
      to: user.email,
      subject: "Reset your password — Verbatim AI",
      text: `Hello ${user.name},\n\nYou requested a password reset. Use this link:\n${resetUrl}\n\nThis link expires in 1 hour.`,
      html,
    });
  },
};
