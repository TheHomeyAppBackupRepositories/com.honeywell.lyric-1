'use strict';

const { OAuth2Device, OAuth2Token, OAuth2Util } = require('homey-oauth2app');
const { ftoc, ctof } = require('./HoneywellUtils');

const UNIT_CELSIUS = 'Celsius';
const POLL_INTERVAL = 60 * 1000; // 60 seconden

class HoneywellLyricDevice extends OAuth2Device {

  /**
   * Marks device as unavailable, bind rateLimit listener, migrate location id from settings to
   * store, bind poll interval which fetches device data, fetch initial data.
   * @returns {Promise<void>}
   */
  async onOAuth2Init() {
    this.log('onOAuth2Init()');

    // Migrate location id from settings to store if necessary
    await this._migrateLocationIdFromSettingsToStore();

    // Bind rate limit listener to client
    this.oAuth2Client.on('rateLimited', this.onRateLimited.bind(this));

    const capabilities = ['target_temperature'];

    if (this.hasCapability('target_temperature.cool')) {
      capabilities.push('target_temperature.cool');
    }
    if (this.hasCapability('custom_thermostat_mode')) {
      capabilities.push('custom_thermostat_mode');
    }
    if (this.hasCapability('custom_ac_mode')) {
      capabilities.push('custom_ac_mode');
    }

    this.registerMultipleCapabilityListener(capabilities, this.onMultipleCapabilities.bind(this));

    if (this.hasCapability('fan_mode')) {
      this.registerCapabilityListener('fan_mode', this.onFanCapability.bind(this));
    }

    // Set intervals
    this.pollInterval = this.homey.setInterval(this._fetchDeviceData.bind(this), POLL_INTERVAL);

    // Get initial data
    await this._fetchDeviceData();
  }

