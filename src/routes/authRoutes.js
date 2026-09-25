import express from "express";
import { authController } from "../controllers/authController.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

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
router.get("/brand-kit", requireAuth, authController.getBrandKit);
router.put("/brand-kit", requireAuth, authController.updateBrandKit);
router.get("/credits", requireAuth, authController.getCredits);

router.get("/admin/stats", requireAuth, requireAdmin, authController.getAdminStats);
router.get("/admin/users", requireAuth, requireAdmin, authController.getAdminUsers);
router.patch("/admin/users/:userId", requireAuth, requireAdmin, authController.updateAdminUser);
router.delete("/admin/users/:userId", requireAuth, requireAdmin, authController.deleteAdminUser);
router.get("/admin/templates", requireAuth, requireAdmin, authController.getAdminTemplates);
router.post("/admin/templates", requireAuth, requireAdmin, authController.createAdminTemplate);
router.delete("/admin/templates/:templateId", requireAuth, requireAdmin, authController.deleteAdminTemplate);
router.get("/templates", requireAuth, authController.getAdminTemplates);

export default router;
