var THA_RECENT_EMAIL_WINDOW_MS_ = 10 * 60 * 1000;
var THA_MAX_RECENT_EMAIL_SUBMISSIONS_ = 3;

function saveLeadSubmission_(submission) {
  var config = readConfig_();
  var lock = LockService.getScriptLock();
  var acquired = false;

  try {
    acquired = lock.tryLock(THA_SCRIPT_LOCK_TIMEOUT_MS_);
    if (!acquired) {
      throw new Error("storage unavailable");
    }

    var sheet = openLeadSheet_(config);
    ensureExactSheetHeader_(sheet, true);
    var storedRows = readStoredRows_(sheet);
    var existingRow = findStoredRowInRows_(storedRows, submission.submissionId);
    if (existingRow !== null) {
      return Object.freeze({
        created: false,
        row: [].concat(existingRow),
      });
    }

    var now = new Date();
    if (hasReachedRecentEmailLimit_(storedRows, submission.lead.email, now.getTime())) {
      throw new Error("storage unavailable");
    }

    var receivedAt = Utilities.formatDate(
      now,
      "UTC",
      "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    );
    var lead = submission.lead;
    var deleteAfter = formatDeleteAfter_(now);
    var row = [
      receivedAt,
      submission.submissionId,
      lead.intent,
      lead.talkSlug,
      lead.eventName,
      lead.companyName,
      lead.name,
      lead.email,
      lead.consultationTopic,
      "",
      lead.diagnosisStage,
      lead.referrer,
      lead.utmSource,
      lead.utmMedium,
      lead.utmCampaign,
      submission.consentedAt,
      "pending",
      "",
      0,
      spreadsheetSafePhone_(lead.phone),
      deleteAfter,
    ];
    sheet.appendRow(row);
    return Object.freeze({
      created: true,
      row: [].concat(row),
    });
  } finally {
    if (acquired) {
      try {
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function spreadsheetSafePhone_(phone) {
  return phone.charAt(0) === "+" ? "'" + phone : phone;
}

function formatDeleteAfter_(receivedAt) {
  var deleteAfter = new Date(receivedAt.getTime());
  var originalMonth = deleteAfter.getUTCMonth();
  deleteAfter.setUTCFullYear(deleteAfter.getUTCFullYear() + 1);
  if (deleteAfter.getUTCMonth() !== originalMonth) {
    deleteAfter.setUTCDate(0);
  }
  return formatUtcIso_(deleteAfter);
}

function listSlackRetryRows_() {
  var config = readConfig_();
  var sheet = openLeadSheet_(config);
  if (!ensureExactSheetHeader_(sheet, false)) {
    return [];
  }

  var rows = readStoredRows_(sheet);
  var candidates = [];
  for (var index = 0; index < rows.length; index += 1) {
    if (rows[index][16] === "pending"
        || rows[index][16] === "failed"
        || rows[index][16] === "sending") {
      candidates.push([].concat(rows[index]));
    }
  }
  return candidates;
}

function claimSlackNotification_(submissionId, notificationEnabled) {
  var config = readConfig_();
  var lock = LockService.getScriptLock();
  var acquired = false;

  try {
    acquired = lock.tryLock(THA_SCRIPT_LOCK_TIMEOUT_MS_);
    if (!acquired) {
      return Object.freeze({ status: "skipped" });
    }

    var sheet = openLeadSheet_(config);
    if (!ensureExactSheetHeader_(sheet, false)) {
      return Object.freeze({ status: "skipped" });
    }
    var rows = readStoredRows_(sheet);
    var rowIndex = findStoredRowIndexInRows_(rows, submissionId);
    if (rowIndex === -1) {
      return Object.freeze({ status: "skipped" });
    }

    var row = rows[rowIndex];
    if (!isSlackStateRow_(row, submissionId)) {
      return Object.freeze({ status: "skipped" });
    }

    var currentStatus = row[16];
    var currentRetryCount = row[18];
    var nextRetryCount;
    if (currentStatus === "pending") {
      if (currentRetryCount !== 0) {
        return Object.freeze({ status: "skipped" });
      }
      nextRetryCount = 0;
    } else if (currentStatus === "failed") {
      if (currentRetryCount >= THA_SLACK_MAX_RETRIES_) {
        return Object.freeze({ status: "skipped" });
      }
      nextRetryCount = currentRetryCount + 1;
    } else if (currentStatus === "sending") {
      if (!isExpiredSlackClaim_(row[17], Date.now())) {
        return Object.freeze({ status: "skipped" });
      }
      if (currentRetryCount >= THA_SLACK_MAX_RETRIES_) {
        writeSlackState_(sheet, rowIndex + 2, "failed", "", currentRetryCount);
        return Object.freeze({ status: "failed" });
      }
      nextRetryCount = currentRetryCount + 1;
    } else {
      return Object.freeze({ status: "skipped" });
    }

    if (!notificationEnabled) {
      writeSlackState_(sheet, rowIndex + 2, "disabled", "", currentRetryCount);
      return Object.freeze({ status: "disabled" });
    }

    var leaseExpiresAt = formatUtcIso_(new Date(Date.now() + THA_SLACK_CLAIM_LEASE_MS_));
    var claimToken = Utilities.getUuid();
    if (!isUuid_(claimToken)) {
      return Object.freeze({ status: "skipped" });
    }
    var claimValue = leaseExpiresAt + "|" + claimToken;
    var claimedRow = [].concat(row);
    claimedRow[16] = "sending";
    claimedRow[17] = claimValue;
    claimedRow[18] = nextRetryCount;
    writeSlackState_(sheet, rowIndex + 2, "sending", claimValue, nextRetryCount);

    return Object.freeze({
      status: "claimed",
      submissionId: submissionId,
      claimValue: claimValue,
      retryCount: nextRetryCount,
      row: claimedRow,
    });
  } finally {
    if (acquired) {
      try {
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function finalizeSlackNotification_(claim, delivered) {
  var config = readConfig_();
  var lock = LockService.getScriptLock();
  var acquired = false;

  try {
    acquired = lock.tryLock(THA_SCRIPT_LOCK_TIMEOUT_MS_);
    if (!acquired) {
      return false;
    }

    var sheet = openLeadSheet_(config);
    if (!ensureExactSheetHeader_(sheet, false)) {
      return false;
    }
    var rows = readStoredRows_(sheet);
    var rowIndex = findStoredRowIndexInRows_(rows, claim.submissionId);
    if (rowIndex === -1) {
      return false;
    }
    var row = rows[rowIndex];
    if (!isSlackStateRow_(row, claim.submissionId)
        || row[16] !== "sending"
        || row[17] !== claim.claimValue
        || row[18] !== claim.retryCount) {
      return false;
    }

    writeSlackState_(
      sheet,
      rowIndex + 2,
      delivered ? "sent" : "failed",
      delivered ? formatUtcIso_(new Date()) : "",
      claim.retryCount
    );
    return true;
  } finally {
    if (acquired) {
      try {
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function writeSlackState_(sheet, rowNumber, status, notifiedAt, retryCount) {
  sheet.getRange(rowNumber, 17, 1, 3).setValues([[
    status,
    notifiedAt,
    retryCount,
  ]]);
}

function isSlackStateRow_(row, submissionId) {
  return Array.isArray(row)
    && row.length === THA_SHEET_HEADERS_.length
    && row[1] === submissionId
    && isUuid_(row[1])
    && Number.isInteger(row[18])
    && row[18] >= 0
    && row[18] <= THA_SLACK_MAX_RETRIES_;
}

function isExpiredSlackClaim_(value, nowMs) {
  if (typeof value !== "string") {
    return true;
  }
  var parts = value.split("|");
  if (parts.length !== 2 || !isIsoDateTime_(parts[0]) || !isUuid_(parts[1])) {
    return true;
  }
  var expiresAtMs = new Date(parts[0]).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

function formatUtcIso_(date) {
  return Utilities.formatDate(
    date,
    "UTC",
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
  );
}

function readReceiptStatus_(submissionId) {
  var config = readConfig_();
  var sheet = openLeadSheet_(config);
  if (!ensureExactSheetHeader_(sheet, false)) {
    return "not_found";
  }

  var row = findStoredRow_(sheet, submissionId);
  if (row === null || row.length !== THA_SHEET_HEADERS_.length || row[1] !== submissionId) {
    return "not_found";
  }
  if (typeof row[0] !== "string" || !isIsoDateTime_(row[0])) {
    return "not_found";
  }

  var receivedAtMs = new Date(row[0]).getTime();
  var ageMs = Date.now() - receivedAtMs;
  var ttlMs = config.statusTtlHours * 60 * 60 * 1000;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) {
    return "not_found";
  }
  return "saved";
}

function openLeadSheet_(config) {
  var spreadsheet = SpreadsheetApp.openById(config.sheetId);
  var sheet = spreadsheet.getSheetByName(config.sheetName);
  if (sheet === null || sheet === undefined) {
    throw new Error("storage unavailable");
  }
  return sheet;
}

function ensureExactSheetHeader_(sheet, initializeEmpty) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow === 0 && lastColumn === 0) {
    if (!initializeEmpty) {
      return false;
    }
    sheet.getRange(1, 1, 1, THA_SHEET_HEADERS_.length).setValues([[].concat(THA_SHEET_HEADERS_)]);
    return true;
  }
  if (lastRow < 1 || lastColumn !== THA_SHEET_HEADERS_.length) {
    throw new Error("storage unavailable");
  }

  var header = sheet.getRange(1, 1, 1, THA_SHEET_HEADERS_.length).getValues()[0];
  if (!Array.isArray(header) || header.length !== THA_SHEET_HEADERS_.length) {
    throw new Error("storage unavailable");
  }
  for (var index = 0; index < THA_SHEET_HEADERS_.length; index += 1) {
    if (header[index] !== THA_SHEET_HEADERS_[index]) {
      throw new Error("storage unavailable");
    }
  }
  return true;
}

function findStoredRow_(sheet, submissionId) {
  return findStoredRowInRows_(readStoredRows_(sheet), submissionId);
}

function readStoredRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  return sheet.getRange(2, 1, lastRow - 1, THA_SHEET_HEADERS_.length).getValues();
}

function findStoredRowInRows_(rows, submissionId) {
  var index = findStoredRowIndexInRows_(rows, submissionId);
  return index === -1 ? null : rows[index];
}

function findStoredRowIndexInRows_(rows, submissionId) {
  for (var index = 0; index < rows.length; index += 1) {
    if (rows[index][1] === submissionId) {
      return index;
    }
  }
  return -1;
}

function hasReachedRecentEmailLimit_(rows, normalizedEmail, nowMs) {
  var candidateDigest = sha256Utf8_(normalizedEmail);
  var matchingRows = 0;

  for (var index = 0; index < rows.length; index += 1) {
    var row = rows[index];
    if (!Array.isArray(row)
        || row.length !== THA_SHEET_HEADERS_.length
        || !isUuid_(row[1])
        || !isIsoDateTime_(row[0])) {
      continue;
    }

    var ageMs = nowMs - new Date(row[0]).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > THA_RECENT_EMAIL_WINDOW_MS_) {
      continue;
    }

    var storedEmail;
    try {
      storedEmail = normalizeBusinessEmail_(row[7]);
    } catch (ignored) {
      continue;
    }
    if (!equalDigest_(candidateDigest, sha256Utf8_(storedEmail))) {
      continue;
    }

    matchingRows += 1;
    if (matchingRows >= THA_MAX_RECENT_EMAIL_SUBMISSIONS_) {
      return true;
    }
  }
  return false;
}

function sha256Utf8_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
}

function equalDigest_(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  var difference = 0;
  for (var index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
