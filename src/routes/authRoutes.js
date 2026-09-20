import express from "express";
import { authController } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public auth routes
router.post("/signup", authController.signup);
router.get("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerification);
router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Protected routes (require JWT)
router.get("/me", requireAuth, authController.getMe);
router.get("/credits", requireAuth, authController.getCredits);

export default router;
