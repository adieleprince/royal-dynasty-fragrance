import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  "Royal Dynasty Fragrance <onboarding@resend.dev>";

export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "royaldynastyfragrances@gmail.com";

export const sendEmail = async ({ to, subject, html }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html
    });

    if (error) {
      throw new Error(error.message);
    }

    return { success: true, messageId: data.id };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

export const sendOrderEmail = async ({
  to,
  subject,
  html,
  adminSubject
}) => {
  const results = [];

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html
    });

    if (error) {
      throw new Error(error.message);
    }

    results.push({
      type: "customer",
      success: true,
      messageId: data.id
    });

    console.log(`✅ Customer email sent to: ${to}`);
  } catch (error) {
    console.error(`❌ Failed to send to customer ${to}:`, error.message);

    results.push({
      type: "customer",
      success: false,
      error: error.message
    });
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_EMAIL,
      subject: adminSubject || `[ADMIN COPY] ${subject}`,
      html
    });

    if (error) {
      throw new Error(error.message);
    }

    results.push({
      type: "admin",
      success: true,
      messageId: data.id
    });

    console.log(`✅ Admin copy sent to: ${ADMIN_EMAIL}`);
  } catch (error) {
    console.error(`❌ Failed to send admin copy:`, error.message);

    results.push({
      type: "admin",
      success: false,
      error: error.message
    });
  }

  return results;
};

export default resend;