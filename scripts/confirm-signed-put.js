/* eslint-disable no-console */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const { MONGO_URL, JWT_SECRET, PORT } = require("../utils/config");
const User = require("../models/User");
const { Storage } = require("@google-cloud/storage");
const { deleteObject } = require("../utils/gcs");

async function getFetch() {
  if (typeof fetch === "function") return fetch;
  // eslint-disable-next-line global-require
  const mod = await import("node-fetch");
  return mod.default;
}

function randomEmail() {
  const nonce = crypto.randomBytes(5).toString("hex");
  return `gcs-test-${Date.now()}-${nonce}@example.com`;
}

function randomPhone() {
  // E.164-ish Nigerian format; validator.isMobilePhone('any') generally accepts this.
  const tail = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  return `+23480${tail}`;
}

async function ensureTestUser() {
  const existing = await User.findOne({}).select("_id email");
  if (existing) {
    return { user: existing, created: false };
  }

  const passwordPlain = `TestPass-${crypto.randomBytes(8).toString("hex")}!`;
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  const user = await User.create({
    name: "GCS Test",
    email: randomEmail(),
    phone: randomPhone(),
    password: passwordHash,
    role: "admin",
  });

  return { user, created: true };
}

async function main() {
  const apiBase = `http://127.0.0.1:${PORT || 4000}`;

  const credsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!credsPath) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set in afri_connect_api/.env");
  }

  await mongoose.connect(MONGO_URL);

  let createdUserId = null;
  let objectToDelete = null;

  try {
    const { user, created } = await ensureTestUser();
    if (created) createdUserId = user._id;

    const token = jwt.sign({ _id: user._id }, JWT_SECRET, { expiresIn: "10m" });

    const filename = `confirm-${Date.now()}.mp4`;
    const sigUrl = `${apiBase}/api/upload/cloudinary-signature?resource_type=video&filename=${encodeURIComponent(
      filename
    )}`;

    const _fetch = await getFetch();

    console.log("[1/4] Calling signature endpoint:", sigUrl);
    const sigRes = await _fetch(sigUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const sigText = await sigRes.text();
    let sigJson;
    try {
      sigJson = sigText ? JSON.parse(sigText) : null;
    } catch {
      sigJson = { raw: sigText };
    }

    if (!sigRes.ok || !sigJson?.success) {
      throw new Error(
        `Signature endpoint failed (HTTP ${sigRes.status}): ${sigJson?.message || sigText}`
      );
    }

    if (String(sigJson.provider || "").toLowerCase() !== "gcs") {
      throw new Error(`Expected provider=gcs but got: ${sigJson.provider}`);
    }

    const { uploadUrl, method, fileUrl, bucket, objectName } = sigJson;
    if (!uploadUrl || !fileUrl || !bucket || !objectName) {
      throw new Error("Signature response missing uploadUrl/fileUrl/bucket/objectName");
    }

    objectToDelete = { bucketName: bucket, objectName };

    console.log("[2/4] PUT upload to signed URL...");
    const payload = Buffer.from(`confirm-signed-put ${new Date().toISOString()}`);
    const putRes = await _fetch(uploadUrl, {
      method: String(method || "PUT").toUpperCase(),
      headers: {
        "Content-Type": "video/mp4",
      },
      body: payload,
    });

    if (!putRes.ok) {
      const putBody = await putRes.text().catch(() => "");
      throw new Error(`PUT failed (HTTP ${putRes.status}): ${putBody}`);
    }

    console.log("[3/4] Verifying object exists via GCS SDK...");
    const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID || undefined });
    const file = storage.bucket(bucket).file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error("Object does not exist after PUT (unexpected)");
    }

    const [meta] = await file.getMetadata();
    console.log("✅ Signature+PUT confirmed");
    console.log("- bucket:", bucket);
    console.log("- objectName:", objectName);
    console.log("- contentType:", meta?.contentType);
    console.log("- size:", meta?.size);
    console.log("- fileUrl (public if bucket is public):", fileUrl);

    console.log("[4/4] Optional public GET check...");
    const getRes = await _fetch(fileUrl, { method: "GET" });
    console.log("- GET fileUrl HTTP:", getRes.status);
    if (getRes.status === 403) {
      console.log("  (403 is expected until bucket IAM allows allUsers: Storage Object Viewer)");
    }
  } finally {
    if (objectToDelete) {
      try {
        await deleteObject(objectToDelete);
        console.log("🧹 Cleaned up test object");
      } catch (e) {
        console.warn("⚠️ Could not delete test object:", e?.message || e);
      }
    }

    if (createdUserId) {
      try {
        await User.deleteOne({ _id: createdUserId });
        console.log("🧹 Deleted temporary test user");
      } catch (e) {
        console.warn("⚠️ Could not delete temporary test user:", e?.message || e);
      }
    }

    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Confirm signature+PUT failed:", err?.message || err);
  process.exit(1);
});
