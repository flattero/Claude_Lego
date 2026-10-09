// Talks to a LEGO Education WeDo 2.0 Smart Hub over Web Bluetooth.
// The GATT layout and commands are the ones used by LEGO's WeDo 2.0 SDK and Scratch's WeDo 2.0 extension.
// Shared by wedo.html (remote control) and code.html (block coding).
(function () {
'use strict';

const UUID = {
  DEVICE_SERVICE: '00001523-1212-efde-1523-785feabcd123',
  BUTTON:         '00001526-1212-efde-1523-785feabcd123',
  ATTACHED_IO:    '00001527-1212-efde-1523-785feabcd123',
  IO_SERVICE:     '00004f0e-1212-efde-1523-785feabcd123',
  SENSOR_VALUE:   '00001560-1212-efde-1523-785feabcd123',
  INPUT_COMMAND:  '00001563-1212-efde-1523-785feabcd123',
  OUTPUT_COMMAND: '00001565-1212-efde-1523-785feabcd123',
};
// Device types reported when something is plugged in, and the hub's built-in devices.
const TYPE = { MOTOR: 1, PIEZO: 22, LED: 23, TILT: 34, MOTION: 35 };
const TYPE_NAMES = { 1: 'motor', 34: 'tilt sensor', 35: 'motion sensor' };
const PIEZO_CONNECT_ID = 5, LED_CONNECT_ID = 6;
const TILT_THRESHOLD = 15; // degrees before we call the hub "tilted"

const COLORS = [
  ['Red', 255, 0, 0], ['Orange', 255, 80, 0], ['Yellow', 255, 200, 0],
  ['Green', 0, 255, 0], ['Blue', 0, 0, 255], ['Purple', 160, 0, 255],
  ['Pink', 255, 0, 120], ['Cyan', 0, 220, 255], ['White', 255, 255, 255],
  ['Off', 0, 0, 0],
];

class WeDoHub {
  // log(msg): where to write log lines. onDisconnect(): called when the hub disconnects.
  // onChange(what): called when a port, sensor value, the button or the battery changes.
  constructor({ log = () => {}, onDisconnect = () => {}, onChange = () => {} } = {}) {
    this.log = log;
    this.onDisconnect = onDisconnect;
    this.onChange = onChange;
    this.device = null;
    this.outputChar = null;
    this.inputChar = null;
    this.writeQueue = Promise.resolve();
    this.reset();
  }

  reset() {
    this.pending = {};
    this.lastSent = {};
    this.ports = { 1: null, 2: null }; // type plugged into each port, or null
    this.buttonPressed = false;
    this.distanceRaw = null;
    this.tiltRaw = null; // { x, y }
    this.battery = null;
  }

  get connected() { return !!this.outputChar; }
  get name() { return (this.device && this.device.name) || 'Smart Hub'; }

  // Web Bluetooth only allows one GATT operation at a time, so queue all writes.
  // Writes with a `key` (a motor or the light) are coalesced, because programs often set them in a fast loop
  // and each Bluetooth write takes a few hundredths of a second: a write that repeats what was last sent is
  // skipped, and a newer write replaces one that is still waiting, so a Stop never sits behind a backlog.
  write(char, bytes, key) {
    if (key) {
      const pending = this.pending[key];
      if (pending) { pending.bytes = bytes; return pending.done; }
      if (this.lastSent[key] === bytes.join(',')) return Promise.resolve();
    }
    const entry = { bytes };
    if (key) this.pending[key] = entry;
    const p = this.writeQueue.then(() => {
      if (key) { delete this.pending[key]; this.lastSent[key] = entry.bytes.join(','); }
      if (!char) return;
      const data = new Uint8Array(entry.bytes);
      return char.writeValueWithResponse ? char.writeValueWithResponse(data) : char.writeValue(data);
    });
    this.writeQueue = p.catch(err => {
      if (key) delete this.lastSent[key];
      this.log('Write failed: ' + err.message);
    });
    entry.done = this.writeQueue;
    return entry.done;
  }

  // Configure an input device. Command layout: [1, 2, connectId, type, mode, delta (uint32 LE), unit, notifications].
  setInputFormat(connectId, type, mode, unit, notify) {
    return this.write(this.inputChar, [0x01, 0x02, connectId, type, mode, 0x01, 0x00, 0x00, 0x00, unit, notify ? 1 : 0]);
  }

  // showAll: list every Bluetooth device instead of only WeDo hubs. Resolves with the hub's name.
  async connect(showAll = false) {
    const options = { optionalServices: [UUID.DEVICE_SERVICE, UUID.IO_SERVICE, 'battery_service'] };
    if (showAll) options.acceptAllDevices = true;
    else options.filters = [{ services: [UUID.DEVICE_SERVICE] }];
    const device = await navigator.bluetooth.requestDevice(options);
    this.device = device;
    this.reset();
    device.addEventListener('gattserverdisconnected', () => { if (this.device === device) this.handleDisconnect(); });
    try {
      const server = await device.gatt.connect();
      const io = await server.getPrimaryService(UUID.IO_SERVICE);
      const outputChar = await io.getCharacteristic(UUID.OUTPUT_COMMAND);
      this.inputChar = await io.getCharacteristic(UUID.INPUT_COMMAND);

      const values = await io.getCharacteristic(UUID.SENSOR_VALUE);
      values.addEventListener('characteristicvaluechanged', e => this.onSensorValue(new Uint8Array(e.target.value.buffer)));
      await values.startNotifications();

      const dev = await server.getPrimaryService(UUID.DEVICE_SERVICE);
      const attached = await dev.getCharacteristic(UUID.ATTACHED_IO);
      attached.addEventListener('characteristicvaluechanged', e => this.onAttachedIo(new Uint8Array(e.target.value.buffer)));
      await attached.startNotifications();
      try {
        const button = await dev.getCharacteristic(UUID.BUTTON);
        button.addEventListener('characteristicvaluechanged', e => {
          this.buttonPressed = e.target.value.getUint8(0) === 1;
          this.onChange('button');
        });
        await button.startNotifications();
      } catch (err) {
        this.log('Hub button unavailable: ' + err.message);
      }

      // Put the hub light into RGB mode so we can choose any colour.
      await this.setInputFormat(LED_CONNECT_ID, TYPE.LED, 0x01, 0x02, true);
      this.outputChar = outputChar;
      this.readBattery(server);
      return this.name;
    } catch (err) {
      this.outputChar = this.inputChar = null;
      if (device.gatt.connected) device.gatt.disconnect();
      throw err;
    }
  }

  async readBattery(server) {
    try {
      const svc = await server.getPrimaryService('battery_service');
      const ch = await svc.getCharacteristic('battery_level');
      const show = v => { this.battery = v.getUint8(0); this.onChange('battery'); };
      show(await ch.readValue());
      ch.addEventListener('characteristicvaluechanged', e => show(e.target.value));
      await ch.startNotifications().catch(() => {});
    } catch (err) {
      this.log('Battery level unavailable');
    }
  }

  // Something was plugged in or unplugged: [connectId, attached, hubIndex, type, ...].
  onAttachedIo(d) {
    const port = d[0];
    if (port !== 1 && port !== 2) return;
    if (d[1] === 1) {
      const type = d[3];
      this.ports[port] = type;
      this.log(`Port ${port}: ${TYPE_NAMES[type] || 'device type ' + type} plugged in`);
      // Ask sensors to report their values (same modes and units as Scratch's WeDo 2.0 extension).
      if (type === TYPE.TILT) this.setInputFormat(port, TYPE.TILT, 0x00, 0x00, true);
      if (type === TYPE.MOTION) this.setInputFormat(port, TYPE.MOTION, 0x00, 0x01, true);
    } else {
      if (this.ports[port] === TYPE.MOTION) this.distanceRaw = null;
      if (this.ports[port] === TYPE.TILT) this.tiltRaw = null;
      this.ports[port] = null;
      this.log(`Port ${port}: unplugged`);
    }
    this.onChange('ports');
  }

  // A sensor reported a value: [?, connectId, value...].
  onSensorValue(d) {
    const type = this.ports[d[1]];
    if (type === TYPE.MOTION) { this.distanceRaw = d[2]; this.onChange('distance'); }
    else if (type === TYPE.TILT) { this.tiltRaw = { x: d[2], y: d[3] }; this.onChange('tilt'); }
  }

  handleDisconnect() {
    this.outputChar = this.inputChar = null;
    this.writeQueue = Promise.resolve();
    this.reset();
    this.onDisconnect();
  }

  async disconnect() {
    if (!this.device) return;
    this.stopAll();
    await this.writeQueue;
    if (this.device.gatt.connected) this.device.gatt.disconnect();
  }

  // port: 1 or 2. speed: -100..100 (0 = off). Low powers barely turn a WeDo motor,
  // so 1-100% is mapped onto 30-100% power, like Scratch does.
  setMotor(port, speed) {
    speed = Math.max(-100, Math.min(100, Number(speed) || 0));
    let power = 0;
    if (speed !== 0) power = Math.sign(speed) * Math.round(30 + 0.7 * Math.abs(speed));
    // [connectId, command = motor power, payload length, signed power]
    return this.write(this.outputChar, [port, 0x01, 0x01, power & 0xff], 'motor' + port);
  }

  stopAll() {
    if (!this.connected) return Promise.resolve();
    return Promise.all([this.setMotor(1, 0), this.setMotor(2, 0)]);
  }

  setLed(r, g, b) {
    return this.write(this.outputChar, [LED_CONNECT_ID, 0x04, 0x03, r & 0xff, g & 0xff, b & 0xff], 'light');
  }

  // Play a note on the hub's built-in beeper. [connectId, command = play tone, length 4, frequency, duration in ms].
  playTone(freq, ms) {
    freq = Math.max(100, Math.min(1500, Math.round(Number(freq) || 440)));
    ms = Math.max(0, Math.min(65535, Math.round(Number(ms) || 0)));
    return this.write(this.outputChar, [PIEZO_CONNECT_ID, 0x02, 0x04, freq & 0xff, freq >> 8, ms & 0xff, ms >> 8]);
  }
  stopTone() { return this.write(this.outputChar, [PIEZO_CONNECT_ID, 0x03, 0x00]); }

  hasSensor(type) { return this.ports[1] === type || this.ports[2] === type; }

  // Motion sensor distance, 0 (very close) to 100 (nothing near), or null if there's no motion sensor.
  get distance() {
    if (!this.hasSensor(TYPE.MOTION) || this.distanceRaw === null) return null;
    return Math.min(100, this.distanceRaw * 10);
  }

  // How far the tilt sensor is tipped towards a direction ('up', 'down', 'left', 'right'), in degrees.
  tiltAngle(direction) {
    if (!this.hasSensor(TYPE.TILT) || !this.tiltRaw) return null;
    const { x, y } = this.tiltRaw;
    switch (direction) {
      case 'up': return y > 45 ? 256 - y : -y;
      case 'down': return y > 45 ? y - 256 : y;
      case 'left': return x > 45 ? 256 - x : -x;
      case 'right': return x > 45 ? x - 256 : x;
    }
    return null;
  }
  // Whether the tilt sensor is tipped towards a direction, or in any direction for 'any'.
  isTilted(direction) {
    const dirs = direction === 'any' ? ['up', 'down', 'left', 'right'] : [direction];
    return dirs.some(d => (this.tiltAngle(d) || 0) >= TILT_THRESHOLD);
  }

  // Why Bluetooth can't be used here, or null if it can.
  static bluetoothProblem() {
    if (!window.isSecureContext) return 'Bluetooth needs a secure page. Open the app from its https:// address (for example GitHub Pages), not from a file or http:// link.';
    if (!navigator.bluetooth) return "This browser doesn't support Bluetooth. On iPhone/iPad, open this page in the free Bluefy browser. On other devices, use Chrome or Edge.";
    if (window.top !== window.self) return 'This page is shown inside a preview frame, which blocks Bluetooth. Open it directly in the browser.';
    return null;
  }
}

WeDoHub.TYPE = TYPE;
WeDoHub.TYPE_NAMES = TYPE_NAMES;
WeDoHub.COLORS = COLORS;
window.WeDoHub = WeDoHub;
})();
