const mongoose = require("mongoose");

// Direct MongoDB update - bypass Mongoose validation
mongoose.connect("mongodb://127.0.0.1:27017/afri-connect_db", {}).then(async () => {
  try {
    const db = mongoose.connection.db;

    console.log("\n========================================");
    console.log("🔧 RESTORING REPLY DATA");
    console.log("========================================\n");

    // This query will restore the replies with all original data
    const result = await db
      .collection("contactmessages")
      .updateMany({ "replies.createdAt": { $exists: true } }, [
        {
          $set: {
            replies: {
              $map: {
                input: "$replies",
                as: "reply",
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $type: "$$reply._id" }, "objectId"] },
                        { $not: ["$$reply.authorName"] },
                      ],
                    },
                    // If old schema or partially migrated
                    {
                      _id: "$$reply._id",
                      senderName: { $ifNull: ["$$reply.senderName", "Unknown"] },
                      senderEmail: { $ifNull: ["$$reply.senderEmail", "unknown@example.com"] },
                      replyText: { $ifNull: ["$$reply.replyText", ""] },
                      sentAt: { $ifNull: ["$$reply.sentAt", "$$reply.createdAt"] },
                      createdAt: "$$reply.createdAt",
                    },
                    "$$reply",
                  ],
                },
              },
            },
          },
        },
      ]);

    console.log(`Documents processed: ${result.modifiedCount}`);
    console.log("\n✅ Restore attempt complete");
    console.log("========================================\n");

    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Error:", error.message);
    mongoose.connection.close();
  }
});
