// WebSocket client for the local PC/SC bridge (PcscBridge.exe).
'use strict';

const Hex = {
  from(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  },
  to(str) {
    const s = str.replace(/\s+/g, '');
    if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('Invalid hex string');
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  },
};

class PcscBridge extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.connected = false;
    this.info = null;
  }

  open() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return this.openPromise;
    }

    this.openPromise = new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;

      ws.onopen = async () => {
        this.connected = true;
        try {
          this.info = await this.request('hello');
        } catch (e) {
          this.info = null;
        }
        settled = true;
        this.dispatchEvent(new Event('open'));
        resolve(this.info);
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg);
        else {
          const err = new Error(msg.error || 'Bridge error');
          err.code = msg.code;
          p.reject(err);
        }
      };

      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        for (const p of this.pending.values()) p.reject(new Error('PC/SC bridge connection closed'));
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(new Error('Cannot reach PC/SC bridge at ' + this.url));
        }
        if (wasConnected) this.dispatchEvent(new Event('close'));
      };
    });

    return this.openPromise;
  }

  request(cmd, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('PC/SC bridge not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(Object.assign({ id, cmd }, params || {})));
    });
  }

  async listReaders() {
    return (await this.request('listReaders')).readers || [];
  }

  async connect(reader) {
    const r = await this.request('connect', { reader });
    return { atr: r.atr, protocol: r.protocol };
  }

  async transmit(apdu) {
    const r = await this.request('transmit', { apdu: Hex.from(apdu) });
    return Hex.to(r.rapdu);
  }

  async disconnect() {
    return this.request('disconnect');
  }

  // Is the connected card still on the reader? (no APDU is sent)
  // Returns null when the bridge is too old to support it.
  async cardPresent() {
    try {
      return !!(await this.request('status')).present;
    } catch (e) {
      if (/Unknown command/i.test(e.message)) return null;
      throw e;
    }
  }
}
