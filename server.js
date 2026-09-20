import "./crypto-polyfill.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import { connectDB, getLastDbError } from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import captionRoutes from "./src/routes/captionRoutes.js";
import contactRoutes from "./src/routes/contactRoutes.js";
import clipRoutes from "./src/routes/clipRoutes.js";
import { requireAuth } from "./src/middleware/authMiddleware.js";
import { authController } from "./src/controllers/authController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5001;

// cPanel / Passenger sits in front of Node as a reverse proxy
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://caption.devronix.agency",
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((o) => (o || "").trim().replace(/\/$/, ""))
    .filter(Boolean),
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-user-id",
    "Origin",
    "Accept",
    "X-Requested-With",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// Body and cookie parsing
// ---------------------------------------------------------------------------
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
const healthHandler = (req, res) => {
  const dbStatus =
    mongoose.connection.readyState === 1
      ? "connected"
      : mongoose.connection.readyState === 2
        ? "connecting"
        : "disconnected";

  res.status(200).json({
    success: true,
    message: "api connected",
    status: "online",
    service: "Verbatim AI Backend Engine",
    whisper: "OpenAI Whisper v3 / Groq",
    storage: "Cloudinary CDN",
    database: `MongoDB Atlas (${dbStatus})`,
    dbError: getLastDbError() || "None",
    dbReady: mongoose.connection.readyState === 1,
    requestedPath: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
};

app.get("/", healthHandler);
app.get("/api", healthHandler);
app.get("/api/", healthHandler);
app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/auth", authRoutes);

app.get("/api/user/credits", requireAuth, authController.getCredits);
app.get("/user/credits", requireAuth, authController.getCredits);

app.use("/api/captions", captionRoutes);
app.use("/captions", captionRoutes);

app.use("/api/contact", contactRoutes);
app.use("/contact", contactRoutes);

app.use("/api/clips", clipRoutes);
app.use("/clips", clipRoutes);

// ---------------------------------------------------------------------------
// 404 + global error handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error("[Unhandled Server Error]:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error occurred.",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Verbatim AI Backend Engine Active`);
  console.log(`📡 Port/Pipe: ${PORT}`);
  console.log(`🌍 Env: ${process.env.NODE_ENV || "not set"}`);
  console.log(`🔓 Allowed origins: ${[...allowedOrigins].join(", ")}`);
  console.log(`=========================================`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.timeout = 0;

// Connect to MongoDB asynchronously
connectDB().catch((err) => {
  console.error("[MongoDB Background Connection Error]:", err.message);
});

server.on("error", (err) => {
  console.error("[Server Start Error]:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
});

export default app;
