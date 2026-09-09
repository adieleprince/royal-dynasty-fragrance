import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env")
});

console.log(
  "RESEND CREDENTIALS:",
  process.env.RESEND_API_KEY ? "LOADED ✅" : "MISSING ❌"
);

if (!process.env.RESEND_API_KEY) {
  console.warn(
    "⚠️  RESEND_API_KEY is not set — emails will fail to send. " +
    "Get a key at resend.com/api-keys and set it in .env."
  );
}

// Sends over HTTPS (port 443), not SMTP ports 25/465/587 — this is what
// lets email work on Render's free tier, which blocks outbound SMTP.
const resend = new Resend(process.env.RESEND_API_KEY);

// Resend's shared test sender (onboarding@resend.dev) works immediately
// with no setup, but will only deliver to the email address on your
// Resend account. Once you verify a domain in the Resend dashboard, set
// EMAIL_FROM to an address on that domain (e.g. "Royal Dynasty
// Fragrance <orders@yourdomain.com>") to send to any customer.
const EMAIL_FROM = process.env.EMAIL_FROM || "Royal Dynasty Fragrance <onboarding@resend.dev>";

// Admin email for receiving copies
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "royaldynastyfragrances@gmail.com";

// =========================================
// SEND A SINGLE EMAIL (no admin copy)
// Used for anything that isn't an order notification — e.g. subscriber
// broadcasts, where cc'ing the admin on every single recipient send
// would flood their inbox.
// =========================================
export const sendEmail = async ({ to, subject, html }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html
    });

    if (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message || error);
      return { success: false, error: error.message || String(error) };
    }

    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

// =========================================
// SEND ORDER EMAIL (customer + admin copy)
// =========================================
export const sendOrderEmail = async ({ to, subject, html, adminSubject }) => {
  const results = [];

  // Send to customer
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: to,
      subject: subject,
      html: html
    });

    if (error) throw new Error(error.message || String(error));

    results.push({ type: 'customer', success: true, messageId: data?.id });
    console.log(`✅ Customer email sent to: ${to}`);
  } catch (error) {
    console.error(`❌ Failed to send to customer ${to}:`, error.message);
    results.push({ type: 'customer', success: false, error: error.message });
  }

  // Send copy to admin
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_EMAIL,
      subject: adminSubject || `[ADMIN COPY] ${subject}`,
      html: html
    });

    if (error) throw new Error(error.message || String(error));

    results.push({ type: 'admin', success: true, messageId: data?.id });
    console.log(`✅ Admin copy sent to: ${ADMIN_EMAIL}`);
  } catch (error) {
    console.error(`❌ Failed to send admin copy:`, error.message);
    results.push({ type: 'admin', success: false, error: error.message });
  }

  return results;
};

export default resend;