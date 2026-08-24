function doPost(event) {
  try {
    var submission = parsePostEvent_(event);
    saveLeadSubmission_(submission);
  } catch (ignored) {
    // The opaque no-CORS POST body is intentionally identical on every path.
  }
  return genericPostOutput_();
}

function processPendingLeadNotifications() {
  try {
    processPendingSlackNotifications_();
  } catch (ignoredSlack) {
    // One processor path never prevents the other from running.
  }
  try {
    processPendingAutoreplies_();
  } catch (ignoredMail) {
    // Each durable row owns an independent at-most-once mail outcome.
  }
}

function doGet(event) {
  var request;
  try {
    request = parseStatusEvent_(event);
  } catch (ignored) {
    return invalidRequestOutput_();
  }

  var status = "not_found";
  try {
    status = readReceiptStatus_(request.submissionId);
  } catch (ignored) {
    status = "not_found";
  }

  var receipt = {
    submissionId: request.submissionId,
    status: status,
  };
  return ContentService
    .createTextOutput(request.callback + "(" + JSON.stringify(receipt) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function genericPostOutput_() {
  return ContentService
    .createTextOutput("accepted")
    .setMimeType(ContentService.MimeType.TEXT);
}

function invalidRequestOutput_() {
  return ContentService
    .createTextOutput("invalid request")
    .setMimeType(ContentService.MimeType.TEXT);
}
