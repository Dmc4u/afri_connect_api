const mongoose = require("mongoose");
const ContactMessage = require("../models/ContactMessage");

mongoose.connect("mongodb://127.0.0.1:27017/afri-connect_db", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const checkReplies = async () => {
  try {
    // Find all contact messages (without populate to avoid schema issues)
    const messages = await ContactMessage.find().limit(10);

    console.log("\n========================================");
    console.log("📋 CONTACT MESSAGES WITH REPLIES");
    console.log("========================================\n");

    messages.forEach((msg, index) => {
      console.log(`\n${index + 1}. Message from: ${msg.senderName} <${msg.senderEmail}>`);
      console.log(`   Message: "${msg.message.substring(0, 50)}..."`);
      console.log(`   Status: ${msg.status}`);
      console.log(`   Replies: ${msg.replies ? msg.replies.length : 0}`);

      if (msg.replies && msg.replies.length > 0) {
        msg.replies.forEach((reply, rIndex) => {
          console.log(`\n   Reply ${rIndex + 1}:`);
          console.log(`   - Author Name: ${reply.authorName || "N/A"}`);
          console.log(`   - Author Email: ${reply.authorEmail || "N/A"}`);
          console.log(
            `   - Content: "${(reply.content || reply.replyText || "N/A").substring(0, 50)}..."`
          );
          console.log(`   - Created At: ${reply.createdAt || reply.sentAt || "N/A"}`);
          console.log(`   - Full Reply Object:`, JSON.stringify(reply, null, 2));
        });
      }
      console.log("\n   " + "─".repeat(60));
    });

    console.log("\n========================================");
    console.log("✅ Check complete");
    console.log("========================================\n");

    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
    mongoose.connection.close();
  }
};
checkReplies();
