'use strict';

const AUTH_TEXT_CODES = new Set([
  'AUTHENTICATIONFAILED',
  'AUTHORIZATIONFAILED',
  'PRIVACYREQUIRED',
]);

const AUTH_MESSAGE_PATTERN = /authentication failed|authenticat(e|ion) failed|invalid credentials|invalid login|login failed|wrong password|bad credentials|user is authenticated but not connected|\[AUTHENTICATIONFAILED\]|\[AUTH\]/i;

function classifyImapError(error) {
  if (!error) {
    return { kind: 'unknown', permanent: false, message: 'unknown error' };
  }

  const message = error.message || String(error);

  if (error.source === 'authentication' || AUTH_TEXT_CODES.has(error.textCode) || AUTH_MESSAGE_PATTERN.test(message)) {
    return {
      kind: 'auth',
      permanent: true,
      message: `IMAP authentication failed: ${message}`,
    };
  }

  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || /getaddrinfo/i.test(message)) {
    return {
      kind: 'dns',
      permanent: false,
      message: `IMAP server not found: ${message}`,
    };
  }

  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || /timeout|socket/i.test(message)) {
    return {
      kind: 'network',
      permanent: false,
      message: `IMAP network error: ${message}`,
    };
  }

  if (error.source === 'timeout') {
    return {
      kind: 'network',
      permanent: false,
      message: `IMAP timeout: ${message}`,
    };
  }

  return {
    kind: 'unknown',
    permanent: false,
    message,
  };
}

module.exports = { classifyImapError };
