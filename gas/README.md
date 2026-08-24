# THA lead receipt Apps Script

This directory contains the source for the separately deployed Google Apps Script Web App. It is safe to keep in the public site source because it contains no Sheet ID, webhook, mail setting, lead data, or deployment URL.

No deployment or Google connection is performed by this repository. Creating the Apps Script project, setting Script Properties, connecting the Sheet, and publishing a Web App each require the separate approval gates in the launch design.

## Script Properties

Use only these keys. `THA_SHEET_ID`, `THA_SHEET_NAME`, and `THA_STATUS_TTL_HOURS` are required for local receipt storage. The TTL must be a whole number from `1` through `720` hours (30 days).

```text
THA_SHEET_ID
THA_SHEET_NAME
THA_STATUS_TTL_HOURS
THA_SLACK_WEBHOOK_URL
THA_SLACK_SHEET_URL
THA_AUTOREPLY_ENABLED
THA_AUTOREPLY_SENDER_NAME
THA_AUTOREPLY_REPLY_TO
THA_AUTOREPLY_SUBJECT
THA_AUTOREPLY_BODY
```

Leave both Slack values and the four mail content/sender values blank, and leave `THA_AUTOREPLY_ENABLED` unset or `false`, until each separately approved activation. Never commit property values. Invalid or incomplete notification settings fail closed without changing a saved receipt.

## Sheet contract

The configured tab may be completely empty; the first valid save initializes this exact header. Any non-empty tab with a different header fails closed.

```text
receivedAt,submissionId,intent,talkSlug,eventName,company,name,email,consultationTopic,consultationMessage,resultStage,referrer,utmSource,utmMedium,utmCampaign,consentedAt,slackStatus,slackNotifiedAt,slackRetryCount
```

`receivedAt` and the event name are generated canonically by the script. Browser `companyName` maps to `company`, and `diagnosisStage` maps to `resultStage`. `consultationMessage` remains empty until that field is explicitly approved and added to the browser contract.

Normalized browser-controlled text is rejected if its first character is `=`, `+`, `-`, or `@`; values are never escaped or rewritten before storage. This protects every user-controlled text cell from Sheet formula interpretation while preserving truthful stored values.

The script lock covers exact-header validation, UUID idempotency, abuse suppression, and append. An existing UUID returns idempotently before abuse accounting. For a new UUID, the server compares an in-memory SHA-256 digest of the normalized email with successful rows received during the preceding ten minutes. At most three matching new UUIDs are saved in that inclusive window. Neither the digest nor another email-derived key is written to the Sheet, properties, cache, response, or logs. Pending Sheet writes are flushed before the lock is released so the next serialized request observes the committed UUID.

After a new row is durable, its Slack state starts as `pending` with retry count `0`. `doPost` stops after validation and the flushed Sheet save, then returns the generic response; it never calls `UrlFetchApp` or `MailApp`, even when notification properties are active. A duplicate POST reuses the existing UUID row and likewise performs no notification work.

## Web App contract

- `POST` accepts exactly `submissionId` and JSON `payload` form fields. The outer and payload IDs must be matching RFC 4122 version-4 UUIDs compatible with `crypto.randomUUID()`. Its generic response is never proof of persistence.
- `GET` accepts exactly a version-4 `submissionId` and a flat generated callback shaped as `__thaGasReceipt_<lowercase UUID with underscores>_<lowercase base-36 sequence>`, with a 128-character total bound. Dotted, reserved, prototype-path, or arbitrary callback names are rejected and never reflected. A valid executable JSONP response contains only the UUID and `saved` or `not_found` status.
- `saved` means the UUID is present in the configured Sheet under the exact header and has not exceeded the configured TTL.
- Validation, suppression, lock, Sheet, header, read, append, or flush failures never make the generic POST body claim persistence and never include submitted values in responses or logs. A later GET reports `saved` only if the row is actually durable and visible in the Sheet.

## Slack notification contract

Slack is disabled unless both `THA_SLACK_WEBHOOK_URL` and `THA_SLACK_SHEET_URL` are valid. The webhook must be an HTTPS `hooks.slack.com/services/...` URL without credentials, query, or fragment. The Sheet link must be an HTTPS Google Sheets URL. A blank or invalid value performs zero URL fetches and records `disabled` for the new row.

