import nodemailer from "nodemailer";
import { config } from "../config.js";

let transporter = null;

export function isMailConfigured() {
  return Boolean(config.mail.user && config.mail.password);
}

function getTransporter() {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: config.mail.user, pass: config.mail.password }
    });
  }
  return transporter;
}

export async function sendResetCodeEmail({ to, name, code }) {
  const mailer = getTransporter();
  if (!mailer) throw new Error("Envio de email nao configurado (MAIL_USER / MAIL_APP_PASSWORD).");
  await mailer.sendMail({
    from: `"Gestao Unimed" <${config.mail.from || config.mail.user}>`,
    to,
    subject: `Codigo de recuperacao: ${code}`,
    text: [
      `Ola, ${name || "usuario"}.`,
      "",
      "Seu codigo para recuperar a senha e:",
      "",
      `   ${code}`,
      "",
      "Este codigo e valido por 10 minutos e pode ser usado uma unica vez.",
      "Se voce nao solicitou a troca de senha, ignore este email.",
      "",
      "Equipe Gestao Unimed"
    ].join("\n")
  });
}
