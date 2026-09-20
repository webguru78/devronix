import { User } from "../models/User.js";

/**
 * Middleware: Check if user has available Caption Credits
 * Verifies captionCredits.used < captionCredits.limit
 */
export async function checkCaptionCredits(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required to generate captions.",
      });
    }

    // Admin / owner bypass - unlimited free credits
    const isAdminUser =
      req.user.isAdmin === true ||
      req.user.plan === "admin" ||
      req.user.plan === "pro" ||
      req.user.plan === "enterprise" ||
      /^(info@devronix\.agency|heyyusman996@gmail\.com|devronixagency@gmail\.com)$/i.test(
        req.user.email,
      );

    if (isAdminUser) {
      return next();
    }

    const { used = 0, limit = 5 } = req.user.captionCredits || {};

    if (used >= limit) {
      return res.status(403).json({
        success: false,
        code: "CREDIT_LIMIT_REACHED",
        creditType: "captionCredits",
        used,
        limit,
        remaining: 0,
        message: `You have reached your free caption limit (${used}/${limit} credits used). Please upgrade your plan to continue generating captions.`,
      });
    }

    return next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to verify caption credits.",
    });
  }
}

/**
 * Middleware: Check if user has available Clip Credits
 * Verifies clipCredits.used < clipCredits.limit
 */
export async function checkClipCredits(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required to generate viral clips.",
      });
    }

    // Admin / owner bypass - unlimited free clip credits
    const isAdminUser =
      req.user.isAdmin === true ||
      req.user.plan === "admin" ||
      req.user.plan === "pro" ||
      req.user.plan === "enterprise" ||
      /^(info@devronix\.agency|heyyusman996@gmail\.com|devronixagency@gmail\.com)$/i.test(
        req.user.email,
      );

    if (isAdminUser) {
      return next();
    }

    const { used = 0 } = req.user.clipCredits || {};
    const rawLimit = req.user.clipCredits?.limit ?? 2;
    const limit =
      !req.user.plan || req.user.plan === "free"
        ? Math.min(rawLimit, 2)
        : rawLimit;

    if (used >= limit) {
      return res.status(403).json({
        success: false,
        code: "CREDIT_LIMIT_REACHED",
        creditType: "clipCredits",
        used,
        limit,
        remaining: 0,
        message: `You have reached your free viral clip limit (${used}/${limit} credits used). Please upgrade your plan to generate more clips.`,
      });
    }

    return next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to verify clip credits.",
    });
  }
}

/**
 * Atomic helper: Increment Caption credit count upon successful generation
 */
export async function deductCaptionCredit(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId).select("+plan +isAdmin +email");
    if (!user) return null;

    // Admin bypass — never deduct
    const isAdmin =
      user.isAdmin === true ||
      user.plan === "admin" ||
      user.plan === "pro" ||
      user.plan === "enterprise" ||
      /^(info@devronix\.agency|heyyusman996@gmail\.com|devronixagency@gmail\.com)$/i.test(
        user.email || "",
      );
    if (isAdmin) {
      console.log(
        `[Credits]: Admin user ${userId} — caption credit deduction skipped.`,
      );
      return user.captionCredits;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { "captionCredits.used": 1 } },
      { new: true },
    );
    console.log(
      `[Credits]: Deducted 1 caption credit for user ${userId}. New total used: ${updatedUser?.captionCredits?.used}/${updatedUser?.captionCredits?.limit}`,
    );
    return updatedUser?.captionCredits;
  } catch (err) {
    console.error(`[Credit Deduction Error]:`, err.message);
    return null;
  }
}

/**
 * Atomic helper: Increment Clip credit count upon successful job creation/completion
 */
export async function deductClipCredit(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId).select("+plan +isAdmin +email");
    if (!user) return null;

    // Admin bypass — never deduct
    const isAdmin =
      user.isAdmin === true ||
      user.plan === "admin" ||
      user.plan === "pro" ||
      user.plan === "enterprise" ||
      /^(info@devronix\.agency|heyyusman996@gmail\.com|devronixagency@gmail\.com)$/i.test(
        user.email || "",
      );
    if (isAdmin) {
      console.log(
        `[Credits]: Admin user ${userId} — clip credit deduction skipped (unlimited).`,
      );
      return { used: 0, limit: 9999, remaining: 9999 };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { "clipCredits.used": 1 } },
      { new: true },
    );
    console.log(
      `[Credits]: Deducted 1 clip credit for user ${userId}. New total used: ${updatedUser?.clipCredits?.used}/${updatedUser?.clipCredits?.limit}`,
    );
    return updatedUser?.clipCredits;
  } catch (err) {
    console.error(`[Credit Deduction Error]:`, err.message);
    return null;
  }
}
