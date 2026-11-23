/* The Place Value — online multiplayer.
 *
 * The host's browser is the authority: it owns the engine, rolls the dice for
 * both seats and broadcasts the serialised state after every action. The guest
 * sends placement intents and renders whatever state it is given.
 *
 * Transport is a PeerJS WebRTC data channel, so a static GitHub Pages site can
 * host real online games with no server of its own.
 */
(function (root) {
  'use strict';

  const PV = root.PlaceValue;

  const PREFIX = 'the-place-value-v1-';
  const BROKER = { host: '0.peerjs.com', port: 443, secure: true, path: '/' };
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function makeCode(length) {
    let out = '';
    const n = length || 4;
    for (let i = 0; i < n; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function peerIdForCode(code) {
    return PREFIX + normalizeCode(code);
  }

  function inviteLink(code) {
    return root.location.origin + root.location.pathname + '?join=' + normalizeCode(code);
  }

  class OnlineGame {
    constructor(opts) {
      this.role = opts.role; // 'host' | 'guest'
      this.name = opts.name || (opts.role === 'host' ? 'Host' : 'Guest');
      this.settings = opts.settings || {};
      this.onState = opts.onState || function () {};
      this.onEvent = opts.onEvent || function () {};
      this.state = null;
      this.seat = opts.role === 'host' ? 0 : 1;
      this.peer = null;
      this.conn = null;
      this.code = opts.code || null;
      this.partnerName = null;
      this.closed = false;
      this._timers = [];
    }

    later(fn, ms) {
      const id = root.setTimeout(fn, ms);
      this._timers.push(id);
      return id;
    }

    /* ------------------------------------------------------------ hosting */

    create(code) {
      const self = this;
      this.code = code || makeCode(4);
      this.peer = new root.Peer(peerIdForCode(this.code), BROKER);
      this.peer.on('open', function () {
        self.onEvent({ type: 'created', code: self.code, link: inviteLink(self.code) });
      });
      this.peer.on('connection', function (conn) {
        if (self.conn) {
          conn.on('open', function () { conn.send({ t: 'full' }); conn.close(); });
          return;
        }
        self.conn = conn;
        conn.on('data', function (d) { self.onGuestData(d); });
        conn.on('close', function () {
          self.conn = null;
          self.partnerName = null;
          self.onEvent({ type: 'peer-left' });
        });
        conn.on('error', function (err) {
          self.onEvent({ type: 'error', message: 'Connection error: ' + String(err) });
        });
      });
      this.peer.on('error', function (err) {
        const type = err && err.type ? err.type : String(err);
        self.onEvent({ type: 'error', message: type === 'network' ? 'Network error' : type });
      });
    }

    onGuestData(d) {
      if (!d || !d.t) return;
      if (d.t === 'join') {
        this.partnerName = String(d.name || 'Player 2').slice(0, 24);
        this.state = PV.createGame({
          size: this.settings.size,
          mode: this.settings.mode,
          targetWins: this.settings.targetWins,
          names: [this.name, this.partnerName],
        });
        this.onEvent({ type: 'start', code: this.code, link: inviteLink(this.code), partner: this.partnerName });
        this.broadcast();
        this.afterAction();
        return;
      }
      if (d.t === 'place') {
        if (!this.state || this.state.current !== 1 || this.state.phase !== 'place') return;
        const r = d.r | 0;
        const c = d.c | 0;
        if (!PV.isLegal(this.state, r, c, this.state.roll.value)) {
          this.broadcast(); // resync a desynced guest
          return;
        }
        PV.place(this.state, r, c);
        this.settle();
        return;
      }
      if (d.t === 'rematch') {
        this.newMatch();
        return;
      }
      if (d.t === 'leave') {
        if (this.conn) this.conn.close();
      }
    }

    /* ------------------------------------------------------------- joining */

    join(code) {
      const self = this;
      this.code = normalizeCode(code);
      if (!this.code) { this.onEvent({ type: 'error', message: 'Enter a game code.' }); return; }
      this.peer = new root.Peer(undefined, BROKER);
      this.peer.on('open', function () {
        const conn = self.peer.connect(peerIdForCode(self.code), { reliable: true });
        self.conn = conn;
        conn.on('open', function () {
          conn.send({ t: 'join', name: self.name });
          self.onEvent({ type: 'joined' });
        });
        conn.on('data', function (d) { self.onHostData(d); });
        conn.on('close', function () { self.onEvent({ type: 'peer-left' }); });
        conn.on('error', function () { self.onEvent({ type: 'error', message: 'Connection error' }); });
      });
      this.peer.on('error', function (err) {
        const type = err && err.type ? err.type : String(err);
        if (type === 'peer-unavailable') {
          self.onEvent({ type: 'error', message: 'Game not found — check the code with your host.' });
        } else if (type === 'network') {
          self.onEvent({ type: 'error', message: 'Network error — could not reach the matchmaker.' });
        } else {
          self.onEvent({ type: 'error', message: type });
        }
      });
    }

    onHostData(d) {
      if (!d || !d.t) return;
      if (d.t === 'state') {
        this.state = PV.deserialize(d.state, Math.random);
        this.partnerName = this.state.names[0];
        this.onState(this.state);
        return;
      }
      if (d.t === 'full') {
        this.onEvent({ type: 'error', message: 'That game already has two players.' });
        this.close();
      }
    }

    /* ------------------------------------------------------------ actions */

    hostRoll() {
      if (this.role !== 'host' || !this.state) return;
      if (this.state.phase !== 'roll') return;
      PV.roll(this.state);
      this.settle();
    }

    hostPlace(r, c) {
      if (this.role !== 'host' || !this.state) return;
      if (this.state.current !== 0 || this.state.phase !== 'place') return;
      PV.place(this.state, r, c);
      this.settle();
    }

    hostNextRound() {
      if (this.role !== 'host' || !this.state) return;
      if (this.state.phase !== 'roundover') return;
      PV.nextRound(this.state);
      this.broadcast();
      this.afterAction();
    }

    guestPlace(r, c) {
      if (this.role !== 'guest' || !this.conn) return;
      if (!this.state || this.state.current !== 1 || this.state.phase !== 'place') return;
      this.conn.send({ t: 'place', r: r, c: c });
    }

    rematch() {
      if (this.role === 'host') this.newMatch();
      else if (this.conn) this.conn.send({ t: 'rematch' });
    }

    newMatch() {
      const names = this.state ? this.state.names.slice() : [this.name, this.partnerName || 'Player 2'];
      this.state = PV.createGame({
        size: this.settings.size,
        mode: this.settings.mode,
        targetWins: this.settings.targetWins,
        names: names,
      });
      this.broadcast();
      this.afterAction();
    }

    // Resolve "roll with nowhere to go" and hand the dice to the guest if needed.
    settle() {
      if (!this.state) return;
      if (this.state.phase === 'place' && this.state.roll && !this.state.roll.skipped) {
        if (PV.legalCells(this.state, this.state.roll.value).length === 0) {
          PV.loseRound(this.state);
        }
      }
      this.broadcast();
      this.afterAction();
    }

    afterAction() {
      if (!this.state) return;
      if (this.state.phase === 'roll' && this.state.current === 1) {
        this.later(() => this.hostRoll(), 900);
      }
    }

    broadcast() {
      if (!this.conn || !this.state) return;
      this.conn.send({ t: 'state', state: PV.serialize(this.state) });
      this.onState(this.state);
    }

    leave() {
      if (this.conn && this.role === 'guest') {
        try { this.conn.send({ t: 'leave' }); } catch (e) { /* ignore */ }
      }
      this.close();
    }

    close() {
      this.closed = true;
      this._timers.forEach(clearTimeout);
      this._timers = [];
      if (this.conn) { try { this.conn.close(); } catch (e) { /* ignore */ } this.conn = null; }
      if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } this.peer = null; }
    }
  }

  root.PlaceValueOnline = {
    OnlineGame: OnlineGame,
    makeCode: makeCode,
    normalizeCode: normalizeCode,
    inviteLink: inviteLink,
    BROKER: BROKER,
  };
}(typeof self !== 'undefined' ? self : globalThis));
