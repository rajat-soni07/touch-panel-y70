// Discord voice widget — talks to the local Discord client over its RPC named pipe.
// Shows the current voice channel, who's in it and who's speaking, and toggles mute / deafen.
//
// Needs a Discord developer app (client id + secret) in discord-auth.json; the first connect
// pops up an "authorize" dialog inside Discord, after which tokens are kept in the same file.

const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_PATH = path.join(__dirname, 'discord-auth.json');
const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const REDIRECT_URI = 'http://localhost';
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];
const RETRY_MS = 10000;
const ERROR_RETRY_MS = 60000;

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveAuth(auth) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  const idx = Number((BigInt(user.id) >> 22n) % 6n); // Discord's default-avatar rule
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// Deafening also cuts your mic in Discord, but the settings only report deaf: true — show both.
function selfFrom(vs) {
  return { mute: !!(vs.mute || vs.deaf), deaf: !!vs.deaf };
}

function memberFrom(vs) {
  const u = vs.user;
  const v = vs.voice_state || {};
  return {
    id: u.id,
    name: vs.nick || u.global_name || u.username,
    avatar: avatarUrl(u),
    muted: !!(v.self_mute || v.mute),
    deaf: !!(v.self_deaf || v.deaf),
  };
}

class DiscordVoice {
  constructor(onState) {
    this.onState = onState;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.pending = new Map(); // nonce -> { resolve, reject }
    this.stopped = true;
    this.retryTimer = null;
    this.reset('connecting');
  }

  reset(status, message) {
    this.status = status;
    this.message = message || '';
    this.channel = null; // { id, name, guild }
    this.members = new Map();
    this.speaking = new Set();
    this.self = { mute: false, deaf: false };
    this.guilds = this.guilds || new Map();
  }

  emit() {
    this.onState({
      status: this.status,
      message: this.message,
      channel: this.channel && { name: this.channel.name, guild: this.channel.guild },
      members: [...this.members.values()].map((m) => ({ ...m, speaking: this.speaking.has(m.id) })),
      self: this.self,
    });
  }

  setStatus(status, message) {
    this.status = status;
    this.message = message || '';
    this.emit();
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    if (this.sock) this.sock.destroy();
  }

