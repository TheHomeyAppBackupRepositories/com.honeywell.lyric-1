'use strict';

const { HoneywellOAuth2Client } = require('./HoneywellOAuth2Client');

class HoneywellLyricClient extends HoneywellOAuth2Client {

  /**
   * Fetches all available locations from API.
   * @returns {Promise<*>}
   */
  async getLocations() {
    this.log('getLocations()');
    return this.get({ path: `/v2/locations?apikey=${this.getApiKey()}` });
  }

  /**
   * Fetches a specific device from the API.
   * @param {String} locationId
   * @param {String} deviceId
   * @returns {Promise<*>}
   */
  async getDevice({ locationId, deviceId }) {
    this.log('getDevice()', locationId, deviceId);
    if (typeof deviceId !== 'string') {
      throw new Error('invalid_device_id');
    }
    if (typeof locationId !== 'string') {
      throw new Error('invalid_location_id');
    }
    return this.get({ path: `/v2/devices/thermostats/${deviceId}?locationId=${locationId}&apikey=${this.getApiKey()}` });
  }

  /**
   * Fetches a specific device from the API.
   * @param {String} locationId
   * @param {String} deviceId
   * @returns {Promise<*>}
   */
  async getFan({ locationId, deviceId }) {
    this.log('getDevice()', locationId, deviceId);
    if (typeof deviceId !== 'string') {
      throw new Error('invalid_device_id');
    }
    if (typeof locationId !== 'string') {
      throw new Error('invalid_location_id');
    }
    return this.get({ path: `/v2/devices/thermostats/${deviceId}/fan?locationId=${locationId}&apikey=${this.getApiKey()}` });
  }

  /**
   * Method that makes a POST call to the API which sets the thermostat of a device.
   *
   * @param locationId
   * @param deviceId
   * @param heatSetpoint
   * @param coolSetpoint
   * @param mode
   * @param thermostatSetpointStatus
   * @returns {Promise<*>}
   */
  async setThermostat({
    locationId,
    deviceId,
    heatSetpoint,
    coolSetpoint,
    mode,
    thermostatSetpointStatus,
  }) {
    this.log('setTemperature()', locationId, deviceId, heatSetpoint, coolSetpoint, mode, thermostatSetpointStatus);
    if (typeof deviceId !== 'string') throw new Error('invalid_device_id');
    if (typeof locationId !== 'string') throw new Error('invalid_location_id');

    return this._sendThermostatData({
      locationId,
      deviceId,
      mode,
      heatSetpoint,
      coolSetpoint,
      thermostatSetpointStatus,
    });
  }

  /**
   * Sets the Honeywell Home to resume the user defined scheduled
   *
   * @param locationId
   * @param deviceId
   * @returns {Promise<*>}
   */
  async resumeSchedule({ locationId, deviceId }) {
    this.log('resumeSchedule()', locationId, deviceId);
    if (typeof deviceId !== 'string') throw new Error('invalid_device_id');
    if (typeof locationId !== 'string') throw new Error('invalid_location_id');

    return this._sendThermostatData({
      locationId,
      deviceId,
      thermostatSetpointStatus: 'NoHold',
    });
  }

  /**
   * Gets the latest set of device data
   *
   * @param locationId
   * @param deviceId
   * @returns {Promise<*>}
   * @private
   */
  async _getDeviceData({ locationId, deviceId }) {
    const deviceData = await this.getDevice({ locationId, deviceId });
    if (!deviceData
      || !Object.prototype.hasOwnProperty.call(deviceData, 'deviceID')
      || !Object.prototype.hasOwnProperty.call(deviceData, 'changeableValues')) {
      this.error('Received invalid device object', deviceData);
      throw new Error('invalid_device_properties');
    }

    return deviceData;
  }

  /**
   * Sends the updated values to the API
   *
   * @param locationId
   * @param deviceId
   * @param mode
   * @param heatSetpoint
   * @param coolSetpoint
   * @param thermostatSetpointStatus
   * @returns {Promise<*>}
   * @private
   */
  async _sendThermostatData({
    locationId,
    deviceId,
    mode,
    heatSetpoint,
    coolSetpoint,
    thermostatSetpointStatus,
  }) {
    const deviceData = await this._getDeviceData({ locationId, deviceId });

    const json = {
      mode: mode || deviceData.changeableValues.mode,
      heatSetpoint: heatSetpoint || deviceData.changeableValues.heatSetpoint,
      coolSetpoint: coolSetpoint || deviceData.changeableValues.coolSetpoint,
      thermostatSetpointStatus: thermostatSetpointStatus || deviceData.changeableValues.thermostatSetpointStatus,
    };

    if (typeof deviceData.changeableValues.autoChangeoverActive === 'boolean') {
      json.autoChangeoverActive = deviceData.changeableValues.autoChangeoverActive;
    }

    // Because of an issue with the API, 'TemporaryHold' does not function correctly.
    // Therefor we use the 'HoldUntil' with the 'nextPeriodTime' returned from the _getDeviceData
    if (json.thermostatSetpointStatus === 'HoldUntil') {
      if (typeof deviceData.changeableValues.nextPeriodTime === 'string') {
        json.nextPeriodTime = deviceData.changeableValues.nextPeriodTime;
      } else {
        json.thermostatSetpointStatus = 'PermanentHold';
      }
    }

    return this.post({
      path: `/v2/devices/thermostats/${deviceId}?locationId=${locationId}&apikey=${this.getApiKey()}`,
      json,
    });
  }

  /**
   * Sends the updated fan values to the API
   *
   * @param locationId
   * @param deviceId
   * @param mode
   * @returns {Promise<*>}
   */
  async setFanMode({
    locationId, deviceId, mode,
  }) {
    return this.post({
      path: `/v2/devices/thermostats/${deviceId}/fan?locationId=${locationId}&apikey=${this.getApiKey()}`,
      json: {
        mode,
      },
    });
  }

}

module.exports = HoneywellLyricClient;
