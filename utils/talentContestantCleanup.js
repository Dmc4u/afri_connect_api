const gcs = require("./gcs");

async function deleteContestantVideoMedia(contestants = []) {
  if (!gcs.isGcsEnabled() || !contestants.length) {
    return { attempted: 0 };
  }

  const bucketName = gcs.getGcsBucketName();
  const deletions = contestants
    .filter((contestant) => contestant?.videoGcsObjectName || contestant?.videoUrl)
    .map(async (contestant) => {
      if (contestant.videoGcsObjectName && bucketName) {
        await gcs.deleteObject({
          bucketName,
          objectName: contestant.videoGcsObjectName,
        });
        return;
      }
      await gcs.deleteFromUrl(contestant.videoUrl);
    });

  await Promise.allSettled(deletions);
  return { attempted: deletions.length };
}

module.exports = { deleteContestantVideoMedia };
