'use strict';

const Homey = require('homey');
// eslint-disable-next-line no-unused-vars
const { OAuth2App } = require('homey-oauth2app');

const HoneywellLyricClient = require('./lib/HoneywellLyricClient');

const API_BASE_URL = 'https://api.honeywell.com';
const TOKEN_URL = 'https://api.honeywell.com/oauth2/token';
const REDIRECT_URI = 'https://callback.athom.com/oauth2/callback/';
const AUTHORIZATION_URL = 'https://api.honeywell.com/oauth2/authorize';

class HoneywellLyricApp extends OAuth2App {

  async onOAuth2Init() {
    this.enableOAuth2Debug();
    this.setOAuth2Config({
      client: HoneywellLyricClient,
      clientId: Homey.env.HONEYWELL_API_CLIENT_ID,
      clientSecret: Homey.env.HONEYWELL_API_CLIENT_SECRET,
      tokenUrl: TOKEN_URL,
      apiUrl: API_BASE_URL,
      redirectUrl: REDIRECT_URI, // Important, trailing slash added
      authorizationUrl: AUTHORIZATION_URL,
    });

    this.log(`${this.id} running...`);
  }

}

module.exports = HoneywellLyricApp;
