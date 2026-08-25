var THA_SLACK_TALK_LABELS_ = Object.freeze({
  "ai-president-intro": "会社に、もう一人の社長がいたら。",
  "long-lived-companies": "御社らしさは、20年後も残るか。",
});
var THA_SLACK_STAGE_LABELS_ = Object.freeze({
  explore: "探索期",
  experiment: "実験期",
  systemize: "仕組み化期",
  integrate: "経営統合期",
});
var THA_SLACK_TOPIC_LABELS_ = Object.freeze({
  "ai-president": "AI社長について相談したい",
  "smb-ai": "中小企業のAI活用について相談したい",
  adoption: "AI導入・定着について相談したい",
  succession: "事業承継について相談したい",
  "time-assets": "会社らしさ・判断資産の言語化について相談したい",
  other: "その他",
});

function notifySlack(row) {
  var submissionId = readNotificationSubmissionId_(row);
  if (submissionId === null) {
    return Object.freeze({ status: "skipped" });
  }

  var settings;
  try {
    settings = readSlackSettings_(readConfig_());
  } catch (ignoredConfig) {
    return Object.freeze({ status: "failed" });
  }

  var claim;
  try {
    claim = claimSlackNotification_(submissionId, settings !== null);
  } catch (ignoredClaim) {
    return Object.freeze({ status: "failed" });
  }
  if (claim.status !== "claimed") {
    return Object.freeze({ status: claim.status });
  }

  var httpStatus = 0;
  var delivered = false;
  try {
    var message = formatSlackMessage_(claim.row, settings.sheetUrl);
    var response = UrlFetchApp.fetch(settings.webhookUrl, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify({
        text: message,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      }),
      muteHttpExceptions: true,
      timeoutSeconds: THA_SLACK_FETCH_TIMEOUT_SECONDS_,
    });
    var responseCode = Number(response.getResponseCode());
    httpStatus = Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599
      ? responseCode
      : 0;
    delivered = httpStatus >= 200 && httpStatus < 300;
  } catch (ignoredFetch) {
    httpStatus = 0;
    delivered = false;
  }

  logSlackAttempt_(submissionId, httpStatus, claim.retryCount + 1);
  try {
    if (!finalizeSlackNotification_(claim, delivered)) {
      return Object.freeze({ status: "skipped" });
    }
  } catch (ignoredFinalize) {
    return Object.freeze({ status: "failed" });
  }
  return Object.freeze({ status: delivered ? "sent" : "failed" });
}

function retryFailedSlackNotifications() {
  processPendingSlackNotifications_();
}

function processPendingSlackNotifications_() {
  var rows;
  try {
    rows = listSlackRetryRows_();
  } catch (ignoredRead) {
    return;
  }
  for (var index = 0; index < rows.length; index += 1) {
    try {
      notifySlack(rows[index]);
    } catch (ignoredNotification) {
      // Each durable row has an independent bounded outcome.
    }
  }
}

function readSlackSettings_(config) {
  if (!isValidSlackWebhookUrl_(config.slackWebhookUrl)
      || !isValidGoogleSheetUrl_(config.slackSheetUrl)) {
    return null;
  }
  return Object.freeze({
    webhookUrl: config.slackWebhookUrl,
    sheetUrl: config.slackSheetUrl,
  });
}

function isValidSlackWebhookUrl_(value) {
  return typeof value === "string"
    && value.length <= 512
    && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value);
}

function isValidGoogleSheetUrl_(value) {
  return typeof value === "string"
    && value.length <= 2048
    && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/edit)?(?:#gid=\d+)?$/.test(value);
}

function formatSlackMessage_(row, sheetUrl) {
  if (!isSlackMessageRow_(row)) {
    throw new Error("invalid notification row");
  }

  var lines = [
    "【THA登壇サイト 新規申込】",
    "",
    "種別：" + (row[2] === "download" ? "資料請求" : "相談申込"),
    "会社名：" + sanitizeSlackApplicantText_(row[5]),
    "氏名：" + (row[6].length === 0 ? "未入力" : sanitizeSlackApplicantText_(row[6])) + "様",
    "対象Talk：" + THA_SLACK_TALK_LABELS_[row[3]],
    "診断結果：" + (row[10].length === 0 ? "未診断" : THA_SLACK_STAGE_LABELS_[row[10]]),
  ];
  if (row[2] === "consultation") {
    lines.push("相談テーマ：" + THA_SLACK_TOPIC_LABELS_[row[8]]);
  }
  lines.push(
    "受付日時：" + Utilities.formatDate(
      new Date(row[0]),
      "Asia/Tokyo",
      "yyyy-MM-dd HH:mm:ss 'JST'"
    ),
    "",
    "詳細：" + sheetUrl
  );
  return lines.join("\n");
}

function isSlackMessageRow_(row) {
  if (!Array.isArray(row)
      || row.length !== THA_SHEET_HEADERS_.length
      || !isIsoDateTime_(row[0])
      || !isUuid_(row[1])
      || (row[2] !== "download" && row[2] !== "consultation")
      || !hasOwn_(THA_TALK_EVENTS_, row[3])
      || !hasOwn_(THA_SLACK_TALK_LABELS_, row[3])
      || row[4] !== THA_TALK_EVENTS_[row[3]]
      || typeof row[5] !== "string"
      || row[5].length === 0
      || typeof row[6] !== "string"
      || typeof row[10] !== "string") {
    return false;
  }
  if (row[10].length > 0 && !hasOwn_(THA_SLACK_STAGE_LABELS_, row[10])) {
    return false;
  }
  return row[2] !== "consultation"
    || (typeof row[8] === "string" && hasOwn_(THA_SLACK_TOPIC_LABELS_, row[8]));
}

function escapeSlackMrkdwn_(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeSlackApplicantText_(value) {
  return neutralizeSlackLinks_(escapeSlackMrkdwn_(value));
}

function neutralizeSlackLinks_(value) {
  var neutralized = value.replace(/https?:\/\//gi, function(protocol) {
    return protocol.slice(0, -3) + "[:]//";
  });
  neutralized = neutralized.replace(/\bwww\./gi, function(prefix) {
    return prefix.slice(0, -1) + "[.]";
  });
  neutralized = neutralized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, function(address) {
    return address.replace(/\./g, "[.]");
  });
  return neutralized.replace(
    /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})\.)+(?:xn--[A-Za-z0-9-]{2,59}|[A-Za-z]{2,63})\b/gi,
    function(domain) {
      return domain.replace(/\./g, "[.]");
    }
  );
}

function readNotificationSubmissionId_(row) {
  if (!Array.isArray(row)
      || row.length !== THA_SHEET_HEADERS_.length
      || !isUuid_(row[1])) {
    return null;
  }
  return row[1];
}

function logSlackAttempt_(submissionId, httpStatus, attempt) {
  console.info(
    "slack submissionId=" + submissionId
      + " httpStatus=" + httpStatus
      + " attempt=" + attempt
  );
}
