'use strict';

const HoneywellLyricDriver = require('../../lib/HoneywellLyricDriver');

class TThermostatDriver extends HoneywellLyricDriver {

  /**
   * Method that is called when OAuth2 process has completed and app is ready to fetch devices
   * from the Honeywell API. It will first fetch the locations, then the devices of all these
   * locations.
   * @param {OAuth2Client} oAuth2Client
   * @returns {Promise}
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices()');

    const locations = await oAuth2Client.getLocations();
    if (!Array.isArray(locations)) {
      throw new Error('Expected locations of type Array');
    }

    const devices = [];
    locations.forEach(location => {
      location.devices.forEach(device => {
        const newDevice = this._getDevice({ device, location });
        if (device.deviceModel.includes('T9-T10')) {
          newDevice.icon = '/t9_icon.svg';
        }
        devices.push(newDevice);
      });
    });

    if (!Array.isArray(devices)) {
      this.error('Invalid device data received', devices);
      throw new Error('Could not fetch devices');
    }

    this.log(`onPairListDevices() -> found ${devices.length} devices`);
    return devices;
  }

}

module.exports = TThermostatDriver;
