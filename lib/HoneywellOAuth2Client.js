'use strict';

const { URLSearchParams } = require('url');

const Homey = require('homey');
const {
  OAuth2Client, fetch, OAuth2Token, OAuth2Error,
} = require('homey-oauth2app');

const API_KEY = Homey.env.HONEYWELL_API_CLIENT_ID;
const API_SECRET = Homey.env.HONEYWELL_API_CLIENT_SECRET;

/*
 * This class handles all api and token requests, and should be extended by the app.
 */
class HoneywellOAuth2Client extends OAuth2Client {

  /**
   * Returns teh defined API key
   *
   * @returns {*}
   */
  getApiKey() {
    return API_KEY;
  }

  /*
   * This method overrides the base OAuth2Client because the Honeywell API returns a 200 with a
   * empty body while the Content-Ttype = application/json
   */
  async onHandleResponse({
    response,
    status,
    statusText,
    headers,
    ok,
  }) {
    if (status === 204) {
      return undefined;
    }

    let body;

    const contentType = headers.get('Content-Type');
    body = await response.text();
    if (typeof contentType === 'string' && contentType.startsWith('application/json')) {
      if (body.length === 0) { // empty body
        body = {};
      } else {
        body = JSON.parse(body);
      }
    }

    if (ok) {
      return body;
    }

    const err = await this.onHandleNotOK({
      body,
      status,
      statusText,
      headers,
    });

    if (!(err instanceof Error)) {
      throw new OAuth2Error('Invalid onHandleNotOK return value, expected: instanceof Error');
    }

    throw err;
  }

  /**
   * Method that exchanges a code for a token with the Honeywell API. Important is that the
   * redirect_uri property contains a uri that ends with a slash, otherwise the request will
   * fail with 401.
   * @param {String} code
   * @returns {Promise<*>}
   */
  async onGetTokenByCode({ code }) {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    // Below the trailing slash is needed
    params.append('redirect_uri', 'https://callback.athom.com/oauth2/callback/');
    params.append('code', code);

    // Append custom authorization header
    const res = await fetch(this._tokenUrl, {
      method: 'POST',
      body: params,
      headers: {
        Authorization: `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')}`,
      },
    });

    const body = await res.json();
    return new OAuth2Token(body);
  }

  /**
   * Extends error handling from homey-oauth2app, detects rate limiting by API (it returns a 500
   * instead of 429).
   * @param body
   * @param status
   * @param statusText
   * @param headers
   * @returns {*|Promise<*>}
   */
  onHandleNotOK({
    body,
    status,
    statusText,
    headers,
  }) {
    // Custom rate limit detector
    this._detectRateLimit(body);

    // Continue
    return super.onHandleNotOK({
      body,
      status,
      statusText,
      headers,
    });
  }

  /**
   * Override onRefreshToken method to append custom authorization header. If the Authorization
   * header is not changed the API will return a 401.
   * @returns {Promise<*>}
   */
  async onRefreshToken() {
    const token = this.getToken();
    if (!token) throw new OAuth2Error('Missing Token');

    this.debug('Refreshing token...');

    if (!token.isRefreshable()) throw new OAuth2Error('Token cannot be refreshed');

    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('refresh_token', token.refresh_token);

    const response = await fetch(this._tokenUrl, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')}`,
      },
    });
    if (!response.ok) throw new Error(`Invalid Response (${response.status})`);

    this._token = await this.onHandleRefreshTokenResponse({ response });

    this.debug('Refreshed token!', this._token);
    this.save();

    return this.getToken();
  }

  /**
   * Custom rate limit detector, the Honeywell API does not properly return a 429 on rate
   * limited, but a 500.
   * @param {Object} body
   * @returns {boolean}
   * @private
   */
  _detectRateLimit(body = {}) {
    if (Object.prototype.hasOwnProperty.call(body, 'fault')) {
      this.error('_detectRateLimit() -> API error:', body.fault);
      if (Object.prototype.hasOwnProperty.call(body.fault, 'faultstring')) {
        if (body.fault.faultstring.includes('Rate limit quota violation.')) {
          this.emit('rateLimited');
          return true;
        }
      }
    }
    return false;
  }

}

module.exports.HoneywellOAuth2Client = HoneywellOAuth2Client;
