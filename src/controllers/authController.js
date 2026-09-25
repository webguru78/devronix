import crypto from "crypto";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { CaptionTemplate } from "../models/CaptionTemplate.js";
import { emailService } from "../services/emailService.js";

const JWT_SECRET =
  process.env.JWT_SECRET || "verbatim_ai_default_secret_fallback";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Cookie configuration options
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

/**
 * Generate a JWT token for a user
 */
function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Helper to generate a random 32-byte crypto hex token
 */
function generateCryptoToken() {
  return crypto.randomBytes(32).toString("hex");
}

const DEFAULT_BRAND_KIT = {
  name: "Creator Essentials",
  primaryColor: "#0A0A0A",
  accentColor: "#7C3AED",
  highlightColor: "#F59E0B",
  fontFamily: "Poppins",
};

function sanitizeBrandKit(brandKit = {}) {
  const safe = { ...DEFAULT_BRAND_KIT, ...brandKit };
  return {
    name: typeof safe.name === "string" && safe.name.trim() ? safe.name.trim() : DEFAULT_BRAND_KIT.name,
    primaryColor: typeof safe.primaryColor === "string" ? safe.primaryColor : DEFAULT_BRAND_KIT.primaryColor,
    accentColor: typeof safe.accentColor === "string" ? safe.accentColor : DEFAULT_BRAND_KIT.accentColor,
    highlightColor: typeof safe.highlightColor === "string" ? safe.highlightColor : DEFAULT_BRAND_KIT.highlightColor,
    fontFamily: typeof safe.fontFamily === "string" && safe.fontFamily ? safe.fontFamily : DEFAULT_BRAND_KIT.fontFamily,
  };
}

const ADMIN_EMAILS = new Set([
  "info@devronix.agency",
  "heyyusman996@gmail.com",
  "devronixagency@gmail.com",
]);

function isAdminAccount(user) {
  return (
    user?.isAdmin === true ||
    user?.plan === "admin" ||
    ADMIN_EMAILS.has(String(user?.email || "").toLowerCase())
  );
}

function serializeUser(user) {
  const safeUser = user.toJSON();
  if (isAdminAccount(user)) {
    safeUser.isAdmin = true;
    safeUser.plan = safeUser.plan === "free" ? "admin" : safeUser.plan;
  }
  return safeUser;
}

