// Port of ErrorCode.cs, UBApdu.cs and UBFingerPrintCard.cs
'use strict';

const ErrorCodes = {
  NO_ERROR: 0x9000,
  UNKNOWN: 0x6F00,
  UNDEFINE: 0x6FFF,

  FP_READY: 0x10000,
  FP_PROCESSING: 0x10001,
  FP_FAILED: 0x10002,
  FP_DETECTED: 0x10003,
  FP_ERROR: 0x10004,

  ERR_DISCONNECT: 0x20001,
  ERR_NOT_FP_CARD: 0x20002,
  ERR_FP_DATA_NONE: 0x20003,
  ERR_AUTH_FAIL: 0x20004,
  ERR_TIMEOUT: 0x20005,
  ERR_EXCEPTION: 0x20006,
};

const LEGACY_APPLET_VERSION = 'UBIVELOX_BVH_V1.02_220905';

// Equivalent of GS.Apdu.RespApdu: data is null when the response carries only SW1SW2,
// respLength counts data + SW.
class RespApdu {
  constructor(raw) {
    if (raw.length < 2) throw new Error('Response APDU too short');
    this.respLength = raw.length;
    this.sw1 = raw[raw.length - 2];
    this.sw2 = raw[raw.length - 1];
    this.sw1sw2 = (this.sw1 << 8) | this.sw2;
    this.data = raw.length > 2 ? raw.slice(0, raw.length - 2) : null;
  }

  // Indexing past the data in C# threw IndexOutOfRangeException; keep that behaviour explicit.
  need(n) {
    if (!this.data || this.data.length < n) {
      throw new Error('Unexpected response length (' + (this.data ? this.data.length : 0) + ' bytes, expected ' + n + ')');
    }
    return this.data;
  }
}

// Port of UBApdu: transmit with log + automatic GET RESPONSE on 61xx.
class UBApdu {
  constructor(bridge, log) {
    this.bridge = bridge;
    this.log = log;
    this.queue = Promise.resolve();
  }

  // Serialise card access: the WinForms tool relied on the UI thread for this.
  apduTransmit(apdu) {
    const run = () => this._transmit(apdu);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async _transmit(apdu) {
    this.log('[Command]', 'violet', true, true);
    this.log(Hex.from(apdu), 'black', false, true);

    let resp = new RespApdu(await this.bridge.transmit(apdu));

    if (resp.sw1 === 0x61) {
      const getResponse = new Uint8Array([0x00, 0xC0, 0x00, 0x00, resp.sw2]);
      resp = new RespApdu(await this.bridge.transmit(getResponse));
    }

    this.log('[Response]', 'violet', true, true);
    if (resp.data) this.log(Hex.from(resp.data), 'black', false, true);
    const sw = resp.sw1sw2.toString(16).toUpperCase();
    this.log(sw, (resp.sw1 === 0x91 || resp.sw1 === 0x90) ? 'blue' : 'red', false, true);

    return resp;
  }
}

class UBFingerPrintCard {
  static NA_STATE = 0;
  static MATCHED_STATE = 1;
  static FAILED_STATE = 2;

  // keyProvider() -> { enc, mac, dek } (Uint8Array x3) or null for the default keys
  constructor(bridge, log, keyProvider) {
    this.fpcApdu = new UBApdu(bridge, log);
    this.keyProvider = keyProvider;

    this.seleted = false;
    this.appInit = false;
    this.fpcEnrolled = false;
    this.fpcBlocked = false;
    this.cardAuth = false;
    this.mcuVerMajor = 0xFF;
    this.mcuVerMinor = 0xFF;
    this.mcuVersion = 0xFFFF;
    this.appVersion = 'None';
    this.tempSize = 0;
    this.trCnt = 0;
    this.sensorFirstResult = 0;
    this.sensorSecondResult = 0;
    this.sensorThirdResult = 0;
    this.securityOption = [0, 0, 0];
    this.enrollmentStatus = [0, 0];
    this.targetNum = [16, 16];
    this.enrollmentCnt = [0, 0];
    this.templateActivationStatus = [0, 0];
    this.selectedFinger = 0;
  }

  // Applets whose version string is not 25 chars, or V1.02_220905, use the old command set.
  isLegacyApplet() {
    return this.appVersion.length !== 25 || this.appVersion === LEGACY_APPLET_VERSION;
  }

