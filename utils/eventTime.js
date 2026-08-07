const EVENT_TIME_ZONE = process.env.EVENT_TIME_ZONE || "Asia/Jerusalem";
const EVENT_TIME_ZONE_LABEL = process.env.EVENT_TIME_ZONE_LABEL || "Israel time";

function getValidEventTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return EVENT_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return EVENT_TIME_ZONE;
  }
}

function formatEventDateTimeForTimeZone(value, requestedTimeZone) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const timeZone = getValidEventTimeZone(requestedTimeZone);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

  return `${formatted} (${timeZone})`;
}

function formatOfficialEventDateTime(value) {
  return formatEventDateTimeForTimeZone(value, EVENT_TIME_ZONE);
}

module.exports = {
  EVENT_TIME_ZONE,
  EVENT_TIME_ZONE_LABEL,
  getValidEventTimeZone,
  formatEventDateTimeForTimeZone,
  formatOfficialEventDateTime,
};
