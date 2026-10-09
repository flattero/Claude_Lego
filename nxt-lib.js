// Talks to a LEGO MINDSTORMS NXT brick over USB (WebUSB) or Bluetooth (Web Serial),
// using the "direct commands" from LEGO's MINDSTORMS NXT Bluetooth Developer Kit.
// Over USB a command is sent as-is; over Bluetooth it is prefixed with a 2-byte little-endian length.
// Shared by nxt.html (remote control) and code.html (block coding).
(function () {
'use strict';

const NXT_USB = { vendorId: 0x0694, productId: 0x0002 };
const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb'; // Bluetooth Serial Port Profile

const DIRECT_REPLY = 0x00, DIRECT_NO_REPLY = 0x80, SYSTEM_REPLY = 0x01;
const CMD = {
  PLAY_TONE: 0x03, SET_OUTPUT_STATE: 0x04, SET_INPUT_MODE: 0x05, GET_OUTPUT_STATE: 0x06, GET_INPUT_VALUES: 0x07,
  GET_BATTERY: 0x0B, KEEP_ALIVE: 0x0D, LS_GET_STATUS: 0x0E, LS_WRITE: 0x0F, LS_READ: 0x10, GET_DEVICE_INFO: 0x9B,
};
const MODE_MOTORON = 0x01, MODE_BRAKE = 0x02, MODE_REGULATED = 0x04;
const REG_SPEED = 0x01, RUN_STATE_RUNNING = 0x20;
// Sensor types and modes for SET_INPUT_MODE.
const TYPE = { NONE: 0x00, SWITCH: 0x01, LIGHT_ACTIVE: 0x05, LIGHT_INACTIVE: 0x06, SOUND_DB: 0x07, LOWSPEED_9V: 0x0B };
const SMODE = { RAW: 0x00, BOOLEAN: 0x20, PERCENT: 0x80 };
const STATUS_PENDING = 0x20;
const ULTRASONIC_I2C_ADDR = 0x02, US_REG_COMMAND = 0x41, US_REG_DISTANCE = 0x42, US_CONTINUOUS = 0x02;

// What can be plugged into a sensor port, and how to read it.
const SENSOR_KINDS = {
  none:       { label: 'Nothing',                 type: TYPE.NONE,           mode: SMODE.RAW },
  touch:      { label: 'Touch sensor',            type: TYPE.SWITCH,         mode: SMODE.BOOLEAN, unit: '' },
  lightOn:    { label: 'Light sensor (lamp on)',  type: TYPE.LIGHT_ACTIVE,   mode: SMODE.PERCENT, unit: '%' },
  lightOff:   { label: 'Light sensor (lamp off)', type: TYPE.LIGHT_INACTIVE, mode: SMODE.PERCENT, unit: '%' },
  sound:      { label: 'Sound sensor',            type: TYPE.SOUND_DB,       mode: SMODE.PERCENT, unit: '%' },
  ultrasonic: { label: 'Ultrasonic sensor',       type: TYPE.LOWSPEED_9V,    mode: SMODE.RAW,     unit: ' cm' },
};
// The standard set 9797 robot layout.
const DEFAULT_SENSORS = ['touch', 'sound', 'lightOn', 'ultrasonic'];

const sleep = ms => new Promise(res => setTimeout(res, ms));
const int16 = (r, i) => (r[i] | (r[i + 1] << 8)) << 16 >> 16;
const int32 = (r, i) => r[i] | (r[i + 1] << 8) | (r[i + 2] << 16) | (r[i + 3] << 24);

// --- USB transport (WebUSB) ---
async function openUsb() {
  const dev = await navigator.usb.requestDevice({ filters: [NXT_USB] });
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  await dev.claimInterface(0);
  const eps = dev.configuration.interfaces[0].alternate.endpoints;
  const outEp = (eps.find(e => e.direction === 'out') || { endpointNumber: 1 }).endpointNumber;
  const inEp = (eps.find(e => e.direction === 'in') || { endpointNumber: 2 }).endpointNumber;
  return {
    name: 'USB',
    device: dev,
    send: bytes => dev.transferOut(outEp, bytes),
    async request(bytes) {
      await dev.transferOut(outEp, bytes);
      const res = await dev.transferIn(inEp, 64);
      return new Uint8Array(res.data.buffer);
    },
    close: () => dev.close(),
  };
}

// --- Bluetooth transport (Web Serial over the brick's serial port profile) ---
async function openSerial(onClosed, log) {
  const port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
  await port.open({ baudRate: 115200 });
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let buf = new Uint8Array(0);
  let waiting = null; // { cmd, port, resolve, reject } for the reply we're waiting for

  // Pull complete packets out of the buffer. Only a reply to the command we're waiting
  // for is delivered; anything else (such as a reply that arrived too late) is dropped.
  function tryDeliver() {
    while (buf.length >= 2) {
      const len = buf[0] | (buf[1] << 8);
      if (buf.length < 2 + len) return;
      const pkt = buf.slice(2, 2 + len);
      buf = buf.slice(2 + len);
      if (waiting && pkt[0] === 0x02 && pkt[1] === waiting.cmd && (waiting.port === null || pkt[3] === waiting.port)) {
        const w = waiting; waiting = null; w.resolve(pkt);
      }
    }
  }
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf); next.set(value, buf.length);
        buf = next;
        tryDeliver();
      }
    } catch (err) {
      log('Bluetooth read stopped: ' + err.message);
    }
    if (waiting) waiting.reject(new Error('Connection closed'));
    onClosed();
  })();

  const frame = bytes => {
    const out = new Uint8Array(bytes.length + 2);
    out[0] = bytes.length & 0xff; out[1] = bytes.length >> 8;
    out.set(bytes, 2);
    return out;
  };
  return {
    name: 'Bluetooth',
    port,
    send: bytes => writer.write(frame(bytes)),
    async request(bytes, timeoutMs = 3000) {
      buf = new Uint8Array(0); // discard anything stale before asking
      const reply = new Promise((resolve, reject) => {
        // Sensor and motor readings echo the port number, so check that too.
        const echoesPort = bytes[1] === CMD.GET_INPUT_VALUES || bytes[1] === CMD.GET_OUTPUT_STATE;
        waiting = { cmd: bytes[1], port: echoesPort ? bytes[2] : null, resolve, reject };
        setTimeout(() => { if (waiting && waiting.resolve === resolve) { waiting = null; reject(new Error('No reply from brick')); } }, timeoutMs);
      });
      await writer.write(frame(bytes));
      return reply;
    },
    async close() {
      // Never let a stuck Bluetooth link stop the port from being released.
      const step = p => Promise.race([Promise.resolve(p).catch(() => {}), sleep(1000)]);
      await step(reader.cancel());
      try { reader.releaseLock(); } catch (e) {}
      await step(writer.close());
      try { writer.releaseLock(); } catch (e) {}
      await step(port.close());
    },
  };
}

