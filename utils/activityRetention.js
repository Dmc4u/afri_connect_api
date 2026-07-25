const ACTIVITY_RETENTION_DAYS = 5;
const ACTIVITY_RETENTION_SECONDS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60;
const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_SECONDS * 1000;

const getActivityRetentionStart = (now = new Date()) =>
  new Date(now.getTime() - ACTIVITY_RETENTION_MS);

const ensureActivityRetentionIndex = async (mongoose) => {
  const collectionName = "activity_logs";
  const indexName = "timestamp_1";
  const existingCollections = await mongoose.connection.db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();

  if (existingCollections.length === 0) {
    await mongoose.connection.db.createCollection(collectionName);
  }

  const collection = mongoose.connection.collection(collectionName);
  const indexes = await collection.indexes();
  const timestampIndex = indexes.find(
    (index) => index.name === indexName || index.key?.timestamp === 1
  );

  if (!timestampIndex) {
    await collection.createIndex(
      { timestamp: 1 },
      { name: indexName, expireAfterSeconds: ACTIVITY_RETENTION_SECONDS }
    );
    return;
  }

  if (timestampIndex.expireAfterSeconds !== ACTIVITY_RETENTION_SECONDS) {
    await mongoose.connection.db.command({
      collMod: collectionName,
      index: {
        name: timestampIndex.name,
        expireAfterSeconds: ACTIVITY_RETENTION_SECONDS,
      },
    });
  }
};

module.exports = {
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_RETENTION_SECONDS,
  getActivityRetentionStart,
  ensureActivityRetentionIndex,
};
