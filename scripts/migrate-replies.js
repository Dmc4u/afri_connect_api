const mongoose = require("mongoose");
const ContactMessage = require("../models/ContactMessage");

mongoose.connect("mongodb://127.0.0.1:27017/afri-connect_db", {}).then(async () => {
  try {
    console.log("\n========================================");
    console.log("🔄 MIGRATING OLD REPLIES TO NEW SCHEMA");
    console.log("========================================\n");

    // Find all messages with old schema replies (has senderName field)
    const messages = await ContactMessage.find({ "replies.senderName": { $exists: true } });

    console.log(`📍 Found ${messages.length} messages with old schema replies\n`);

    let migratedCount = 0;
    let replyCount = 0;

    for (const msg of messages) {
      console.log(`\nMessage from: ${msg.senderName}`);
      console.log(`Replies to migrate: ${msg.replies.length}`);

      msg.replies = msg.replies.map((reply, idx) => {
        if (reply.senderName && reply.replyText) {
          // Old schema detected - convert to new schema
          console.log(`  ✓ Converting reply ${idx + 1}: "${reply.replyText.substring(0, 30)}..."`);
          replyCount++;
          return {
            author: reply.author || new mongoose.Types.ObjectId(),
            authorName: reply.senderName || "Unknown",
            authorEmail: reply.senderEmail || "unknown@example.com",
            content: reply.replyText || "",
            createdAt: reply.sentAt || new Date(),
            _id: reply._id,
          };
        } else {
          // Already new schema - keep as is
          console.log(`  ℹ Reply ${idx + 1} already new schema or empty`);
          return reply;
        }
      });

      // Use updateOne to bypass validation issues
      await ContactMessage.updateOne({ _id: msg._id }, { $set: { replies: msg.replies } });
      migratedCount++;
      console.log(`  ✅ Saved`);
    }

    console.log("\n========================================");
    console.log("✅ MIGRATION COMPLETE");
    console.log("========================================");
    console.log(`Messages updated: ${migratedCount}`);
    console.log(`Replies converted: ${replyCount}`);
    console.log("========================================\n");

    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Migration error:", error.message);
    console.error(error);
    mongoose.connection.close();
  }
});