export const authController = {
  /**
   * User Signup
   * POST /api/auth/signup
   */
  async signup(req, res) {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "Please provide your name, email, and a password.",
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters long.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Check if user already exists
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        if (!existingUser.isVerified) {
          return res.status(400).json({
            success: false,
            code: "UNVERIFIED_EXISTS",
            message:
              "An account with this email already exists but is not verified yet. Please check your inbox or request a new verification email.",
            email: normalizedEmail,
          });
        }
        return res.status(400).json({
          success: false,
          message:
            "An account with this email address already exists. Please log in.",
        });
      }

      // Generate random crypto verification token (valid for 24h)
      const verificationToken = generateCryptoToken();
      const verificationTokenExpiry = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      );

      // Create new user
      const newUser = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password,
        isVerified: false,
        verificationToken,
        verificationTokenExpiry,
        lastResendAt: new Date(),
        captionCredits: { used: 0, limit: 5 },
        clipCredits: { used: 0, limit: 2 },
      });

      // Send verification email via Nodemailer
      try {
        await emailService.sendVerificationEmail(newUser, verificationToken);
      } catch (mailErr) {
        console.warn(
          "[Auth Warning]: Failed to send verification email:",
          mailErr.message,
        );
      }

      return res.status(201).json({
        success: true,
        message:
          "Registration successful! A verification link has been sent to your email.",
        user: newUser.toJSON(),
      });
    } catch (error) {
      console.error("[Auth Signup Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to register user.",
      });
    }
  },

  /**
   * Email Verification Handler
   * GET /api/auth/verify-email?token=xxx
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required.",
        });
      }

      const normalizedToken = String(token).trim();

      // Find user matching token with valid expiry, OR recently verified by this token
      let user = await User.findOne({
        verificationToken: normalizedToken,
        verificationTokenExpiry: { $gt: new Date() },
      });

      // Idempotent support: If already verified with this token (e.g. React StrictMode double-invoke or quick page refresh)
      if (!user) {
        user = await User.findOne({
          lastVerificationToken: normalizedToken,
          isVerified: true,
        });

        if (user) {
          const jwtToken = generateToken(user);
          res.cookie("token", jwtToken, COOKIE_OPTIONS);
          return res.status(200).json({
            success: true,
            message:
              "Your email is already verified! Welcome back to Verbatim AI.",
            token: jwtToken,
            user: serializeUser(user),
          });
        }

        return res.status(400).json({
          success: false,
          message:
            "Invalid or expired verification link. Please request a new verification email.",
        });
      }

      if (user.isActive === false) {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_DEACTIVATED",
          message: "This account has been deactivated. Contact support.",
        });
      }

      // Mark verified, store lastVerificationToken, and clear active verificationToken
      user.isVerified = true;
      user.lastVerificationToken = normalizedToken;
      user.verificationToken = null;
      user.verificationTokenExpiry = null;
      await user.save();

      // Issue JWT session token
      const jwtToken = generateToken(user);

      // Set httpOnly cookie
      res.cookie("token", jwtToken, COOKIE_OPTIONS);

      return res.status(200).json({
        success: true,
        message:
          "Your email has been verified successfully! Welcome to Verbatim AI.",
        token: jwtToken,
        user: serializeUser(user),
      });
    } catch (error) {
      console.error("[Auth Verify Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Email verification failed.",
      });
    }
  },

  /**
   * Resend Verification Email (Rate Limited: 60s cooldown)
   * POST /api/auth/resend-verification
   */
  async resendVerification(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required to resend verification.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        // Return success to avoid email enumeration
        return res.status(200).json({
          success: true,
          message:
            "If an unverified account exists with that email, a new verification link has been sent.",
        });
      }

      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: "This account is already verified. Please log in directly.",
        });
      }

      // Rate limit check: 60 seconds minimum cooldown
      const now = Date.now();
      if (user.lastResendAt) {
        const timeSinceLast = now - new Date(user.lastResendAt).getTime();
        const cooldownMs = 60 * 1000;
        if (timeSinceLast < cooldownMs) {
          const secondsLeft = Math.ceil((cooldownMs - timeSinceLast) / 1000);
          return res.status(429).json({
            success: false,
            message: `Please wait ${secondsLeft} seconds before requesting another email.`,
            retryAfterSeconds: secondsLeft,
          });
        }
      }

      // Generate new token & expiry
      const verificationToken = generateCryptoToken();
      user.verificationToken = verificationToken;
      user.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      user.lastResendAt = new Date();
      await user.save();

      // Dispatch verification email
      await emailService.sendVerificationEmail(user, verificationToken);

      return res.status(200).json({
        success: true,
        message: "A new verification link has been sent to your email address.",
      });
    } catch (error) {
      console.error("[Auth Resend Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to resend verification email.",
      });
    }
  },

  /**
   * User Login
   * POST /api/auth/login
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Please provide email and password.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail }).select(
        "+password",
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
      }

      if (user.isActive === false) {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_DEACTIVATED",
          message: "This account has been deactivated. Contact support.",
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
      }

      // Check verified status: unverified users cannot use paid/generate features
      if (!user.isVerified) {
        return res.status(403).json({
          success: false,
          code: "EMAIL_NOT_VERIFIED",
          isUnverified: true,
          email: user.email,
          message:
            "Please verify your email address before logging in. Check your inbox for the activation link.",
        });
      }

      // Issue JWT session token
      const jwtToken = generateToken(user);

      // Set httpOnly cookie
      res.cookie("token", jwtToken, COOKIE_OPTIONS);

      return res.status(200).json({
        success: true,
        message: "Logged in successfully.",
        token: jwtToken,
        user: serializeUser(user),
      });
    } catch (error) {
      console.error("[Auth Login Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to log in.",
      });
    }
  },

  /**
   * Logout (Clear Cookie)
   * POST /api/auth/logout
   */
  async logout(req, res) {
    const { maxAge, ...clearOptions } = COOKIE_OPTIONS;
    res.clearCookie("token", clearOptions);
    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  },

  /**
   * Get Current Authenticated User & Credit Balances
   * GET /api/auth/me
   */
  async getMe(req, res) {
    try {
      const user = req.user;
      return res.status(200).json({
        success: true,
        user: serializeUser(user),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * GET /api/auth/brand-kit
   */
  async getBrandKit(req, res) {
    try {
      const user = req.user;
      const brandKit = sanitizeBrandKit(user.brandKit);
      return res.status(200).json({
        success: true,
        brandKit,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch brand kit.",
      });
    }
  },

  /**
   * PUT /api/auth/brand-kit
   */
  async updateBrandKit(req, res) {
    try {
      const { brandKit } = req.body || {};
      const normalized = sanitizeBrandKit(brandKit);
      const user = req.user;
      user.brandKit = normalized;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Brand kit saved successfully.",
        brandKit: normalized,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to save brand kit.",
      });
    }
  },

  /**
   * Request Password Reset (Forgot Password)
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Please provide your email address.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        // Return 200 to prevent user enumeration
        return res.status(200).json({
          success: true,
          message:
            "If that email is registered, a password reset link has been dispatched.",
        });
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = generateCryptoToken();
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();

      // Dispatch reset email
      await emailService.sendPasswordResetEmail(user, resetToken);

      return res.status(200).json({
        success: true,
        message:
          "If that email is registered, a password reset link has been dispatched.",
      });
    } catch (error) {
      console.error("[Auth Forgot Password Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to process forgot password request.",
      });
    }
  },

  /**
   * Reset Password with Token
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Token and new password are required.",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters long.",
        });
      }

      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpiry: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message:
            "Password reset link is invalid or has expired. Please request a new one.",
        });
      }

      // Update password (pre-save hook will hash it)
      user.password = newPassword;
      user.resetPasswordToken = null;
      user.resetPasswordExpiry = null;
      await user.save();

      return res.status(200).json({
        success: true,
        message:
          "Your password has been updated successfully! You can now log in.",
      });
    } catch (error) {
      console.error("[Auth Reset Password Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to reset password.",
      });
    }
  },

  /**
   * GET /api/user/credits (also /api/auth/credits)
   * Returns current credit balances (used, limit, remaining)
   */
  async getCredits(req, res) {
    try {
      const user = req.user;
      const isAdminUser =
        user.isAdmin === true ||
        user.plan === "admin" ||
        user.plan === "pro" ||
        user.plan === "enterprise" ||
        /^(info@devronix\.agency|heyyusman996@gmail\.com|devronixagency@gmail\.com)$/i.test(user.email);

      if (isAdminUser) {
        return res.status(200).json({
          success: true,
          captionCredits: {
            used: user.captionCredits?.used || 0,
            limit: 99999,
            remaining: 99999,
          },
          clipCredits: {
            used: user.clipCredits?.used || 0,
            limit: 99999,
            remaining: 99999,
          },
          plan: user.plan && user.plan !== "free" ? user.plan : "admin",
          isAdmin: true,
        });
      }

      const captionUsed = user.captionCredits?.used || 0;
      const captionLimit = user.captionCredits?.limit || 5;
      const captionRemaining = Math.max(0, captionLimit - captionUsed);

      const clipUsed = user.clipCredits?.used || 0;
      const clipLimit = user.clipCredits?.limit ?? 2;
      const clipRemaining = Math.max(0, clipLimit - clipUsed);

      return res.status(200).json({
        success: true,
        captionCredits: {
          used: captionUsed,
          limit: captionLimit,
          remaining: captionRemaining,
        },
        clipCredits: {
          used: clipUsed,
          limit: clipLimit,
          remaining: clipRemaining,
        },
        plan: user.plan || "free",
        isAdmin: false,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch credit balance.",
      });
    }
  },

  async getAdminStats(req, res) {
    try {
      const [totalUsers, verifiedUsers, adminUsers, planStats] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isVerified: true }),
        User.countDocuments({ $or: [{ isAdmin: true }, { plan: "admin" }] }),
        User.aggregate([{ $group: { _id: "$plan", count: { $sum: 1 } } }]),
      ]);

      const usage = await User.aggregate([
        {
          $group: {
            _id: null,
            totalCaptionUsed: { $sum: { $ifNull: ["$captionCredits.used", 0] } },
            totalClipUsed: { $sum: { $ifNull: ["$clipCredits.used", 0] } },
            totalCaptionLimit: { $sum: { $ifNull: ["$captionCredits.limit", 5] } },
            totalClipLimit: { $sum: { $ifNull: ["$clipCredits.limit", 2] } },
          },
        },
      ]);

      const planMap = Object.fromEntries(
        (planStats || []).map((item) => [item._id || "free", item.count]),
      );

      return res.status(200).json({
        success: true,
        stats: {
          totalUsers,
          verifiedUsers,
          adminUsers,
          planCounts: planMap,
          totalCaptionUsed: usage[0]?.totalCaptionUsed || 0,
          totalClipUsed: usage[0]?.totalClipUsed || 0,
          totalCaptionLimit: usage[0]?.totalCaptionLimit || 0,
          totalClipLimit: usage[0]?.totalClipLimit || 0,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch admin stats.",
      });
    }
  },

  async getAdminUsers(req, res) {
    try {
      const users = await User.find({}).sort({ createdAt: -1 }).lean();

      const safeUsers = users.map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan || "free",
        isAdmin: !!user.isAdmin,
        isActive: user.isActive !== false,
        isVerified: !!user.isVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        captionCredits: {
          used: user.captionCredits?.used || 0,
          limit: user.captionCredits?.limit || 5,
        },
        clipCredits: {
          used: user.clipCredits?.used || 0,
          limit: user.clipCredits?.limit || 2,
        },
      }));

      return res.status(200).json({ success: true, users: safeUsers });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch user list.",
      });
    }
  },

  async updateAdminUser(req, res) {
    try {
      const { userId } = req.params;
      const { plan, isAdmin, isVerified, isActive, captionLimit, clipLimit, password } = req.body || {};

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      if (typeof plan === "string" && ["free", "starter", "pro", "enterprise", "admin"].includes(plan)) {
        user.plan = plan;
      }

      if (typeof isAdmin === "boolean") {
        user.isAdmin = isAdmin;
      }

      if (typeof isVerified === "boolean") {
        user.isVerified = isVerified;
      }

      if (typeof isActive === "boolean") {
        user.isActive = isActive;
      }

      if (user.plan === "admin" || user.isAdmin) {
        user.isAdmin = true;
        user.plan = "admin";
      }

      const safeCaptionLimit = Number(captionLimit);
      if (Number.isFinite(safeCaptionLimit) && safeCaptionLimit >= 0) {
        user.captionCredits = {
          ...(user.captionCredits || { used: 0, limit: 5 }),
          limit: safeCaptionLimit,
        };
      }

      const safeClipLimit = Number(clipLimit);
      if (Number.isFinite(safeClipLimit) && safeClipLimit >= 0) {
        user.clipCredits = {
          ...(user.clipCredits || { used: 0, limit: 2 }),
          limit: safeClipLimit,
        };
      }

      if (typeof password === "string" && password.trim().length >= 6) {
        user.password = password.trim();
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: "User settings updated successfully.",
        user: user.toJSON(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update user settings.",
      });
    }
  },

  async getAdminTemplates(req, res) {
    try {
      const templates = await CaptionTemplate.find({ isActive: true }).sort({ createdAt: -1 });
      return res.status(200).json({ success: true, templates });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to fetch templates." });
    }
  },

  async createAdminTemplate(req, res) {
    try {
      const { name, description, badge, collection, settings } = req.body || {};
      if (!name || !settings) {
        return res.status(400).json({ success: false, message: "Template name and settings are required." });
      }
      const template = await CaptionTemplate.create({
        name: name.trim(),
        description: description || "Admin-created caption style",
        badge: badge || "CUSTOM",
        collection: collection || "admin_templates",
        settings,
        createdBy: req.user._id,
      });
      return res.status(201).json({ success: true, template });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to create template." });
    }
  },

  async deleteAdminTemplate(req, res) {
    try {
      const deleted = await CaptionTemplate.findByIdAndUpdate(req.params.templateId, { isActive: false }, { new: true });
      if (!deleted) return res.status(404).json({ success: false, message: "Template not found." });
      return res.status(200).json({ success: true, message: "Template removed." });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to remove template." });
    }
  },

  async deleteAdminUser(req, res) {
    try {
      if (String(req.user._id) === String(req.params.userId)) {
        return res.status(400).json({ success: false, message: "You cannot delete your own admin account." });
      }
      const deleted = await User.findByIdAndDelete(req.params.userId);
      if (!deleted) return res.status(404).json({ success: false, message: "User not found." });
      return res.status(200).json({ success: true, message: "User deleted." });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to delete user." });
    }
  },
};