  transmit(bytes) {
    return this.fpcApdu.apduTransmit(new Uint8Array(bytes));
  }

  disconnect() {
    this.seleted = false;
    this.cardAuth = false;
  }

  async selectApplet() {
    const resp = await this.transmit([0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x03, 0x11, 0x00, 0x10]);
    this.cardAuth = false;
    this.seleted = resp.sw1sw2 === 0x9000;
    return this.seleted ? ErrorCodes.NO_ERROR : ErrorCodes.UNDEFINE;
  }

  // Sends INITIALIZE; the caller then polls initContinue() (the 750 ms init timer).
  async cardInitialize() {
    if (this.seleted && !this.appInit) {
      const resp = await this.transmit([0x80, 0xE0, 0x00, 0x00, 0x00]);
      return resp.sw1sw2 === 0x9000 ? ErrorCodes.NO_ERROR : ErrorCodes.UNDEFINE;
    }
    return ErrorCodes.UNDEFINE;
  }

  async sensorSelfTest() {
    const resp = await this.transmit([0x80, 0xEA, 0xC0, 0x58, 0x0C]);
    if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;

    const d = resp.need(12);
    const int32 = (o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]);
    this.sensorFirstResult = int32(0);
    this.sensorSecondResult = int32(4);
    this.sensorThirdResult = int32(8);
    return ErrorCodes.NO_ERROR;
  }

  async getInformation() {
    if (!this.seleted) return ErrorCodes.NO_ERROR;

    let resp = await this.transmit([0x00, 0xCA, 0x00, 0x00, 0x19]);
    if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;
    this.appVersion = resp.data ? String.fromCharCode(...resp.data) : '';

    resp = await this.transmit([0x00, 0xCA, 0x00, 0x03, 0x02]);
    if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;
    const mcu = resp.need(2);
    this.mcuVerMajor = mcu[0];
    this.mcuVerMinor = mcu[1];

    if (this.isLegacyApplet()) {
      resp = await this.transmit([0x00, 0xCA, 0x00, 0x04, 0x01]);
      if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;
      this.appInit = resp.need(1)[0] === 0x0F;
    } else {
      resp = await this.transmit([0x00, 0xCA, 0x00, 0x04, 0x03]);
      if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;

      if (resp.respLength === 5 || resp.respLength === 6 || resp.respLength === 7) {
        this._setSecurityOption(resp);
      } else if (resp.respLength === 3) {
        resp = await this.transmit([0x00, 0xCA, 0x00, 0x04, 0x04]);
        if (resp.sw1sw2 !== 0x9000 || resp.respLength !== 6) return ErrorCodes.UNDEFINE;
        this._setSecurityOption(resp);
      } else if (resp.respLength === 4) {
        resp = await this.transmit([0x00, 0xCA, 0x00, 0x04, 0x05]);
        if (resp.sw1sw2 !== 0x9000 || resp.respLength !== 7) return ErrorCodes.UNDEFINE;
        this._setSecurityOption(resp);
      } else {
        return ErrorCodes.UNDEFINE;
      }
    }

    for (let finger = 0; finger < 2; finger++) {
      resp = await this.transmit([0x80, 0xE8, 0x00, finger, 0x05]);
      if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;

      const d = resp.need(5);
      this.enrollmentStatus[finger] = d[0];
      if (this.selectedFinger === finger) {
        this.fpcEnrolled = d[0] === 0x02 || d[0] === 0x03;
      }
      this.targetNum[finger] = d[1];
      this.enrollmentCnt[finger] = d[2];
      this.templateActivationStatus[finger] = (d[3] << 8) | d[4];
    }

    return ErrorCodes.NO_ERROR;
  }

  _setSecurityOption(resp) {
    const d = resp.need(3);
    this.securityOption[0] = d[0];
    this.securityOption[1] = d[1];
    this.securityOption[2] = d[2];
  }

  // finger: 0, 1, or 2 (= all)
  async deleteTemplate(finger) {
    const p2 = finger === 0 ? 0x00 : (finger === 1 ? 0x01 : 0x02);
    const resp = await this.transmit([0x80, 0xE4, 0x00, p2, 0x00]);
    if (resp.sw1sw2 === 0x9000) {
      this.fpcEnrolled = false;
      this.tempSize = 0;
      return ErrorCodes.NO_ERROR;
    }
    return ErrorCodes.UNDEFINE;
  }

