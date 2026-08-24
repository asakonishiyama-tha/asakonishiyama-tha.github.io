var THA_FREE_EMAIL_DOMAINS_ = Object.freeze([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

var THA_CONSULTATION_TOPICS_ = Object.freeze([
  "ai-president",
  "smb-ai",
  "adoption",
  "succession",
  "time-assets",
  "other",
]);

var THA_DIAGNOSIS_STAGES_ = Object.freeze([
  "explore",
  "experiment",
  "systemize",
  "integrate",
]);

function parsePostEvent_(event) {
  var parameters = readExactEventParameters_(event, ["submissionId", "payload"]);
  if (!isUuid_(parameters.submissionId)
      || parameters.payload.length === 0
      || parameters.payload.length > 16384) {
    throw new Error("invalid request");
  }

  var parsed;
  try {
    parsed = JSON.parse(parameters.payload);
  } catch (ignored) {
    throw new Error("invalid request");
  }

  var submission = validateLeadSubmission_(parsed);
  if (submission.submissionId !== parameters.submissionId) {
    throw new Error("invalid request");
  }
  return submission;
}

function parseStatusEvent_(event) {
  var parameters = readExactEventParameters_(event, ["submissionId", "callback"]);
  if (!isUuid_(parameters.submissionId) || !isSafeCallback_(parameters.callback)) {
    throw new Error("invalid request");
  }
  return Object.freeze({
    submissionId: parameters.submissionId,
    callback: parameters.callback,
  });
}

function readExactEventParameters_(event, expectedKeys) {
  if (!isRecord_(event)) {
    throw new Error("invalid request");
  }

  var values = {};
  var multiValueParameters = event.parameters;
  var singleValueParameters = event.parameter;

  if (multiValueParameters !== undefined) {
    requireExactObjectKeys_(multiValueParameters, expectedKeys, []);
    for (var index = 0; index < expectedKeys.length; index += 1) {
      var key = expectedKeys[index];
      var entries = multiValueParameters[key];
      if (!Array.isArray(entries) || entries.length !== 1 || typeof entries[0] !== "string") {
        throw new Error("invalid request");
      }
      values[key] = entries[0];
    }
  } else {
    requireExactObjectKeys_(singleValueParameters, expectedKeys, []);
    for (var singleIndex = 0; singleIndex < expectedKeys.length; singleIndex += 1) {
      var singleKey = expectedKeys[singleIndex];
      if (typeof singleValueParameters[singleKey] !== "string") {
        throw new Error("invalid request");
      }
      values[singleKey] = singleValueParameters[singleKey];
    }
  }

  if (singleValueParameters !== undefined) {
    requireExactObjectKeys_(singleValueParameters, expectedKeys, []);
    for (var compareIndex = 0; compareIndex < expectedKeys.length; compareIndex += 1) {
      var compareKey = expectedKeys[compareIndex];
      if (typeof singleValueParameters[compareKey] !== "string"
          || singleValueParameters[compareKey] !== values[compareKey]) {
        throw new Error("invalid request");
      }
    }
  }

  return values;
}

function validateLeadSubmission_(input) {
  requireExactObjectKeys_(input, ["submissionId", "website", "consentedAt", "lead"], []);
  if (!isUuid_(input.submissionId)
      || input.website !== ""
      || !isIsoDateTime_(input.consentedAt)) {
    throw new Error("invalid request");
  }

  return Object.freeze({
    submissionId: input.submissionId,
    website: "",
    consentedAt: input.consentedAt,
    lead: validateLead_(input.lead),
  });
}

function validateLead_(input) {
  if (!isRecord_(input) || (input.intent !== "download" && input.intent !== "consultation")) {
    throw new Error("invalid request");
  }

  var requiredKeys = ["intent", "companyName", "email", "consent", "talkSlug", "eventName"];
  var optionalKeys = ["name", "diagnosisStage", "referrer", "utmSource", "utmMedium", "utmCampaign"];
  if (input.intent === "consultation") {
    requiredKeys.push("consultationTopic");
  }
  requireExactObjectKeys_(input, requiredKeys, optionalKeys);

  var companyName = normalizeRequiredText_(input.companyName, 160);
  var name = normalizeOptionalText_(input.name, 120);
  var email = normalizeBusinessEmail_(input.email);
  var talkSlug = normalizeRequiredText_(input.talkSlug, 80);
  var eventName = normalizeRequiredText_(input.eventName, 160);
  if (input.consent !== true
      || !/^[a-z0-9][a-z0-9-]*$/.test(talkSlug)
      || talkSlug !== THA_ALLOWED_TALK_SLUG_
      || eventName !== THA_CANONICAL_EVENT_NAME_) {
    throw new Error("invalid request");
  }

  var diagnosisStage = "";
  if (hasOwn_(input, "diagnosisStage")) {
    if (typeof input.diagnosisStage !== "string"
        || THA_DIAGNOSIS_STAGES_.indexOf(input.diagnosisStage) === -1) {
      throw new Error("invalid request");
    }
    diagnosisStage = input.diagnosisStage;
  }

  var consultationTopic = "";
  if (input.intent === "consultation") {
    if (typeof input.consultationTopic !== "string"
        || THA_CONSULTATION_TOPICS_.indexOf(input.consultationTopic) === -1) {
      throw new Error("invalid request");
    }
    consultationTopic = input.consultationTopic;
  }

  return Object.freeze({
    intent: input.intent,
    companyName: companyName,
    name: name,
    email: email,
    consent: true,
    talkSlug: THA_ALLOWED_TALK_SLUG_,
    eventName: THA_CANONICAL_EVENT_NAME_,
    diagnosisStage: diagnosisStage,
    consultationTopic: consultationTopic,
    referrer: normalizeOptionalText_(input.referrer, 2048),
    utmSource: normalizeOptionalText_(input.utmSource, 200),
    utmMedium: normalizeOptionalText_(input.utmMedium, 200),
    utmCampaign: normalizeOptionalText_(input.utmCampaign, 200),
  });
}

function normalizeRequiredText_(value, maximum) {
  if (typeof value !== "string") {
    throw new Error("invalid request");
  }
  var normalized = value.trim();
  if (normalized.length === 0
      || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/.test(normalized)
      || !isSpreadsheetSafeText_(normalized)) {
    throw new Error("invalid request");
  }
  return normalized;
}

function normalizeOptionalText_(value, maximum) {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error("invalid request");
  }
  var normalized = value.trim();
  if (normalized.length > maximum
      || /[\u0000-\u001f\u007f]/.test(normalized)
      || !isSpreadsheetSafeText_(normalized)) {
    throw new Error("invalid request");
  }
  return normalized;
}

function normalizeBusinessEmail_(value) {
  if (typeof value !== "string") {
    throw new Error("invalid request");
  }
  var normalized = value.trim().toLowerCase();
  var emailPattern = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
  if (normalized.length === 0
      || normalized.length > 254
      || /[\u0000-\u001f\u007f]/.test(normalized)
      || !isSpreadsheetSafeText_(normalized)
      || !emailPattern.test(normalized)) {
    throw new Error("invalid request");
  }
  var domain = normalized.split("@")[1];
  if (THA_FREE_EMAIL_DOMAINS_.indexOf(domain) !== -1) {
    throw new Error("invalid request");
  }
  return normalized;
}

function isSpreadsheetSafeText_(value) {
  return !/^[=+\-@]/.test(value);
}

function requireExactObjectKeys_(value, requiredKeys, optionalKeys) {
  if (!isRecord_(value)) {
    throw new Error("invalid request");
  }
  var keys = Object.keys(value);
  var allowedKeys = requiredKeys.concat(optionalKeys);
  for (var index = 0; index < keys.length; index += 1) {
    if (allowedKeys.indexOf(keys[index]) === -1) {
      throw new Error("invalid request");
    }
  }
  for (var requiredIndex = 0; requiredIndex < requiredKeys.length; requiredIndex += 1) {
    if (!hasOwn_(value, requiredKeys[requiredIndex])) {
      throw new Error("invalid request");
    }
  }
}

function isRecord_(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn_(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isUuid_(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDateTime_(value) {
  if (typeof value !== "string") {
    return false;
  }
  var isoDateTimePattern = /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/;
  return isoDateTimePattern.test(value);
}

function isSafeCallback_(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && /^__thaGasReceipt_[0-9a-f]{8}_[0-9a-f]{4}_4[0-9a-f]{3}_[89ab][0-9a-f]{3}_[0-9a-f]{12}_[a-z0-9]+$/.test(value);
}
