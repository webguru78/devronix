import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

/**
 * Authentication and Verification Middleware
 */

// Helper to extract JWT token from cookies or Authorization header
function extractToken(req) {
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return null;
}

/**
 * requireAuth: Enforces that the user has a valid JWT session.
 * Loads user from database and attaches to req.user.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required. Please log in to continue.",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "verbatim_ai_default_secret_fallback"
    );

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Session is invalid or user no longer exists.",
      });
    }

    req.user = user;
    req.userId = user._id.toString();
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Session expired. Please log in again.",
      });
    }
    return res.status(401).json({
      success: false,
      code: "INVALID_TOKEN",
      message: "Invalid authentication token.",
    });
  }
}

/**
 * requireVerified: Enforces that the authenticated user has verified their email.
 */
export function requireVerified(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "Please log in first.",
    });
  }

  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      isUnverified: true,
      email: req.user.email,
      message: "Please verify your email address to access this feature.",
    });
  }

  return next();
}

/**
 * Optional / Backward-compatible auth identification
 * If user is logged in, populates req.user. If not, falls back to guest user ID.
 */
export async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || "verbatim_ai_default_secret_fallback"
        );
        const user = await User.findById(decoded.id);
        if (user) {
          req.user = user;
          req.userId = user._id.toString();
          return next();
        }
      } catch (_) {
        // Token invalid, fallback to guest
      }
    }

    // Check custom x-user-id header
    const customUserId = req.headers["x-user-id"];
    if (customUserId) {
      req.userId = String(customUserId).trim();
      req.user = { id: req.userId };
      return next();
    }

    // Guest fallback
    const clientIp = req.ip || req.connection?.remoteAddress || "guest";
    const sanitizedIp = clientIp.replace(/[^a-zA-Z0-9]/g, "");
    req.userId = `guest_${sanitizedIp.slice(0, 16) || "user"}`;
    req.user = { id: req.userId };
    return next();
  } catch (err) {
    req.userId = "guest_user";
    req.user = { id: "guest_user" };
    return next();
  }
}
