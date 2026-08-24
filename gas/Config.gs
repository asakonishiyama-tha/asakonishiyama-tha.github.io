var THA_CONFIG_PROPERTY_KEYS_ = Object.freeze([
  "THA_SHEET_ID",
  "THA_SHEET_NAME",
  "THA_STATUS_TTL_HOURS",
  "THA_SLACK_WEBHOOK_URL",
  "THA_SLACK_SHEET_URL",
  "THA_AUTOREPLY_ENABLED",
  "THA_AUTOREPLY_SENDER_NAME",
  "THA_AUTOREPLY_REPLY_TO",
  "THA_AUTOREPLY_SUBJECT",
  "THA_AUTOREPLY_BODY",
]);

var THA_SHEET_HEADERS_ = Object.freeze([
  "receivedAt",
  "submissionId",
  "intent",
  "talkSlug",
  "eventName",
  "company",
  "name",
  "email",
  "consultationTopic",
  "consultationMessage",
  "resultStage",
  "referrer",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "consentedAt",
  "slackStatus",
  "slackNotifiedAt",
  "slackRetryCount",
]);

var THA_ALLOWED_TALK_SLUG_ = "ai-president-intro";
var THA_CANONICAL_EVENT_NAME_ = "THA AI社長 登壇セッション";
var THA_MAX_STATUS_TTL_HOURS_ = 720;
var THA_SCRIPT_LOCK_TIMEOUT_MS_ = 10000;
var THA_SLACK_MAX_RETRIES_ = 3;
var THA_SLACK_CLAIM_LEASE_MS_ = 5 * 60 * 1000;
var THA_SLACK_FETCH_TIMEOUT_SECONDS_ = 30;

function readConfig_() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  var propertyKeys = Object.keys(properties);

  for (var index = 0; index < propertyKeys.length; index += 1) {
    if (THA_CONFIG_PROPERTY_KEYS_.indexOf(propertyKeys[index]) === -1) {
      throw new Error("invalid configuration");
    }
  }

  var sheetId = requireConfigText_(properties.THA_SHEET_ID, 256);
  var sheetName = requireConfigText_(properties.THA_SHEET_NAME, 100);
  var statusTtlHoursText = requireConfigText_(properties.THA_STATUS_TTL_HOURS, 32);

  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(statusTtlHoursText)) {
    throw new Error("invalid configuration");
  }
  var statusTtlHours = Number(statusTtlHoursText);
  if (!Number.isFinite(statusTtlHours)
      || !Number.isInteger(statusTtlHours)
      || statusTtlHours < 1
      || statusTtlHours > THA_MAX_STATUS_TTL_HOURS_) {
    throw new Error("invalid configuration");
  }

  return Object.freeze({
    sheetId: sheetId,
    sheetName: sheetName,
    statusTtlHours: statusTtlHours,
    slackWebhookUrl: optionalConfigValue_(properties.THA_SLACK_WEBHOOK_URL),
    slackSheetUrl: optionalConfigValue_(properties.THA_SLACK_SHEET_URL),
    autoreplyEnabled: optionalConfigValue_(properties.THA_AUTOREPLY_ENABLED),
    autoreplySenderName: optionalConfigValue_(properties.THA_AUTOREPLY_SENDER_NAME),
    autoreplyReplyTo: optionalConfigValue_(properties.THA_AUTOREPLY_REPLY_TO),
    autoreplySubject: optionalConfigValue_(properties.THA_AUTOREPLY_SUBJECT),
    autoreplyBody: optionalConfigValue_(properties.THA_AUTOREPLY_BODY),
  });
}

function requireConfigText_(value, maximum) {
  if (typeof value !== "string") {
    throw new Error("invalid configuration");
  }
  var normalized = value.trim();
  if (normalized.length === 0
      || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("invalid configuration");
  }
  return normalized;
}

function optionalConfigValue_(value) {
  return typeof value === "string" ? value : "";
}