  // SCP02 mutual authentication (INITIALIZE UPDATE + EXTERNAL AUTHENTICATE)
  async cardAuthenticate() {
    this.cardAuth = false;

    const terminalRandom = crypto.getRandomValues(new Uint8Array(8));
    const initUpdate = new Uint8Array(13);
    initUpdate.set([0x80, 0x50, 0x00, 0x00, 0x08], 0);
    initUpdate.set(terminalRandom, 5);

    const resp = await this.fpcApdu.apduTransmit(initUpdate);
    if (resp.sw1sw2 !== 0x9000) return ErrorCodes.UNDEFINE;

    const d = resp.need(28);
    const scp = d[11];
    const cardRandom = d.slice(12, 20);

    // secure protocol '02' only
    if (scp !== 0x02) return ErrorCodes.UNDEFINE;

    const keys = this.keyProvider ? this.keyProvider() : null;
    const scp02 = keys ? new UBScp02(keys.enc, keys.mac, keys.dek) : new UBScp02();
    scp02.makeSessionKeys(cardRandom);
    const exAuth = scp02.makeExternalAuthData(cardRandom, terminalRandom);

    const respEA = await this.fpcApdu.apduTransmit(exAuth);
    if (respEA.sw1sw2 === 0x9000) {
      this.cardAuth = true;
      return ErrorCodes.NO_ERROR;
    }
    return ErrorCodes.UNDEFINE;
  }

  async cancel() {
    const resp = await this.transmit([0x80, 0xF2, 0x00, 0x00, 0x00]);
    return resp.sw1sw2 === 0x9000 ? ErrorCodes.NO_ERROR : ErrorCodes.UNDEFINE;
  }

  async enrollment() {
    const resp = await this.transmit([0x80, 0xE6, 0x00, this.selectedFinger === 0 ? 0x00 : 0x01, 0x00]);
    switch (resp.sw1sw2) {
      case 0x6202: return ErrorCodes.FP_PROCESSING;
      case 0x6203: return ErrorCodes.FP_DETECTED;
      case 0x6204: return ErrorCodes.FP_ERROR;
      case 0x9000: return ErrorCodes.NO_ERROR;
      default: return ErrorCodes.UNDEFINE;
    }
  }

  // Legacy applets: continue an enrollment started with enrollment()
  async continueEnrollment() {
    const resp = await this.transmit([0x80, 0xF0, 0x00, this.selectedFinger === 0 ? 0x00 : 0x01, 0x00]);
    switch (resp.sw1sw2) {
      case 0x6202: return ErrorCodes.FP_PROCESSING;
      case 0x6203: return ErrorCodes.FP_DETECTED;
      case 0x6200: return ErrorCodes.FP_PROCESSING;
      case 0x6204: return ErrorCodes.FP_ERROR;
      case 0x9000: return ErrorCodes.NO_ERROR;
      default: return ErrorCodes.UNDEFINE;
    }
  }

  // One tick of the initialization poll. Returns true while the card is still busy (SW 6200).
  async initContinue() {
    const resp = await this.transmit([0x80, 0xF0, 0x00, 0x00, 0x00]);
    if (resp.sw1sw2 === 0x6200) return true;
    await this.getInformation();
    return false;
  }

  async fingerPrintIsValidate() {
    const cmd = this.isLegacyApplet()
      ? [0x00, 0xCA, 0x00, 0x05, 0x01]
      : [0x80, 0xE2, 0x00, 0x00, 0x01];

    const resp = await this.transmit(cmd);
    if (resp.sw1sw2 === 0x9000) {
      const state = resp.need(1)[0];
      if (state === UBFingerPrintCard.MATCHED_STATE) return ErrorCodes.NO_ERROR;
      if (state === UBFingerPrintCard.NA_STATE) return ErrorCodes.FP_PROCESSING;
      return ErrorCodes.FP_FAILED;
    }
    return ErrorCodes.UNDEFINE;
  }

  async sendApdu(hex) {
    if (hex.length < 255) {
      await this.fpcApdu.apduTransmit(Hex.to(hex));
      return ErrorCodes.NO_ERROR;
    }
    return ErrorCodes.UNDEFINE;
  }
}