  scheduleRetry(ms = RETRY_MS) {
    clearTimeout(this.retryTimer);
    if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), ms);
  }

  // ---------- pipe ----------

  connect() {
    if (this.stopped || this.sock) return;
    const auth = readAuth();
    if (!auth.clientId || !auth.clientSecret) {
      this.reset('setup');
      this.emit();
      return this.scheduleRetry();
    }
    this.tryPipe(0, auth.clientId);
  }

  tryPipe(i, clientId) {
    if (i > 9) {
      this.reset('closed'); // Discord isn't running
      this.emit();
      return this.scheduleRetry();
    }
    const sock = net.createConnection(`\\\\?\\pipe\\discord-ipc-${i}`);
    sock.once('error', () => {
      sock.destroy();
      if (this.sock !== sock) this.tryPipe(i + 1, clientId);
    });
    sock.once('connect', () => {
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      sock.removeAllListeners('error');
      sock.on('error', () => sock.destroy());
      sock.on('data', (d) => this.onData(d));
      sock.on('close', () => this.onClose());
      this.reset('connecting');
      this.emit();
      this.write(OP.HANDSHAKE, { v: 1, client_id: clientId });
    });
  }

  write(op, obj) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(json.length, 4);
    this.sock.write(Buffer.concat([head, json]));
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let msg = null;
      try {
        msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8'));
      } catch {}
      this.buf = this.buf.subarray(8 + len);

      if (op === OP.PING) this.write(OP.PONG, msg);
      else if (op === OP.CLOSE) {
        this.closeMessage = (msg && msg.message) || 'Discord closed the connection';
        this.sock.destroy();
      } else if (op === OP.FRAME && msg) this.onMessage(msg);
    }
  }

  onClose() {
    this.sock = null;
    for (const p of this.pending.values()) p.reject(new Error('Disconnected from Discord'));
    this.pending.clear();
    const failed = !!this.closeMessage;
    if (failed) {
      this.reset('error', this.closeMessage);
      this.closeMessage = null;
    } else {
      this.reset('closed');
    }
    this.emit();
    // After an error wait longer, so a declined Authorize popup doesn't reappear every few seconds.
    this.scheduleRetry(failed ? ERROR_RETRY_MS : RETRY_MS);
  }

  request(cmd, args = {}, evt) {
    if (!this.sock) return Promise.reject(new Error('Not connected to Discord'));
    const nonce = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      this.write(OP.FRAME, { cmd, args, evt, nonce });
    });
  }

  subscribe(evt, args) {
    return this.request('SUBSCRIBE', args, evt);
  }

  unsubscribe(evt, args) {
    return this.request('UNSUBSCRIBE', args, evt).catch(() => {});
  }

  // ---------- messages ----------

  onMessage(msg) {
    if (msg.nonce && this.pending.has(msg.nonce)) {
      const p = this.pending.get(msg.nonce);
      this.pending.delete(msg.nonce);
      if (msg.evt === 'ERROR') {
        const err = new Error(msg.data.message);
        err.code = msg.data.code;
        p.reject(err);
      } else {
        p.resolve(msg.data);
      }
      return;
    }
    if (msg.cmd !== 'DISPATCH') return;

    const d = msg.data || {};
    switch (msg.evt) {
      case 'READY':
        // A failed login would otherwise sit on an open pipe forever; drop it so onClose retries.
        this.login().catch((e) => {
          this.closeMessage = e.message;
          if (this.sock) this.sock.destroy();
        });
        break;
      case 'VOICE_CHANNEL_SELECT':
        this.selectChannel(d.channel_id).catch(() => {});
        break;
      case 'VOICE_SETTINGS_UPDATE':
        this.self = selfFrom(d);
        this.emit();
        break;
      case 'VOICE_STATE_CREATE':
      case 'VOICE_STATE_UPDATE':
        if (d.user) this.members.set(d.user.id, memberFrom(d));
        this.emit();
        break;
      case 'VOICE_STATE_DELETE':
        if (d.user) {
          this.members.delete(d.user.id);
          this.speaking.delete(d.user.id);
        }
        this.emit();
        break;
      case 'SPEAKING_START':
        this.speaking.add(d.user_id);
        this.emit();
        break;
      case 'SPEAKING_STOP':
        this.speaking.delete(d.user_id);
        this.emit();
        break;
    }
  }

  // ---------- auth ----------

  async login() {
    let auth = readAuth();
    if (!auth.accessToken || Date.now() > (auth.expiresAt || 0) - 60000) {
      auth = auth.refreshToken ? await this.refresh(auth).catch(() => this.authorize(auth)) : await this.authorize(auth);
    }
    try {
      await this.request('AUTHENTICATE', { access_token: auth.accessToken });
    } catch (e) {
      // Token revoked or expired early: get a fresh one once.
      auth = await this.authorize(auth);
      await this.request('AUTHENTICATE', { access_token: auth.accessToken });
    }
    await this.onAuthenticated();
  }

  async authorize(auth) {
    this.setStatus('auth');
    const { code } = await this.request('AUTHORIZE', { client_id: auth.clientId, scopes: SCOPES });
    return this.token(auth, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  }

  refresh(auth) {
    return this.token(auth, { grant_type: 'refresh_token', refresh_token: auth.refreshToken });
  }

  async token(auth, params) {
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: auth.clientId, client_secret: auth.clientSecret, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Discord token request failed: ${body.error_description || body.error || res.status}`);
    const next = {
      ...auth,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    saveAuth(next);
    return next;
  }

  async onAuthenticated() {
    await this.subscribe('VOICE_CHANNEL_SELECT');
    await this.subscribe('VOICE_SETTINGS_UPDATE');
    const vs = await this.request('GET_VOICE_SETTINGS');
    this.self = selfFrom(vs);
    this.status = 'ready';
    const ch = await this.request('GET_SELECTED_VOICE_CHANNEL');
    await this.setChannel(ch);
  }

  // ---------- voice channel ----------

  async selectChannel(channelId) {
    const ch = channelId ? await this.request('GET_CHANNEL', { channel_id: channelId }) : null;
    await this.setChannel(ch);
  }

  async setChannel(ch) {
    if (this.channel) {
      const old = { channel_id: this.channel.id };
      await Promise.all(CHANNEL_EVENTS.map((e) => this.unsubscribe(e, old)));
    }
    this.members = new Map();
    this.speaking = new Set();
    this.channel = null;

    if (ch) {
      this.channel = { id: ch.id, name: ch.name, guild: await this.guildName(ch.guild_id) };
      for (const vs of ch.voice_states || []) if (vs.user) this.members.set(vs.user.id, memberFrom(vs));
      await Promise.all(CHANNEL_EVENTS.map((e) => this.subscribe(e, { channel_id: ch.id })));
    }
    this.emit();
  }

  async guildName(guildId) {
    if (!guildId) return 'Direct call';
    if (!this.guilds.has(guildId)) {
      const g = await this.request('GET_GUILD', { guild_id: guildId }).catch(() => null);
      this.guilds.set(guildId, g ? g.name : '');
    }
    return this.guilds.get(guildId);
  }

  // ---------- controls ----------

  async toggle(kind) {
    if (this.status !== 'ready') return { ok: false, err: 'Discord is not connected' };
    let args;
    if (kind === 'deaf') args = { deaf: !this.self.deaf };
    // Like Discord's mic button: unmuting while deafened also undeafens.
    else if (this.self.deaf) args = { deaf: false, mute: false };
    else args = { mute: !this.self.mute };
    try {
      const vs = await this.request('SET_VOICE_SETTINGS', args);
      this.self = selfFrom(vs);
      this.emit();
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }
}

module.exports = { DiscordVoice };
