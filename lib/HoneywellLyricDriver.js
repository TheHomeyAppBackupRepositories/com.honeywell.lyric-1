'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class HoneywellLyricDriver extends OAuth2Driver {

  onOAuth2Init() {
    // Triggers
    this.homey.flow.getDeviceTriggerCard('thermostat_mode_changed')
      .registerRunListener((args, state) => {
        return args.thermostat_mode === state.thermostat_mode;
      });

    // Conditions
    this.homey.flow.getConditionCard('thermostat_mode_is')
      .registerRunListener((args = {}) => {
        return (args.thermostat_mode === args.device.getCapabilityValue('custom_thermostat_mode'));
      });

    this.homey.flow.getConditionCard('ac_mode_is')
      .registerRunListener(async (args, state) => {
        return (args.ac_mode === args.device.getCapabilityValue('custom_ac_mode'));
      });

    this.homey.flow.getConditionCard('fan_mode_is')
      .registerRunListener(async (args, state) => {
        return (args.fan_mode === args.device.getCapabilityValue('fan_mode'));
      });

    // Actions
    this.homey.flow.getActionCard('thermostat_mode_set')
      .registerRunListener((args = {}) => {
        return args.device.setCustomThermostatMode(args.thermostat_mode);
      });

    this.homey.flow.getActionCard('ac_mode_set')
      .registerRunListener((args = {}) => {
        return args.device.setCustomACMode(args.ac_mode);
      });

    this.homey.flow.getActionCard('resume_schedule')
      .registerRunListener((args = {}) => {
        return args.device.setResumeSchedule();
      });

    this.homey.flow.getActionCard('target_temperature.cool_set')
      .registerRunListener((args = {}) => {
        return args.device.setCoolSetpoint(args.coolSetpoint);
      });

    this.homey.flow.getActionCard('fan_mode_set')
      .registerRunListener(async (args, state) => {
        return args.device.setFanMode(args.fan_mode);
      });
  }

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
        devices.push(this._getDevice({ device, location }));
      });
    });

    if (!Array.isArray(devices)) {
      this.error('Invalid device data received', devices);
      throw new Error('Could not fetch devices');
    }

    this.log(`onPairListDevices() -> found ${devices.length} devices`);
    return devices;
  }

  /**
   * Returns the device data based on the Honeywell API data
   *
   * @param device
   * @param location
   * @returns {{data: {id: *}, name: *, store: {locationId: string, deviceSettings: {"import/core-modules": [string]}}}}
   * @private
   */
  _getDevice({ device, location }) {
    const data = {
      name: device.userDefinedDeviceName,
      data: { id: device.deviceID },
      store: {
        locationId: String(location.locationID),
        deviceSettings: device.settings,
      },
    };

    const capabilities = [
      'measure_temperature',
    ];
    const capabilitiesOptions = {};

    if (device.allowedModes && device.allowedModes.length > 0) {
      if (device.allowedModes.includes('Heat')) {
        capabilities.push('target_temperature');

        capabilitiesOptions['target_temperature'] = {
          title: {
            en: 'Heating setpoint',
            nl: 'Verwarmingsinstelpunt',
            de: 'Heizungssollwert',
          },
        };

        if (device.minHeatSetpoint && device.maxHeatSetpoint) {
          capabilitiesOptions['target_temperature'].min = device.minHeatSetpoint;
          capabilitiesOptions['target_temperature'].max = device.maxHeatSetpoint;
          capabilitiesOptions['target_temperature'].step = 0.5;
        }

        if (!device.allowedModes.includes('Cool')) {
          capabilities.push('custom_thermostat_mode');
        }
      }

      if (device.allowedModes.includes('Cool')) {
        capabilities.push('target_temperature.cool');

        capabilitiesOptions['target_temperature.cool'] = {
          title: {
            en: 'Cooling setpoint',
            nl: 'Koelinstelpunt',
            de: 'Kühlsollwert',
          },
        };

        if (device.minCoolSetpoint && device.maxCoolSetpoint) {
          capabilitiesOptions['target_temperature.cool'].min = device.minCoolSetpoint;
          capabilitiesOptions['target_temperature.cool'].max = device.maxCoolSetpoint;
          capabilitiesOptions['target_temperature.cool'].step = 0.5;
        }

        capabilities.push('custom_ac_mode');
      }
    }

    if (device.settings.fan
      && device.settings.fan.allowedModes
      && device.settings.fan.allowedModes.length > 0) {
      capabilities.push('fan_mode');
    }

    data.capabilities = capabilities;
    data.capabilitiesOptions = capabilitiesOptions;

    return data;
  }

}

module.exports = HoneywellLyricDriver;
