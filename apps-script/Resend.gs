/**
 * Web app endpoint for the website's "Resend my key" (called by the request-new-key Edge Function).
 * Deploy: Execute as "Me", access "Anyone". The shared secret travels in the HTTPS JSON body
 * because Apps Script web apps cannot read request headers.
 */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return resendReply_('bad request'); }
  if (!constantTimeEquals_(String(body && body.secret || ''), cfg_('RESEND_SHARED_SECRET'))) {
    return resendReply_('forbidden');
  }
  try {
    withLock_(function () { resendKeyForEmail_(String(body.email || ''), null); });
  } catch (err) {
    console.error('resend failed: ' + err.message);   // the caller must not learn anything about members
  }
  return resendReply_('ok');
}

function resendReply_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/** Compares every character regardless of where the first difference is. */
function constantTimeEquals_(a, b) {
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
