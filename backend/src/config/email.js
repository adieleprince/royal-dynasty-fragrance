const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "royaldynastyfragrances@gmail.com";

const EMAIL_FROM = process.env.EMAIL_FROM || ADMIN_EMAIL;

const EMAIL_SENDER_NAME =
  process.env.EMAIL_SENDER_NAME || "Royal Dynasty Fragrance";

const sendWithBrevo = async ({ to, subject, html }) => {
  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        name: EMAIL_SENDER_NAME,
        email: EMAIL_FROM
      },
      replyTo: {
        name: EMAIL_SENDER_NAME,
        email: EMAIL_FROM
      },
      to: [
        {
          email: to
        }
      ],
      subject,
      htmlContent: html
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.message || `Brevo email request failed (${response.status})`
    );
  }

  return result.messageId;
};

export const sendEmail = async ({ to, subject, html }) => {
  try {
    const messageId = await sendWithBrevo({ to, subject, html });

    return {
      success: true,
      messageId
    };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);

    return {
      success: false,
      error: error.message
    };
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
    const messageId = await sendWithBrevo({ to, subject, html });

    results.push({
      type: "customer",
      success: true,
      messageId
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
    const messageId = await sendWithBrevo({
      to: ADMIN_EMAIL,
      subject: adminSubject || `[ADMIN COPY] ${subject}`,
      html
    });

    results.push({
      type: "admin",
      success: true,
      messageId
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