class NXTBrick {
  // log(msg): where to write log lines. onDisconnect(): called when the connection drops or is closed.
  constructor({ log = () => {}, onDisconnect = () => {} } = {}) {
    this.log = log;
    this.onDisconnect = onDisconnect;
    this.link = null;
    this.name = null;
    this.queue = Promise.resolve();
    this.timer = null;
  }

  get connected() { return !!this.link; }

  // Only one command may be in flight at a time, so queue everything.
  enqueue(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(err => this.log('Command failed: ' + err.message));
    return p;
  }
  send(bytes) { return this.enqueue(() => this.link && this.link.send(new Uint8Array(bytes))); }
  request(bytes) {
    return this.enqueue(() => this.link ? this.link.request(new Uint8Array(bytes)) : Promise.reject(new Error('Not connected')));
  }

  // kind: 'usb' or 'bt'. Resolves with the brick's name.
  async connect(kind) {
    const link = kind === 'usb'
      ? await openUsb()
      : await openSerial(() => { if (this.link === link) this.handleDrop(); }, this.log);
    this.link = link;
    try {
      let name = null;
      if (kind === 'bt') {
        // The Bluetooth link can take a moment to settle, and the first message is sometimes lost.
        await sleep(500);
        for (let attempt = 1; name === null; attempt++) {
          try { name = await this.readName(); }
          catch (err) {
            if (attempt >= 3) throw err;
            this.log('No answer yet, trying again…');
          }
        }
      } else {
        name = await this.readName();
      }
      this.name = name;
      // Keep the brick from going to sleep while connected.
      this.timer = setInterval(() => this.send([DIRECT_NO_REPLY, CMD.KEEP_ALIVE]), 30000);
      if (link.device && navigator.usb) {
        this.usbListener = e => { if (this.link === link && e.device === link.device) this.handleDrop(); };
        navigator.usb.addEventListener('disconnect', this.usbListener);
      }
      return name;
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  async close() {
    clearInterval(this.timer); this.timer = null;
    if (this.usbListener) {
      try { navigator.usb.removeEventListener('disconnect', this.usbListener); } catch (e) {}
      this.usbListener = null;
    }
    const l = this.link; this.link = null;
    this.queue = Promise.resolve();
    if (l) { try { await l.close(); } catch (e) {} }
  }

  // Stop the motors, then close the connection.
  async disconnect() {
    if (!this.link) return;
    this.stopAll();
    await this.queue;
    await this.close();
    this.onDisconnect();
  }

  handleDrop() {
    this.close();
    this.onDisconnect();
  }

  // power: -100..100. 0 lets the motor coast to a stop.
  // tachoLimit: degrees to turn before the brick stops the motor by itself (0 = keep going).
  setMotor(port, power, tachoLimit = 0) {
    if (power === 0) {
      return this.send([DIRECT_NO_REPLY, CMD.SET_OUTPUT_STATE, port, 0, 0x00, 0x00, 0, 0x00, 0, 0, 0, 0]);
    }
    const p = Math.max(-100, Math.min(100, Math.round(power))) & 0xff;
    const t = Math.max(0, Math.round(tachoLimit));
    // Regulated speed control keeps the speed steady under load.
    return this.send([DIRECT_NO_REPLY, CMD.SET_OUTPUT_STATE, port, p,
      MODE_MOTORON | MODE_BRAKE | MODE_REGULATED, REG_SPEED, 0, RUN_STATE_RUNNING,
      t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff]);
  }

  // Stop a motor firmly (brake) instead of coasting.
  brakeMotor(port) {
    return this.send([DIRECT_NO_REPLY, CMD.SET_OUTPUT_STATE, port, 0,
      MODE_MOTORON | MODE_BRAKE | MODE_REGULATED, REG_SPEED, 0, RUN_STATE_RUNNING, 0, 0, 0, 0]);
  }

  stopAll() {
    if (!this.link) return Promise.resolve();
    return Promise.all([0, 1, 2].map(p => this.setMotor(p, 0)));
  }

  playTone(freq, ms = 200) {
    freq = Math.max(200, Math.min(14000, Math.round(freq)));
    ms = Math.max(0, Math.min(65535, Math.round(ms)));
    return this.send([DIRECT_NO_REPLY, CMD.PLAY_TONE, freq & 0xff, freq >> 8, ms & 0xff, ms >> 8]);
  }

  // Returns the battery voltage in millivolts.
  async readBattery() {
    const r = await this.request([DIRECT_REPLY, CMD.GET_BATTERY]);
    if (r[0] === 0x02 && r[1] === CMD.GET_BATTERY && r[2] === 0) return r[3] | (r[4] << 8);
    return null;
  }

  async readName() {
    const r = await this.request([SYSTEM_REPLY, CMD.GET_DEVICE_INFO]);
    if (r[0] === 0x02 && r[1] === CMD.GET_DEVICE_INFO && r[2] === 0) {
      const nameBytes = r.slice(3, 18);
      const end = nameBytes.indexOf(0);
      return new TextDecoder().decode(end >= 0 ? nameBytes.slice(0, end) : nameBytes);
    }
    return 'NXT';
  }

  // Tell the brick what is on a sensor port (port 0-3, kindKey from SENSOR_KINDS).
  async configureSensor(port, kindKey) {
    const kind = SENSOR_KINDS[kindKey];
    await this.request([DIRECT_REPLY, CMD.SET_INPUT_MODE, port, kind.type, kind.mode]);
    if (kind.type === TYPE.LOWSPEED_9V) {
      await sleep(100); // give the ultrasonic sensor time to power up
      // Put it in continuous measurement mode (usually already the default).
      await this.request([DIRECT_REPLY, CMD.LS_WRITE, port, 3, 0, ULTRASONIC_I2C_ADDR, US_REG_COMMAND, US_CONTINUOUS]).catch(() => {});
      await this.lsWaitForBytes(port, 0).catch(() => {});
    }
  }

  // Wait until a low-speed (I2C) transfer has finished and `count` bytes are ready to read.
  async lsWaitForBytes(port, count) {
    for (let i = 0; i < 20; i++) {
      const r = await this.request([DIRECT_REPLY, CMD.LS_GET_STATUS, port]);
      if (r[2] === 0 && r[3] >= count) return true;
      if (r[2] !== 0 && r[2] !== STATUS_PENDING) return false;
      await sleep(10);
    }
    return false;
  }

  // Returns the distance in cm, or null if the sensor didn't answer. 255 means nothing in range.
  async readUltrasonic(port) {
    const w = await this.request([DIRECT_REPLY, CMD.LS_WRITE, port, 2, 1, ULTRASONIC_I2C_ADDR, US_REG_DISTANCE]);
    if (w[2] !== 0) return null;
    if (!(await this.lsWaitForBytes(port, 1))) return null;
    const r = await this.request([DIRECT_REPLY, CMD.LS_READ, port]);
    return r[2] === 0 && r[3] >= 1 ? r[4] : null;
  }

  // Returns the sensor's value: 0/1 for touch, 0-100 for light and sound, cm for ultrasonic. null if unreadable.
  async readSensor(port, kindKey) {
    const kind = SENSOR_KINDS[kindKey];
    if (kind.type === TYPE.NONE) return null;
    if (kind.type === TYPE.LOWSPEED_9V) return this.readUltrasonic(port);
    const r = await this.request([DIRECT_REPLY, CMD.GET_INPUT_VALUES, port]);
    if (r[1] !== CMD.GET_INPUT_VALUES || r[2] !== 0) return null;
    return int16(r, 12); // scaled value
  }

  // Degrees the motor has turned (from the brick's rotation counter).
  async readRotation(port) {
    const r = await this.request([DIRECT_REPLY, CMD.GET_OUTPUT_STATE, port]);
    if (r[1] !== CMD.GET_OUTPUT_STATE || r[2] !== 0) return null;
    return int32(r, 21);
  }

  // A plain-English explanation of a connection error.
  static explainError(err, kind) {
    if (err.name === 'NotFoundError') return 'No brick chosen.';
    if (kind === 'usb' && (err.name === 'SecurityError' || /access denied|claim/i.test(err.message)))
      return "The brick was found but the computer wouldn't let the browser use it. On Windows, see Connection help (Zadig).";
    if (kind === 'bt' && err.name === 'NetworkError')
      return "The computer couldn't open a Bluetooth connection to the brick. Check the brick is on and awake, " +
        "close any other tab or program using it, then turn the brick's Bluetooth off and on again (or restart the brick) and retry. " +
        'On Windows, choose the port marked "Outgoing" (see Connection help).';
    if (kind === 'bt' && /no reply/i.test(err.message))
      return "The connection opened but the brick didn't answer. You may have chosen the wrong port: on Windows, pick the \"Outgoing\" one " +
        '(see Connection help). Otherwise restart the brick, or remove and re-pair it in the computer\'s Bluetooth settings, and retry.';
    return 'Could not connect: ' + err.message;
  }

  // Which sensor is on which port, remembered in this browser.
  static loadSensorKinds() {
    try {
      const saved = JSON.parse(localStorage.getItem('nxtSensors'));
      if (Array.isArray(saved) && saved.length === 4 && saved.every(k => k in SENSOR_KINDS)) return saved;
    } catch (e) {}
    return DEFAULT_SENSORS.slice();
  }
  static saveSensorKinds(kinds) {
    try { localStorage.setItem('nxtSensors', JSON.stringify(kinds)); } catch (e) {}
  }

  // Why NXT can't be used in this browser, or null if it can.
  static unsupportedReason() {
    if (!window.isSecureContext) return 'This page must be opened from an https:// address.';
    if (!navigator.usb && !navigator.serial) {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        ? "Phones and tablets can't connect to an NXT brick. Open this page in Chrome or Edge on a laptop or desktop computer."
        : "This browser can't connect to an NXT brick. Use Chrome or Edge on a laptop or desktop computer.";
    }
    return null;
  }
}

NXTBrick.SENSOR_KINDS = SENSOR_KINDS;
NXTBrick.DEFAULT_SENSORS = DEFAULT_SENSORS;
NXTBrick.sleep = sleep;
window.NXTBrick = NXTBrick;
})();