  /**
   * Clear running interval when device is deleted.
   */
  onOAuth2Deleted() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.log('onOAuth2Deleted()');
  }

  /**
   * Event handler for rate limited API calls
   */
  onRateLimited() {
    this.log('onRateLimited()');
    this.setUnavailable(this.homey.__('rateLimited'));
  }

  /**
   * Migrates tokens from settings to homey-oauth2 format
   * TODO in the future maybe join sessions with same tokens (in the case of multiple devices on
   * the same OAuth2 account)
   * @returns {{sessionId: *, configId: *, token: OAuth2Token}}
   */
  onOAuth2Migrate() {
    this.log('onOAuth2Migrate()');

    const settingAccessToken = this.getSetting('atoken');
    const settingRefreshToken = this.getSetting('rtoken');

    if (!settingAccessToken) throw new Error('Missing access token in settings');
    if (!settingRefreshToken) throw new Error('Missing refresh token in settings');

    const token = new OAuth2Token({
      access_token: settingAccessToken,
      refresh_token: settingRefreshToken,
    });

    const sessionId = OAuth2Util.getRandomId();
    const configId = this.driver.getOAuth2ConfigId();

    this.log('onOAuth2Migrate() -> migration succeeded', {
      sessionId,
      configId,
      token,
    });

    return {
      sessionId,
      configId,
      token,
    };
  }

  /**
   * Unset legacy token values in settings.
   * @returns {Promise<void>}
   */
  async onOAuth2MigrateSuccess() {
    // Unset settings
    await this.setSettings({ atoken: null, rtoken: null });
  }

  /**
   * Location id was stored in settings, migrate to store.
   * @returns {Promise<void>}
   * @private
   */
  async _migrateLocationIdFromSettingsToStore() {
    const location = this.getSetting('location');
    if (location && Object.prototype.hasOwnProperty.call(location, 'id')) {
      await this.setStoreValue('locationId', String(location.id));
      await this.setSettings({ location: null });
      this.log('_migrateLocationIdFromSettingsToStore() -> migration of locationId from settings to store succeeded', this.getStoreValue('locationId'));
    }
  }

  /**
   * Getter for locationId property in store.
   * @returns {string|*}
   */
  getLocationId() {
    const locationId = this.getStoreValue('locationId');
    if (typeof locationId !== 'string') throw new Error('invalid_location_id_in_store');
    return locationId;
  }

  /**
   * Capability listener
   *
   * @param capabilityValues
   * @param opts
   * @returns {Promise<*>}
   */
  async onMultipleCapabilities(capabilityValues, opts) {
    let heatSetpoint;
    let coolSetpoint;
    let mode;
    let thermostatSetpointStatus = 'PermanentHold';

    // set the defaults for the target_temperature
    heatSetpoint = this.getCapabilityValue('target_temperature');

    if (this.hasCapability('target_temperature.cool')) {
      coolSetpoint = this.getCapabilityValue('target_temperature.cool');
    } else {
      coolSetpoint = heatSetpoint;
    }

    if (typeof capabilityValues['target_temperature'] === 'number') {
      heatSetpoint = this._transformTemperature(capabilityValues['target_temperature']);
      thermostatSetpointStatus = 'HoldUntil';
    }

    if (this.hasCapability('target_temperature.cool') && typeof capabilityValues['target_temperature.cool'] === 'number') {
      coolSetpoint = this._transformTemperature(capabilityValues['target_temperature.cool']);
      thermostatSetpointStatus = 'HoldUntil';
    }

    // Thermostat mode
    if (this.hasCapability('custom_thermostat_mode') && typeof capabilityValues['custom_thermostat_mode'] === 'string') {
      const newMode = capabilityValues['custom_thermostat_mode'] || 'heat';

      this.homey.flow.getDeviceTriggerCard('thermostat_mode_changed')
        .trigger(this, null, { thermostat_mode: newMode })
        .catch(this.error);

      mode = (newMode === 'heat') ? 'Heat' : 'Off';
    }

    // AC mode
    if (this.hasCapability('custom_ac_mode') && typeof capabilityValues['custom_ac_mode'] === 'string') {
      mode = capabilityValues['custom_ac_mode'];
    }

    return this.oAuth2Client.setThermostat({
      locationId: this.getLocationId(),
      deviceId: this.getData().id,
      heatSetpoint,
      coolSetpoint,
      mode,
      thermostatSetpointStatus,
    });
  }

  /**
   * Listener for the Fan mide
   *
   * @param value
   * @returns {Promise<*>}
   */
  async onFanCapability(value) {
    return this.oAuth2Client.setFanMode({
      locationId: this.getLocationId(),
      deviceId: this.getData().id,
      mode: value,
    });
  }

  /**
   * Method that fetches device data from the API and tries to parse the measure and target
   * temperature.
   * @returns {Promise<void>}
   * @private
   */
  async _fetchDeviceData() {
    this.log('_fetchDeviceData()');

    // Get device object from remote API
    try {
      const deviceData = await this.oAuth2Client.getDevice({
        locationId: this.getLocationId(), deviceId: this.getData().id,
      });

      if (!Object.prototype.hasOwnProperty.call(deviceData, 'changeableValues')) {
        this.error('_fetchDeviceData() -> expected device to have changeableValues property');
        return;
      }

      await this._parseMeasuredTemperature(deviceData);
      await this._parseTargetTemperature(deviceData);

      if (this.hasCapability('custom_thermostat_mode')) {
        await this._parseThermostatMode(deviceData);
      }

      if (this.hasCapability('custom_ac_mode')) {
        await this._parseACMode(deviceData);
      }

      await this._parseAlive(deviceData);

      this.log('_fetchDeviceData() -> completed');
    } catch (err) {
      this.error('_fetchDeviceData() -> failed to get device', err);
    }

    // Get the Fan mode data
    if (this.hasCapability('fan_mode')) {
      try {
        const deviceData = await this.oAuth2Client.getFan({
          locationId: this.getLocationId(), deviceId: this.getData().id,
        });

        await this._parseFanMode(deviceData);

        this.log('_fetchFanData() -> completed');
      } catch (err) {
        this.error('_fetchFanData() -> failed to get fan', err);
      }
    }
  }

  /**
   * Methat that parsed the measure temperature from the API data, it also updates the unit
   * setting (C/F).
   * @param {Object} deviceData
   * @private
   */
  async _parseMeasuredTemperature(deviceData = {}) {
    if (!Object.prototype.hasOwnProperty.call(deviceData, 'units')) {
      this.error('_parseMeasuredTemperature() -> expected device to have units property');
      return;
    }

    // Determine measure temperature value based on units
    if (deviceData.units !== UNIT_CELSIUS) {
      deviceData.indoorTemperature = ftoc(deviceData.indoorTemperature);
    }

    await this.setSettings({ units: deviceData.units });
    await this.setCapabilityValue('measure_temperature', deviceData.indoorTemperature);
  }

  /**
   * Method that parsed the API data to determine the set target temperature.
   * @param {Object} deviceData
   * @private
   */
  async _parseTargetTemperature(deviceData = {}) {
    if (!Object.prototype.hasOwnProperty.call(deviceData.changeableValues, 'mode')) {
      this.error('_parseTargetTemperature() -> expected device.changeableValues to have mode property');
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(deviceData.changeableValues, 'heatSetpoint')) {
      this.error('_parseTargetTemperature() -> expected device.changeableValues to have heatSetpoint property');
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(deviceData.changeableValues, 'coolSetpoint')) {
      this.error('_parseTargetTemperature() -> expected device.changeableValues to have coolSetpoint property');
      return;
    }

    // Set target temperature according to heat or cool mode depending on mode property
    await this.setCapabilityValue('target_temperature', deviceData.changeableValues.heatSetpoint);

    if (this.hasCapability('target_temperature.cool')) {
      await this.setCapabilityValue('target_temperature.cool', deviceData.changeableValues.coolSetpoint);
    }
  }

  /**
   * Method that parsed the API data to determine the thermostat mode.
   * @param {Object} deviceData
   * @private
   */
  async _parseThermostatMode(deviceData = {}) {
    if (!Object.prototype.hasOwnProperty.call(deviceData.changeableValues, 'mode')) {
      this.error('_parseThermostatMode() -> expected device.changeableValues to have mode property');
      return;
    }

    const mode = deviceData.changeableValues.mode.toLowerCase();

    // Check if thermostat mode value changed, then trigger flow
    if (this.getCapabilityValue('custom_thermostat_mode') !== mode) {
      this.homey.flow.getDeviceTriggerCard('thermostat_mode_changed')
        .trigger(this, {}, { thermostat_mode: mode })
        .catch(this.error);
    }

    await this.setCapabilityValue('custom_thermostat_mode', mode)
      .catch(this.error);
  }

  /**
   * Method that parsed the API data to determine the thermostat mode.
   * @param {Object} deviceData
   * @private
   */
  async _parseACMode(deviceData = {}) {
    if (!Object.prototype.hasOwnProperty.call(deviceData.changeableValues, 'mode')) {
      this.error('_parseACMode() -> expected device.changeableValues to have mode property');
      return;
    }

    const { mode } = deviceData.changeableValues;
    await this.setCapabilityValue('custom_ac_mode', mode)
      .catch(this.error);
  }

  /**
   * Method that parses the API data to determine if device is alive (connected to internet).
   * @param {Object} deviceData
   * @returns {Promise<void>}
   * @private
   */
  async _parseAlive(deviceData = {}) {
    // Check if device is alive (online)
    if (!Object.prototype.hasOwnProperty.call(deviceData, 'isAlive')) {
      this.error('_parseAlive() -> expected device to have isAlive property');
    }

    // Set (un)available if necessary
    if (this.getAvailable() === false && deviceData.isAlive) await this.setAvailable();
    if (this.getAvailable() === true && !deviceData.isAlive) await this.setUnavailable(this.homey.__('unavailable'));
  }

  /**
   * Method that parses the API data for the Fan mode
   *
   * @param deviceData
   * @returns {Promise<void>}
   * @private
   */
  async _parseFanMode(deviceData) {
    if (!Object.prototype.hasOwnProperty.call(deviceData, 'mode')) {
      this.error('_parseThermostatMode() -> expected device to have mode property');
      return;
    }

    await this.setCapabilityValue('fan_mode', deviceData.mode)
      .catch(this.error);
  }


  /**
   * Capability listener for custom_thermostat_mode set.
   * @param value
   * @returns {Promise<void>}
   */
  async setCustomThermostatMode(value) {
    this.log(`setCustomThermostatMode() -> ${value}`);
    this.triggerCapabilityListener('custom_thermostat_mode', value);
  }

  /**
   * Capability listener for custom_ac_mode set.
   * @param value
   * @returns {Promise<void>}
   */
  async setCustomACMode(value) {
    this.log(`setCustomACMode() -> ${value}`);
    this.triggerCapabilityListener('custom_ac_mode', value);
  }

  /**
   * Flow listener for temperature cool setpoint.
   * @param value
   * @returns {Promise<void>}
   */
  async setCoolSetpoint(value) {
    this.log(`setCoolSetpoint() -> ${value}`);
    this.triggerCapabilityListener('target_temperature.cool', value);
  }

  /**
   * Capability listener for custom_ac_mode set.
   * @param value
   * @returns {Promise<void>}
   */
  async setFanMode(value) {
    this.log(`setFanMode() -> ${value}`);
    this.triggerCapabilityListener('fan_mode', value);
  }

  /**
   * Listener for the resume schedule Flow
   * @returns {Promise<void>}
   */
  async setResumeSchedule() {
    this.log('resumeSchedule()');
    return this.oAuth2Client.resumeSchedule({
      locationId: this.getLocationId(),
      deviceId: this.getData().id,
    });
  }

  /**
   * Returns the correct temperature based on the Device settings
   *
   * @param temperature
   * @returns {number|*}
   */
  _transformTemperature(temperature) {
    if (typeof this.getSetting('units') === 'string'
      && this.getSetting('units') !== UNIT_CELSIUS) {
      return ctof(temperature);
    }
    return temperature;
  }

}

module.exports = HoneywellLyricDevice;
