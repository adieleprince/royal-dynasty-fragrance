import express from "express";
import { ADMIN_EMAIL, sendEmail } from "../config/email.js";
import {
  authenticate,
  requireAdmin
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", authenticate, requireAdmin, async (req, res) => {
  const result = await sendEmail({
    to: ADMIN_EMAIL,
    subject: "Royal Dynasty Email Test",
    html: "<p>Your Royal Dynasty email system is working successfully!</p>"
  });

  if (!result.success) {
    return res.status(500).json({
      message: "Failed to send test email",
      error: result.error
    });
  }

  return res.status(200).json({
    message: "Test email sent successfully",
    emailId: result.messageId
  });
});

export default router;