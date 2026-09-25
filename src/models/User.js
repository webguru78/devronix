import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const CreditFieldSchema = new mongoose.Schema(
  {
    used: { type: Number, default: 0 },
    limit: { type: Number, default: 5 },
  },
  { _id: false },
);

const BrandKitSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Creator Essentials" },
    primaryColor: { type: String, default: "#0A0A0A" },
    accentColor: { type: String, default: "#7C3AED" },
    highlightColor: { type: String, default: "#F59E0B" },
    fontFamily: { type: String, default: "Poppins" },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/,
        "Please provide a valid email address",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Hidden by default on queries
    },
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    verificationToken: {
      type: String,
      default: null,
    },
    verificationTokenExpiry: {
      type: Date,
      default: null,
    },
    lastVerificationToken: {
      type: String,
      default: null,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpiry: {
      type: Date,
      default: null,
    },
    lastResendAt: {
      type: Date,
      default: null,
    },
    brandKit: {
      type: BrandKitSchema,
      default: () => ({
        name: "Creator Essentials",
        primaryColor: "#0A0A0A",
        accentColor: "#7C3AED",
        highlightColor: "#F59E0B",
        fontFamily: "Poppins",
      }),
    },
    // Credits tracked separately per feature
    captionCredits: {
      type: CreditFieldSchema,
      default: () => ({ used: 0, limit: 5 }),
    },
    clipCredits: {
      type: CreditFieldSchema,
      default: () => ({ used: 0, limit: 2 }),
    },
    // Future proof for subscriptions / plans
    plan: {
      type: String,
      enum: ["free", "starter", "pro", "enterprise", "admin"],
      default: "free",
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Pre-save hook: Hash password before saving if modified
UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Instance method: Verify candidate password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Safe JSON serialization (strip password and sensitive hashes)
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.verificationToken;
  delete obj.verificationTokenExpiry;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpiry;
  return obj;
};

export const User = mongoose.model("User", UserSchema);
