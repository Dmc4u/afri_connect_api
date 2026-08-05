const EVENT_TIME_ZONE = process.env.EVENT_TIME_ZONE || "Asia/Jerusalem";
const EVENT_TIME_ZONE_LABEL = process.env.EVENT_TIME_ZONE_LABEL || "Israel time";

function formatOfficialEventDateTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

  return `${formatted} (${EVENT_TIME_ZONE_LABEL})`;
}

module.exports = {
  EVENT_TIME_ZONE,
  EVENT_TIME_ZONE_LABEL,
  formatOfficialEventDateTime,
};