The message contains only the application type, company, optional name, canonical Talk label, canonical result-stage label, canonical consultation topic when applicable, JST receipt time, and the approved Sheet link. The payload disables mrkdwn rendering and link/media unfurls. Company/name additionally escape Slack control characters and neutralize case-insensitive `http://`, `https://`, `www.`, IP-address, and domain-like sequences, so applicant text cannot mention, inject formatting, or create a clickable link. The separately approved Sheet URL remains the exact `詳細` link. Email, consultation free text, referrer, UTM fields, consent time, webhook, and arbitrary row serialization are never included or logged.

Before each delivery, the row is claimed durably as `sending`. During that state, `slackNotifiedAt` temporarily contains the five-minute lease expiry and a random claim UUID. The URL fetch has a 30-second timeout and occurs only after the claim was flushed and the lock released. Finalization writes `sent` plus server UTC time for a 2xx response, or `failed` for a non-2xx response/exception, only when the claim token and retry count still match.

`processPendingLeadNotifications()` is the only owner time-trigger entrypoint. Its Slack pass recovers the initial `pending` attempt plus expired `sending` leases and `failed` rows, skips live claims and `sent`/`disabled` rows, and permits exactly three retries after the initial attempt (`slackRetryCount` values `1` through `3`): at most four Slack requests in total. `retryFailedSlackNotifications()` remains a Slack-only compatibility wrapper and never processes mail.

The current processor scans the bounded working Sheet in one run. A future increase in row count is an explicit batching/scale risk: before the Sheet approaches Apps Script execution limits, add a reviewed batch size and durable cursor design, with tests that preserve claim and retry semantics. Do not silently raise limits or add an unreviewed trigger.

This repository does not create or enable a trigger. Only after the separate property, deployment, privacy, legal, and owner approvals are complete, an Apps Script owner may open **Triggers → Add Trigger** and select exactly:

- Function: `processPendingLeadNotifications`
- Deployment: `Head`
- Event source: `Time-driven`
- Time-based trigger: `Minutes timer`
- Minute interval: `Every 5 minutes`

Do not install that trigger before the approvals, and do not point a trigger at `doPost`, `notifySlack`, `sendAutoreply`, or `retryFailedSlackNotifications`.

## Optional autoreply contract

Autoreply is disabled unless `THA_AUTOREPLY_ENABLED` is exactly `true` and the approved sender name, reply-to address, subject, and plain-text body are all valid and non-empty. The owner processor stores its versioned state as a note on the submission-ID cell, leaving all 19 cell values unchanged. The note contains only `tha-autoreply:v1`, one of `disabled | claimed | sent | failed`, a server UTC timestamp, and for an attempted message a random claim UUID; it never contains lead data, recipient data, or configuration values.

The `claimed` note is flushed under ScriptLock before `MailApp.sendEmail(message)`, the mail call runs outside the lock, and finalization changes only the exactly matching claim note under a new lock. Any non-empty note is terminal for automatic processing, including `claimed`: duplicate POSTs, Slack-only retries, concurrent/later processor runs, and stale claims never resend mail. This gives at-most-once delivery. A crash after the claim flush but before MailApp accepts the message can therefore lose one autoreply; that loss is intentional and preferred to duplicating customer mail. The stored business email is used only as `to`, while the configured sender/subject/body are sent verbatim without lead interpolation. A disabled configuration or MailApp exception never changes the durable receipt or Slack value state.

The explicit manifest scopes are limited to Spreadsheet read/write, external request, and send mail. No Drive, Gmail mailbox, or full-account mail scope is requested. Adding the scopes does not enable a webhook, mail content, trigger, deployment, or external connection.

## Local verification

`npm test -- tests/unit/gas-web-app.test.ts tests/unit/gas-notifications.test.ts` executes the actual `.gs` files in a fresh Node VM for each case. The injected in-memory adapters keep a structural call ledger and model only the Apps Script methods used here, including signed-byte SHA-256 output, Sheet value/note writes queued until `SpreadsheetApp.flush()`, URL-fetch delay/responses/exceptions, and MailApp delay/outcomes. They never contact Google, Slack, or a mail service. A real deployment remains intentionally unverified until separately approved.
