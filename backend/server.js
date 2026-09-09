import dotenv from "dotenv";
dotenv.config();

import connectDB from "./src/config/database.js";
import app from "./src/app.js";
import User from "./src/models/user.model.js";

const PORT = process.env.PORT || 5000;

const REQUIRED_ENV_VARS = [
  "MONGODB_URI",
  "JWT_SECRET",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_CALLBACK_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "BREVO_API_KEY"
];

const startServer = async () => {
  try {
    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error(
        `❌ Missing required environment variable(s): ${missing.join(", ")}`
      );
      console.error("Add them to backend/.env before starting the server.");
      process.exit(1);
    }

    await connectDB();

    const createAdmin = async () => {
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminEmail || !adminPassword) {
        console.warn(
          "⚠️ ADMIN_EMAIL / ADMIN_PASSWORD not set in .env — skipping automatic admin account setup."
        );
        return;
      }

      try {
        const normalizedEmail = adminEmail.toLowerCase().trim();
        const existingAdmin = await User.findOne({
          email: normalizedEmail
        });

        if (!existingAdmin) {
          const adminUsername =
            process.env.ADMIN_USERNAME || normalizedEmail.split("@")[0];

          const newAdmin = new User({
            username: adminUsername,
            email: adminEmail,
            password: adminPassword,
            isAdmin: true
          });

          await newAdmin.save();
          console.log(`✅ Admin user created: ${normalizedEmail}`);
        } else if (!existingAdmin.isAdmin) {
          existingAdmin.isAdmin = true;
          await existingAdmin.save();
          console.log(`✅ Existing account promoted to admin: ${normalizedEmail}`);
        } else {
          console.log("ℹ️ Admin user already exists. Skipping creation.");
        }
      } catch (error) {
        console.error("❌ Error creating admin user:", error);
      }
    };

    await createAdmin();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();