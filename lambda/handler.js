'use strict';

const Twilio = require('twilio');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

async function handleToken() {
  const {
    ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    VIDEO_IDENTITY = 'RTC_Video_Diagnostics_Test_Identity',
  } = process.env;

  const AccessToken = Twilio.jwt.AccessToken;
  const VideoGrant = AccessToken.VideoGrant;

  const token = new AccessToken(ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
    ttl: 60,
    identity: VIDEO_IDENTITY,
  });
  token.addGrant(new VideoGrant());

  return respond(200, { token: token.toJwt() });
}

async function handleTurnCredentials() {
  const { ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = process.env;

  const client = Twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
    accountSid: ACCOUNT_SID,
  });

  const turnToken = await client.tokens.create({ ttl: 30 });
  return respond(200, turnToken);
}

exports.handler = async (event) => {
  const path = event.rawPath || event.path || '';
  const method = event.httpMethod || event.requestContext?.http?.method || '';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return respond(200, {});
  }

  // Service unavailable check
  if (process.env.SERVICE_UNAVAILABLE === 'true') {
    return respond(503, { error: 'Service is temporarily unavailable' });
  }

  try {
    if (path === '/app/token') {
      return await handleToken();
    }

    if (path === '/app/turn-credentials') {
      return await handleTurnCredentials();
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Lambda handler error:', error);
    return respond(500, { error: 'Internal server error' });
  }
};
