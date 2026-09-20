// Entry point for LiteSpeed (lsnode.js) and cPanel Passenger
// This bridges CommonJS require() with ES Module server.js

const path = require("path");

try {
  const dotenv = require("dotenv");
  // Explicitly load .env from backend folder regardless of cPanel working directory
  dotenv.config({ path: path.resolve(__dirname, ".env") });
} catch (e) {
  console.log(
    "[App Boot]: dotenv module not found in app.cjs. Deferring to server.js.",
  );
}

(async () => {
  try {
    console.log("[App Boot]: Starting backend server from app.cjs...");
    console.log("[App Boot]: Working Directory:", process.cwd());
    console.log("[App Boot]: App Directory:", __dirname);
    console.log("[App Boot]: MONGODB_URI exists?", !!process.env.MONGODB_URI);
    await import("./server.js");
    console.log("[App Boot]: server.js imported successfully.");
  } catch (err) {
    console.error("[Startup Bridge Error]:", err);
    if (err.stack) {
      console.error(err.stack);
    }
  }
})();
