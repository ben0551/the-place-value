/* The Place Value — DOM controller. */
(function () {
  'use strict';

  const PV = window.PlaceValue;
  const AI = window.PlaceValueAI;
  const ONLINE = window.PlaceValueOnline;

  const DIFFICULTY_HELP = {
    easy: 'Picks any legal square at random.',
    medium: 'Keeps its options open.',
    hard: 'Simulates the dice to find the placement most likely to win the round.',
  };

  const App = {
    game: null,
    mode: null,          // 'ai' | 'local' | 'online'
    difficulty: 'medium',
    settings: null,
    session: null,
    onlineSeat: null,
    boardKey: '',
    cellEls: [],
    timers: [],
    lastPlaced: null,
    pendingHostCode: null,
  };

  const $ = function (id) { return document.getElementById(id); };

  // Test hook: collect runtime errors so a headless run can assert on them.
  window.__errors = [];
  window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__errors.push('rejection: ' + String(e.reason));
  });
  window.__APP = App;

  /* ------------------------------------------------------------ utilities */

  function schedule(fn, ms) {
    const id = window.setTimeout(function () {
      App.timers = App.timers.filter(function (t) { return t !== id; });
      fn();
    }, ms);
    App.timers.push(id);
    return id;
  }

  function clearTimers() {
    App.timers.forEach(clearTimeout);
    App.timers = [];
  }

  function isAiTurn() {
    return App.mode === 'ai' && App.game && App.game.current === 1;
  }

  function isLocalTurn() {
    if (!App.game) return false;
    if (App.mode === 'online') return App.game.current === App.onlineSeat;
    if (App.mode === 'ai') return App.game.current === 0;
    return true;
  }

  function playerLabel(index) {
    if (!App.game) return '';
    return App.game.names[index] || ('Player ' + (index + 1));
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* -------------------------------------------------------------- screens */

  const SCREENS = ['home', 'setup', 'online', 'game'];

  function showScreen(name) {
    SCREENS.forEach(function (s) {
      const el = $('screen-' + s);
      if (el) el.hidden = (s !== name);
    });
    $('main').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function gotoHome() {
    clearTimers();
    if (App.session) { App.session.leave(); App.session = null; }
    App.game = null;
    App.mode = null;
    setConnStatus('');
    showScreen('home');
  }

  /* ------------------------------------------------------------------ setup */

  function readSetupForm() {
    const mode = App.mode;
    const names = [
      ($('name-1').value || '').trim() || 'Player 1',
      ($('name-2').value || '').trim() || (mode === 'ai' ? 'AI' : 'Player 2'),
    ];
    return {
      mode: mode,
      size: checkedValue('size') || 'standard',
      orderMode: checkedValue('mode') || 'grid',
      targetWins: Number(checkedValue('target') || 3),
      difficulty: checkedValue('difficulty') || 'medium',
      names: names,
    };
  }

  function checkedValue(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function startGame(settings) {
    App.settings = settings;
    App.difficulty = settings.difficulty || 'medium';
    App.game = PV.createGame({
      size: settings.size,
      mode: settings.orderMode,
      targetWins: settings.targetWins,
      names: settings.names,
    });
    App.mode = settings.mode;
    App.boardKey = '';
    App.lastPlaced = null;
    hideOverlay();
    showScreen('game');
    afterAction();
  }

  /* -------------------------------------------------------------- rendering */

  function displayRows(state) {
    const rows = [];
    for (let r = 0; r < state.rows; r++) rows.push(r);
    if (PV.FLIP_VERTICAL) rows.reverse();
    return rows;
  }

  function buildBoard(state) {
    const board = $('board');
    board.style.setProperty('--cols', String(state.cols));
    board.innerHTML = '';
    App.cellEls = [];
    displayRows(state).forEach(function (r) {
      for (let c = 0; c < state.cols; c++) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cell';
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.setAttribute('role', 'gridcell');
        el.addEventListener('click', function () { onCellClick(r, c); });
        board.appendChild(el);
        App.cellEls.push(el);
      }
    });
    App.boardKey = state.rows + 'x' + state.cols;
  }

  function updateBoard(state) {
    if (App.boardKey !== state.rows + 'x' + state.cols) buildBoard(state);
    const highlight = (state.phase === 'place' && state.roll && !state.roll.skipped)
      ? state.roll.value : null;
    const rows = displayRows(state);
    for (let i = 0; i < App.cellEls.length; i++) {
      const el = App.cellEls[i];
      const r = Number(el.dataset.r);
      const c = Number(el.dataset.c);
      const cell = state.board[r][c];
      let cls = 'cell';
      let text = '';
      if (cell) {
        cls += ' filled p' + cell.player;
        text = PV.formatNumber(cell.value);
        if (App.lastPlaced && App.lastPlaced.r === r && App.lastPlaced.c === c) cls += ' last-placed';
      } else if (highlight !== null) {
        cls += PV.isLegal(state, r, c, highlight) ? ' legal' : ' illegal';
      }
      el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.setAttribute('aria-label',
        text ? ('Row ' + (r + 1) + ' column ' + (c + 1) + ': ' + text + ' by ' + playerLabel(cell.player))
             : ('Row ' + (r + 1) + ' column ' + (c + 1) + ': empty'));
    }
  }

  function renderScore(state) {
    $('score-0').querySelector('.score-name').textContent = playerLabel(0);
    $('score-1').querySelector('.score-name').textContent = playerLabel(1);
    $('score-0').dataset.player = '0';
    $('score-1').dataset.player = '1';
    $('score-0').classList.toggle('active', state.current === 0);
    $('score-1').classList.toggle('active', state.current === 1);
    $('score-value').textContent = state.scores[0] + ' – ' + state.scores[1];
    $('round-label').textContent = 'Round ' + state.round;
    $('score-target').textContent = 'First to ' + state.targetWins;

    [0, 1].forEach(function (p) {
      const box = $('score-' + p).querySelector('[data-pips]');
      let html = '';
      for (let i = 0; i < state.targetWins; i++) {
        html += '<span class="pip' + (i < state.scores[p] ? ' won' : '') + '"></span>';
      }
      box.innerHTML = html;
    });
  }

  function renderDice(state) {
    const dieT = $('die-tens');
    const dieO = $('die-ones');
    if (state.roll) {
      dieT.textContent = String(state.roll.tens);
      dieO.textContent = String(state.roll.ones);
      if (state.roll.skipped) {
        $('last-roll').textContent = '00 — turn skipped';
        $('dice-help').textContent = 'Double zero: no number is placed. Play passes on.';
      } else {
        $('last-roll').textContent = 'Rolled ' + PV.formatNumber(state.roll.value);
        const legal = state.phase === 'place' ? PV.legalCells(state, state.roll.value).length : 0;
        if (state.phase === 'place') {
          $('dice-help').textContent = legal === 0
            ? 'Nowhere legal — the round is lost.'
            : 'Green squares are legal. Pick one.';
        } else {
          $('dice-help').textContent = '';
        }
      }
    } else {
      dieT.textContent = '–';
      dieO.textContent = '–';
      $('last-roll').textContent = 'No roll yet';
      $('dice-help').textContent = 'Roll the dice to begin.';
    }
  }

  function renderLog(state) {
    const box = $('log');
    const entries = state.log.slice(-50);
    box.innerHTML = entries.map(function (line, i) {
      const important = /wins round|wins the match|could not place|turn skipped/.test(line);
      return '<div class="log-entry' + (important ? ' important' : '') + '">' + escapeHtml(line) + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderBanner(state) {
    const banner = $('turn-banner');
    banner.className = 'turn-banner';
    if (state.phase === 'matchover') {
      banner.textContent = playerLabel(state.matchWinner) + ' wins the match!';
      return;
    }
    if (state.phase === 'roundover') {
      banner.textContent = playerLabel(state.roundWinner) + ' takes round ' + state.round + '.';
      return;
    }
    const who = playerLabel(state.current);
    if (App.mode === 'ai') {
      banner.textContent = state.current === 0 ? 'Your turn' : who + ' is thinking…';
      banner.classList.add(state.current === 0 ? 'p0' : 'p1');
    } else if (App.mode === 'online') {
      banner.textContent = state.current === App.onlineSeat ? 'Your turn' : who + '’s turn';
      banner.classList.add(state.current === 0 ? 'p0' : 'p1');
    } else {
      banner.textContent = who + '’s turn';
      banner.classList.add(state.current === 0 ? 'p0' : 'p1');
    }
  }

  function renderControls(state) {
    const rollBtn = $('btn-roll');
    const canRoll = state.phase === 'roll'
      && (App.mode === 'local'
        || (App.mode === 'ai' && state.current === 0)
        || (App.mode === 'online' && App.onlineSeat === 0));
    rollBtn.disabled = !canRoll;
    rollBtn.textContent = state.phase === 'roll' ? 'Roll' : 'Waiting…';

    const canAct = state.phase !== 'matchover' && state.phase !== 'roundover';
    $('btn-rematch').hidden = canAct;
    $('btn-rematch').textContent = App.mode === 'online' && App.onlineSeat !== 0 ? 'Request rematch' : 'Rematch';
  }

  function renderAll() {
    const state = App.game;
    if (!state) return;
    renderScore(state);
    updateBoard(state);
    renderDice(state);
    renderBanner(state);
    renderControls(state);
    renderLog(state);
  }

  /* -------------------------------------------------------------- overlays */

  function showOverlay(html) {
    $('overlay-card').innerHTML = html;
    $('overlay').hidden = false;
  }

  function hideOverlay() {
    $('overlay').hidden = true;
    $('overlay-card').innerHTML = '';
  }

  function showRoundOverlay(state) {
    if (state.phase === 'matchover') { showMatchOverlay(state); return; }
    const online = App.mode === 'online' && App.onlineSeat !== 0;
    showOverlay(
      '<h2>' + escapeHtml(playerLabel(state.roundWinner)) + ' wins round ' + state.round + '</h2>' +
      '<p class="scoreline">' + state.scores[0] + ' – ' + state.scores[1] + '</p>' +
      '<p>' + (online ? 'Waiting for the host to start the next round.'
                     : 'First to ' + state.targetWins + ' round wins takes the match.') + '</p>' +
      '<div class="form-actions">' +
      (online ? '' : '<button class="btn primary" id="btn-next-round" type="button">Next round</button>') +
      '<button class="btn ghost" id="btn-quit-overlay" type="button">Quit to menu</button>' +
      '</div>'
    );
    if (!online) {
      $('btn-next-round').addEventListener('click', function () {
        PV.nextRound(App.game);
        hideOverlay();
        afterAction();
      });
    }
    $('btn-quit-overlay').addEventListener('click', gotoHome);
  }

  function showMatchOverlay(state) {
    const online = App.mode === 'online';
    const canRematch = !online || App.onlineSeat === 0;
    showOverlay(
      '<h2>' + escapeHtml(playerLabel(state.matchWinner)) + ' wins the match!</h2>' +
      '<p class="scoreline">' + state.scores[0] + ' – ' + state.scores[1] + '</p>' +
      '<p>' + (online && !canRematch ? 'Waiting for the host to start the rematch.'
                                   : 'Same players, same settings, fresh board.') + '</p>' +
      '<div class="form-actions">' +
      '<button class="btn primary" id="btn-overlay-rematch" type="button">' +
        (online && !canRematch ? 'Request rematch' : 'Rematch') + '</button>' +
      '<button class="btn ghost" id="btn-overlay-quit" type="button">Quit to menu</button>' +
      '</div>'
    );
    $('btn-overlay-rematch').addEventListener('click', function () {
      hideOverlay();
      if (online) {
        App.session.rematch();
        if (App.onlineSeat === 0) afterAction();
      } else {
        startGame(App.settings);
      }
    });
    $('btn-overlay-quit').addEventListener('click', gotoHome);
  }

  function showHowTo() {
    showOverlay(
      '<h2>How to play</h2>' +
      '<ul class="rules-list">' +
      '<li>Players take turns. On your turn you roll two 10-sided dice: a tens die and a ones die.</li>' +
      '<li>The dice make a two-digit number, like <kbd>0</kbd> + <kbd>7</kbd> = <kbd>07</kbd>.</li>' +
      '<li>Place that number in any empty square, as long as the board stays in order.</li>' +
      '<li><strong>Whole grid:</strong> numbers increase left to right and top to bottom.</li>' +
      '<li><strong>Columns only:</strong> each column must stay in one direction — rows are ignored.</li>' +
      '<li>Roll <kbd>00</kbd> and your turn is skipped. No reroll.</li>' +
      '<li>If the number you roll has <strong>nowhere legal</strong> to go, you lose the round.</li>' +
      '<li>Fill the last empty square and you win the round.</li>' +
      '<li>First to 3 round wins takes the match.</li>' +
      '</ul>' +
      '<div class="form-actions"><button class="btn primary" id="btn-close-howto" type="button">Got it</button></div>'
    );
    $('btn-close-howto').addEventListener('click', hideOverlay);
  }

  /* ------------------------------------------------------------ game flow */

  function settle() {
    const state = App.game;
    if (!state) return;
    if (state.phase === 'place' && state.roll && !state.roll.skipped) {
      if (PV.legalCells(state, state.roll.value).length === 0) PV.loseRound(state);
    }
  }

  function afterAction() {
    const state = App.game;
    if (!state) return;
    renderAll();
    if (state.phase === 'matchover') return showMatchOverlay(state);
    if (state.phase === 'roundover') return showRoundOverlay(state);
    if (App.mode === 'online') return; // the host drives the guest's rolls
    if (state.phase === 'roll' && isAiTurn()) return schedule(aiRoll, 800);
    if (state.phase === 'place' && isAiTurn()) return schedule(aiPlace, 900);
  }

  function doRoll() {
    const state = App.game;
    if (!state || state.phase !== 'roll') return;
    PV.roll(state);
    settle();
    afterAction();
  }

  function aiRoll() {
    if (!isAiTurn() || !App.game || App.game.phase !== 'roll') return;
    doRoll();
  }

  function aiPlace() {
    const state = App.game;
    if (!isAiTurn() || !state || state.phase !== 'place') return;
    const cells = PV.legalCells(state, state.roll.value);
    if (cells.length === 0) { PV.loseRound(state); afterAction(); return; }
    const pick = AI.choose(state, App.difficulty, cells);
    App.lastPlaced = { r: pick.r, c: pick.c };
    PV.place(state, pick.r, pick.c);
    afterAction();
  }

  function onRollClick() {
    const state = App.game;
    if (!state) return;
    if (App.mode === 'online') {
      if (App.onlineSeat === 0) App.session.hostRoll();
      return;
    }
    if (state.phase !== 'roll') return;
    if (App.mode === 'ai' && state.current !== 0) return;
    doRoll();
  }

  function onCellClick(r, c) {
    const state = App.game;
    if (!state || state.phase !== 'place') return;
    if (!isLocalTurn()) return;
    if (!PV.isLegal(state, r, c, state.roll.value)) return;
    if (App.mode === 'online') {
      if (App.onlineSeat === 1) App.session.guestPlace(r, c);
      else App.session.hostPlace(r, c);
      return;
    }
    App.lastPlaced = { r: r, c: c };
    PV.place(state, r, c);
    afterAction();
  }

  /* --------------------------------------------------------------- online */

  function setConnStatus(text, online) {
    const el = $('conn-status');
    el.textContent = text;
    el.classList.toggle('online', !!online);
  }

  function showLobby() {
    $('lobby').hidden = false;
    $('lobby-error').hidden = true;
    $('btn-create').disabled = true;
    $('btn-join').disabled = true;
  }

  function hideLobby() {
    $('lobby').hidden = true;
    $('btn-create').disabled = false;
    $('btn-join').disabled = false;
  }

  function createOnline() {
    const name = ($('host-name').value || '').trim() || 'Host';
    const settings = {
      mode: 'online',
      size: $('host-size').value,
      orderMode: $('host-mode').value,
      targetWins: Number($('host-target').value),
      names: [name, 'Player 2'],
    };
    App.settings = settings;
    App.mode = 'online';
    App.onlineSeat = 0;
    App.game = null;
    App.session = new ONLINE.OnlineGame({
      role: 'host',
      name: name,
      settings: settings,
      onState: onOnlineState,
      onEvent: onOnlineEvent,
    });
    App.session.create(App.pendingHostCode);
    showLobby();
    $('lobby-status').textContent = 'Waiting for your opponent…';
  }

  function joinOnline() {
    const name = ($('join-name').value || '').trim() || 'Guest';
    const code = ONLINE.normalizeCode($('join-code').value);
    if (!code) { $('lobby-error').textContent = 'Enter the game code.'; $('lobby-error').hidden = false; return; }
    App.settings = { mode: 'online' };
    App.mode = 'online';
    App.onlineSeat = 1;
    App.game = null;
    App.session = new ONLINE.OnlineGame({
      role: 'guest',
      name: name,
      code: code,
      onState: onOnlineState,
      onEvent: onOnlineEvent,
    });
    showLobby();
    $('lobby-status').textContent = 'Connecting to ' + code + '…';
    $('lobby').hidden = false;
    App.session.join(code);
  }

  function onOnlineState(state) {
    App.game = state;
    if (!$('screen-game').hidden) {
      afterAction();
    } else {
      hideLobby();
      hideOverlay();
      showScreen('game');
      afterAction();
    }
  }

  function onOnlineEvent(evt) {
    if (evt.type === 'created') {
      $('lobby-code').textContent = evt.code;
      $('lobby-link').value = evt.link;
      $('lobby-status').textContent = 'Waiting for your opponent…';
      setConnStatus('Online', true);
      try {
        window.history.replaceState({}, '', '?host=' + evt.code);
      } catch (e) { /* file:// or sandboxed frame */ }
      return;
    }
    if (evt.type === 'start') {
      setConnStatus('Online vs ' + evt.partner, true);
      return;
    }
    if (evt.type === 'joined') {
      $('lobby-status').textContent = 'Connected — waiting for the host to deal…';
      setConnStatus('Online', true);
      return;
    }
    if (evt.type === 'peer-left') {
      setConnStatus('Opponent left', false);
      showOverlay(
        '<h2>Connection closed</h2>' +
        '<p>Your opponent left the game.</p>' +
        '<div class="form-actions"><button class="btn primary" id="btn-peer-left" type="button">Back to menu</button></div>'
      );
      $('btn-peer-left').addEventListener('click', gotoHome);
      return;
    }
    if (evt.type === 'error') {
      setConnStatus('Offline', false);
      $('lobby-error').textContent = evt.message;
      $('lobby-error').hidden = false;
      return;
    }
  }

  function copyInviteLink() {
    const input = $('lobby-link');
    const text = input.value;
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $('btn-copy-link').textContent = 'Copied';
        schedule(function () { $('btn-copy-link').textContent = 'Copy invite link'; }, 1500);
      }, function () { input.select(); });
    } else {
      input.select();
      document.execCommand('copy');
    }
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    // Home menu.
    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-goto');
        if (target === 'setup') {
          App.mode = btn.getAttribute('data-mode');
          $('setup-title').textContent = App.mode === 'ai' ? 'Play vs AI' : 'Pass & Play';
          $('field-difficulty').style.display = App.mode === 'ai' ? '' : 'none';
          $('name-2').value = App.mode === 'ai' ? 'AI' : '';
          $('name-2').disabled = App.mode === 'ai';
          $('difficulty-help').textContent = DIFFICULTY_HELP[checkedValue('difficulty')];
          showScreen('setup');
          return;
        }
        if (target === 'online') { showScreen('online'); return; }
        showScreen(target);
      });
    });

    document.querySelectorAll('input[name="difficulty"]').forEach(function (el) {
      el.addEventListener('change', function () {
        $('difficulty-help').textContent = DIFFICULTY_HELP[checkedValue('difficulty')];
      });
    });

    $('setup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      startGame(readSetupForm());
    });

    $('btn-roll').addEventListener('click', onRollClick);
    $('btn-howto').addEventListener('click', showHowTo);
    $('btn-quit').addEventListener('click', gotoHome);
    $('btn-rematch').addEventListener('click', function () {
      if (App.mode === 'online') { App.session.rematch(); return; }
      startGame(App.settings);
    });

    $('btn-create').addEventListener('click', createOnline);
    $('btn-join').addEventListener('click', joinOnline);
    $('btn-copy-link').addEventListener('click', copyInviteLink);
    $('btn-cancel-lobby').addEventListener('click', function () {
      if (App.session) { App.session.leave(); App.session = null; }
      hideLobby();
      setConnStatus('', false);
    });

    $('overlay').addEventListener('click', function (e) {
      if (e.target === $('overlay') && !App.game) hideOverlay();
    });

    // Deep links: ?join=CODE opens the join panel with the code filled in.
    const params = new URLSearchParams(window.location.search);
    const join = ONLINE.normalizeCode(params.get('join'));
    const host = ONLINE.normalizeCode(params.get('host'));
    if (join) {
      $('join-code').value = join;
      App.mode = 'online';
      showScreen('online');
    } else if (host) {
      App.pendingHostCode = host;
      $('host-name').value = $('host-name').value || 'Host';
      App.mode = 'online';
      showScreen('online');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__APP = App;
}());
