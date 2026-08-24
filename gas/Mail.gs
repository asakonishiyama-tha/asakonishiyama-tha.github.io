var THA_AUTOREPLY_MAX_SENDER_NAME_LENGTH_ = 100;
var THA_AUTOREPLY_MAX_SUBJECT_LENGTH_ = 200;
var THA_AUTOREPLY_MAX_BODY_LENGTH_ = 10000;
var THA_AUTOREPLY_NOTE_PREFIX_ = "tha-autoreply:v1|";

function processPendingAutoreplies_() {
  var submissionIds;
  try {
    submissionIds = listPendingAutoreplySubmissionIds_();
  } catch (ignoredRead) {
    return;
  }
  for (var index = 0; index < submissionIds.length; index += 1) {
    try {
      sendAutoreply(submissionIds[index]);
    } catch (ignoredAutoreply) {
      // Each submission-ID note owns an independent at-most-once outcome.
    }
  }
}

function listPendingAutoreplySubmissionIds_() {
  var config = readConfig_();
  var sheet = openLeadSheet_(config);
  if (!ensureExactSheetHeader_(sheet, false)) {
    return [];
  }

  var rows = readStoredRows_(sheet);
  var submissionIds = [];
  for (var index = 0; index < rows.length; index += 1) {
    var row = rows[index];
    if (!Array.isArray(row)
        || row.length !== THA_SHEET_HEADERS_.length
        || !isUuid_(row[1])) {
      continue;
    }
    var note = sheet.getRange(index + 2, 2).getNote();
    if (note === "") {
      submissionIds.push(row[1]);
    }
  }
  return submissionIds;
}

function sendAutoreply(submissionId) {
  if (!isUuid_(submissionId)) {
    return Object.freeze({ status: "skipped" });
  }

  var settings;
  try {
    settings = readAutoreplySettings_(readConfig_());
  } catch (ignoredConfig) {
    return Object.freeze({ status: "failed" });
  }

  var claim;
  try {
    claim = claimAutoreply_(submissionId, settings);
  } catch (ignoredClaim) {
    return Object.freeze({ status: "failed" });
  }
  if (claim.status !== "claimed") {
    return Object.freeze({ status: claim.status });
  }

  var delivered = false;
  try {
    MailApp.sendEmail({
      to: claim.recipient,
      subject: settings.subject,
      body: settings.body,
      name: settings.senderName,
      replyTo: settings.replyTo,
    });
    delivered = true;
  } catch (ignoredMail) {
    delivered = false;
  }

  try {
    if (!finalizeAutoreply_(claim, delivered)) {
      return Object.freeze({ status: "skipped" });
    }
  } catch (ignoredFinalize) {
    return Object.freeze({ status: "failed" });
  }
  return Object.freeze({ status: delivered ? "sent" : "failed" });
}

function claimAutoreply_(submissionId, settings) {
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
    if (!Array.isArray(row)
        || row.length !== THA_SHEET_HEADERS_.length
        || row[1] !== submissionId) {
      return Object.freeze({ status: "skipped" });
    }

    var noteCell = sheet.getRange(rowIndex + 2, 2);
    if (noteCell.getNote() !== "") {
      return Object.freeze({ status: "skipped" });
    }

    var now = formatUtcIso_(new Date());
    if (settings === null) {
      noteCell.setNote(formatAutoreplyNote_("disabled", now, ""));
      return Object.freeze({ status: "disabled" });
    }

    var recipient;
    try {
      recipient = readAutoreplyRecipient_(row);
    } catch (ignoredRecipient) {
      noteCell.setNote(formatAutoreplyNote_("failed", now, ""));
      return Object.freeze({ status: "failed" });
    }

    var claimToken = Utilities.getUuid();
    if (!isUuid_(claimToken)) {
      noteCell.setNote(formatAutoreplyNote_("failed", now, ""));
      return Object.freeze({ status: "failed" });
    }
    var claimNote = formatAutoreplyNote_("claimed", now, claimToken);
    noteCell.setNote(claimNote);
    return Object.freeze({
      status: "claimed",
      submissionId: submissionId,
      claimNote: claimNote,
      claimToken: claimToken,
      recipient: recipient,
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

function finalizeAutoreply_(claim, delivered) {
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
    var noteCell = sheet.getRange(rowIndex + 2, 2);
    if (noteCell.getNote() !== claim.claimNote) {
      return false;
    }

    noteCell.setNote(formatAutoreplyNote_(
      delivered ? "sent" : "failed",
      formatUtcIso_(new Date()),
      claim.claimToken
    ));
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

function formatAutoreplyNote_(status, timestamp, token) {
  return THA_AUTOREPLY_NOTE_PREFIX_
    + status
    + "|"
    + timestamp
    + (token.length === 0 ? "" : "|" + token);
}

function readAutoreplySettings_(config) {
  if (config.autoreplyEnabled !== "true"
      || !isApprovedSingleLineText_(config.autoreplySenderName, THA_AUTOREPLY_MAX_SENDER_NAME_LENGTH_)
      || !isApprovedReplyTo_(config.autoreplyReplyTo)
      || !isApprovedSingleLineText_(config.autoreplySubject, THA_AUTOREPLY_MAX_SUBJECT_LENGTH_)
      || !isApprovedMailBody_(config.autoreplyBody)) {
    return null;
  }
  return Object.freeze({
    senderName: config.autoreplySenderName,
    replyTo: config.autoreplyReplyTo,
    subject: config.autoreplySubject,
    body: config.autoreplyBody,
  });
}

function isApprovedSingleLineText_(value, maximum) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isApprovedReplyTo_(value) {
  return typeof value === "string"
    && value.length <= 254
    && /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(value);
}

function isApprovedMailBody_(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= THA_AUTOREPLY_MAX_BODY_LENGTH_
    && !/[\u0000\u007f]/.test(value);
}

function readAutoreplyRecipient_(row) {
  if (!Array.isArray(row)
      || row.length !== THA_SHEET_HEADERS_.length
      || !isUuid_(row[1])) {
    throw new Error("invalid notification row");
  }
  return normalizeBusinessEmail_(row[7]);
}
