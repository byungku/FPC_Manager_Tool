// Port of Form1.cs (pnMain), initForm.cs and settingForm.cs
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  const IMG = {
    fp: 'img/FingerPrint_Source_1st.png',
    scan: 'img/scangif.gif',
    match: 'img/FingerPrint_Source_match.png',
    notMatch: 'img/FingerPrint_Source_not_match.png',
    connected: 'img/connected_white.png',
    disconnected: 'img/disconnect_white.png',
    init: 'img/init_big_icon.png',
    notInit: 'img/not_init_big_icon.png',
    enrolled: 'img/enrolled_big_icon.png',
    notEnrolled: 'img/not_enroll_big_icon.png',
  };
  const MAX_TILES = 16;
  const fingerData = ['1st Finger', '2nd Finger'];
  const KEY_STORAGE = 'fpcManager.keys';

  // WinForms-like timer: Start() while running is a no-op.
  class UiTimer {
    constructor(interval, tick) {
      this.interval = interval;
      this.tick = tick;
      this.id = null;
    }
    get enabled() { return this.id !== null; }
    start() {
      if (this.id === null) this.id = setInterval(() => this.tick(), this.interval);
    }
    stop() {
      if (this.id !== null) clearInterval(this.id);
      this.id = null;
    }
    setInterval(ms) {
      this.interval = ms;
      if (this.enabled) {
        this.stop();
        this.start();
      }
    }
  }

  // ---------------------------------------------------------------- state
  let start = Date.now();
  let selectedReaderName = null;
  let activeCard = false;
  let initCard = false;
  let enrollCard = false;

  let isContinueCmd = false;
  let matchCnt = 0;
  let matchTotalCnt = 50;
  let matchProcessingCnt = 0;
  let matchSuccessCnt = 0;
  let matchNACnt = 0;
  let matchFailCnt = 0;
  let matchDelay = 1000;
  let matchStartTime = 0;
  let matchDuration = 0;

  // Async replacements for the worker threads / Thread.Abort of the WinForms version
  let enrollBusy = false;
  let enrollApduPending = false;
  let enrollGen = 0;
  let matchBusy = false;
  let matchApduPending = false;
  let matchGen = 0;
  let matchRunning = false;
  let matchRepeat = false; // repeat mode of the current run (fixed at start)
  let initBusy = false;
  let uiBusy = false;

  const tEnroll = new UiTimer(20, tcbEnrollment);
  const tMatch = new UiTimer(1000, tcbMatch);
  const tInit = new UiTimer(750, tcbInit);

  const bridge = new PcscBridge(bridgeUrl());
  const fpcMethod = new UBFingerPrintCard(bridge, cardAppendText, loadKeys);

  const pbEnrollment = [];

  // ---------------------------------------------------------------- helpers
  function bridgeUrl() {
    const q = new URLSearchParams(location.search).get('bridge');
    if (q) return q;
    if (location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      return 'ws://' + location.host + '/pcsc';
    }
    return 'ws://localhost:8765/pcsc';
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Equivalent of textKEY.txt ("ENC;MAC;DEK")
  function loadKeys() {
    const raw = storageGet(KEY_STORAGE);
    if (!raw) return null;
    const parts = raw.split(';').map((s) => s.replace(/\s+/g, ''));
    if (parts.length < 3 || !parts.slice(0, 3).every((k) => /^[0-9a-fA-F]{32}$/.test(k))) return null;
    return { enc: Hex.to(parts[0]), mac: Hex.to(parts[1]), dek: Hex.to(parts[2]) };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Queued modal message box (MessageBox.Show)
  let msgQueue = Promise.resolve();
  let msgResolve = null;
  function closeMessageBox() {
    const dlg = $('msgBox');
    if (dlg.open) dlg.close();
    const r = msgResolve;
    msgResolve = null;
    if (r) r();
  }
  // autoCloseMs: close the box by itself after this many ms (the OK button still works)
  function messageBox(text, title, icon, autoCloseMs) {
    const show = () => new Promise((resolve) => {
      const dlg = $('msgBox');
      $('msgTitle').textContent = title || 'FPC Manager';
      $('msgText').textContent = text;
      $('msgIcon').className = 'msg-icon ' + (icon || 'info');
      msgResolve = resolve;
      dlg.showModal();
      $('msgOk').focus();
      if (autoCloseMs) {
        setTimeout(() => { if (msgResolve === resolve) closeMessageBox(); }, autoCloseMs);
      }
    });
    msgQueue = msgQueue.then(show, show);
    return msgQueue;
  }
  const msgInfo = (text, title) => messageBox(text, title, 'info');
  const msgError = (text, title) => messageBox(text, title, 'error');

  // Serialise user actions the way the blocking UI thread did.
  function guarded(fn) {
    return async (ev) => {
      if (uiBusy) return;
      uiBusy = true;
      try {
        await fn(ev);
      } finally {
        uiBusy = false;
      }
    };
  }

  const setEnabled = (ids, enabled) => ids.forEach((id) => { $(id).disabled = !enabled; });
  const setText = (ids, text) => ids.forEach((id) => { $(id).textContent = text; });

  // ---------------------------------------------------------------- load
  function pnMainLoad() {
    const grid = $('enrollGrid');
    for (let i = 0; i < MAX_TILES; i++) {
      const tile = document.createElement('div');
      tile.className = 'fp-tile';
      const img = document.createElement('img');
      img.src = IMG.fp;
      img.alt = '';
      tile.appendChild(img);
      grid.appendChild(tile);
      pbEnrollment.push({ tile, img });
    }

    for (const sel of [$('cbSelectFinger'), $('cbDevSelectFinger')]) {
      fingerData.forEach((name, i) => sel.add(new Option(name, String(i))));
      sel.selectedIndex = 0;
    }

    setupBridgeDownload();

    // Refit when the window resizes or the ENROLL tab becomes visible
    if (window.ResizeObserver) new ResizeObserver(fitEnrollTiles).observe(grid);
    else window.addEventListener('resize', fitEnrollTiles);

    selectTab('tbAbout');
    setEnabled(['btnDisconnect', 'btnEnrollment', 'btnMatch', 'btnSetting', 'btnInitalization'], false);
    $('btnDev').hidden = true;
    // Repeat matching is on by default (DEV tab only)
    $('cbMatch').checked = true;
    $('tbMatchDelay').disabled = false;
    $('tbMatchCount').disabled = false;
    matchDelay = parseInt($('tbMatchDelay').value, 10) || 0;
    matchTotalCnt = parseInt($('tbMatchCount').value, 10) || 1;

    tEnroll.setInterval($('cbReTouch').checked ? 20 : 1000);
    wireEvents();
    connectBridge();
  }

  // ---------------------------------------------------------------- bridge
  let bridgeRetry = null;

  // Offer the FPCBridge build for the visitor's OS, with a link to the other one.
  const BRIDGE_DOWNLOADS = {
    windows: { label: 'Windows', url: 'https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge.exe' },
    mac: { label: 'Mac', url: 'https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge-mac.zip' },
  };

  function setupBridgeDownload() {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const isMac = /mac/i.test(platform) || /Mac OS X/.test(navigator.userAgent);
    const mine = BRIDGE_DOWNLOADS[isMac ? 'mac' : 'windows'];
    const other = BRIDGE_DOWNLOADS[isMac ? 'windows' : 'mac'];

    $('bridgeDownload').href = mine.url;
    $('bridgeDownloadLabel').textContent = 'FPCBridge 다운로드 (' + mine.label + ')';
    $('bridgeOtherOs').href = other.url;
    $('bridgeOtherOs').textContent = other.label + '용 다운로드';

    // "Open local screen" only helps on a hosted copy (e.g. GitHub Pages), and only once the
    // bridge is running - so offer it after a download was started.
    const hosted = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    if (hosted) {
      const reveal = () => { $('bridgeOpenLocal').hidden = false; };
      $('bridgeDownload').addEventListener('click', reveal);
      $('bridgeOtherOs').addEventListener('click', reveal);
    }
  }

  async function connectBridge() {
    clearTimeout(bridgeRetry);
    try {
      await bridge.open();
      setBridgeStatus(true);
      await readerListLoad();
    } catch (e) {
      setBridgeStatus(false);
      bridgeRetry = setTimeout(connectBridge, 3000);
    }
  }

  bridge.addEventListener('close', async () => {
    setBridgeStatus(false);
    if (activeCard) {
      cardAppendText('[BRIDGE DISCONNECTED]', 'red', true, true);
      await updateDisconnectionUI();
    }
    bridgeRetry = setTimeout(connectBridge, 3000);
  });

  function setBridgeStatus(online) {
    $('bridgeBanner').hidden = online;
    const el = $('bridgeStatus');
    el.classList.toggle('online', online);
    el.querySelector('.label').textContent = online
      ? 'Bridge: online' + (bridge.info && bridge.info.version ? ' (v' + bridge.info.version + ')' : '')
      : 'Bridge: offline';
    el.title = online ? bridge.url : 'PcscBridge.exe is not running (' + bridge.url + ')';
  }

  async function readerListLoad() {
    const sel = $('cbSelReader');
    const prev = sel.value;
    sel.length = 0;
    sel.add(new Option('Select a reader.', ''));

    let readerList;
    try {
      readerList = await bridge.listReaders();
    } catch (e) {
      if (!bridge.connected) sel.options[0].text = 'PC/SC bridge not running';
      return;
    }

    for (const reader of readerList) sel.add(new Option(reader, reader));
    if (prev && readerList.includes(prev)) sel.value = prev;
    selectedReaderName = sel.value || null;
  }

  // ---------------------------------------------------------------- status views
  function updateEnrollImgStatus() {
    const target = fpcMethod.targetNum[fpcMethod.selectedFinger];
    pbEnrollment.forEach((pb, i) => { pb.tile.hidden = !(i < target); });
    fitEnrollTiles();
  }

  // Size the 4:3 tiles so every visible row fits in the grid area (no scrolling), capped at 240 x 180.
  function fitEnrollTiles() {
    const grid = $('enrollGrid');
    if (window.matchMedia('(max-width: 900px)').matches) {
      grid.style.removeProperty('--tile-w');
      return;
    }
    const W = grid.clientWidth;
    const H = grid.clientHeight;
    if (!W || !H) return; // tab hidden

    const visible = pbEnrollment.filter((pb) => !pb.tile.hidden).length;
    const rows = Math.max(1, Math.ceil(visible / 4));
    const cs = getComputedStyle(grid);
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;

    const byWidth = (W - 3 * colGap) / 4;
    const byHeight = ((H - (rows - 1) * rowGap) / rows) * 4 / 3;
    const w = Math.max(48, Math.floor(Math.min(240, byWidth, byHeight)));
    grid.style.setProperty('--tile-w', w + 'px');
  }

  // updateEnrollStatus() / updateEnrollStatus(scan, count)
  function updateEnrollStatus(scan, count) {
    const devVisible = !$('btnDev').hidden;

    if (scan === undefined) {
      const cnt = fpcMethod.enrollmentCnt[fpcMethod.selectedFinger];
      pbEnrollment.forEach((pb, i) => {
        pb.img.src = IMG.fp;
        pb.tile.classList.toggle('done', i < cnt);
      });
      $('pbDevEnroll').src = IMG.fp;
      $('pbDevEnroll').parentElement.classList.remove('done');
      return;
    }

    if (count < fpcMethod.targetNum[fpcMethod.selectedFinger] && count < MAX_TILES) {
      const pb = pbEnrollment[count];
      if (scan) {
        pb.img.src = IMG.scan;
        if (devVisible) $('pbDevEnroll').src = IMG.scan;
      } else {
        pb.img.src = IMG.fp;
        pb.tile.classList.add('done');
        if (devVisible) {
          $('pbDevEnroll').src = IMG.fp;
          $('pbDevEnroll').parentElement.classList.add('done');
        }
      }
    }
  }

  function updateStatusTextBox() {
    $('tbControllerVer').value = 'V ' + fpcMethod.mcuVerMajor + '.' + fpcMethod.mcuVerMinor;
    $('tbAppletVer').value = fpcMethod.appVersion;
    $('tbBlockState').value = fpcMethod.fpcBlocked ? 'BLOCKED' : '-';
  }

  function cardActiveState(state) {
    $('pbConnect').src = state ? IMG.connected : IMG.disconnected;
    activeCard = state;
  }

  function cardInitState(state) {
    $('pbInit').src = state ? IMG.init : IMG.notInit;
    $('btnInitalization').disabled = state;
    initCard = state;
  }

  function cardEnrollState(state) {
    if (state) {
      $('pbEnroll').src = IMG.enrolled;
      setEnabled(['btnDevEnroll', 'btnEnroll'], false);
      setEnabled(['btnDevDelete', 'btnDel'], true);
      setEnabled(['btnDevMatching', 'btnMatching'], true);
      enrollCard = true;
    } else {
      $('pbEnroll').src = IMG.notEnrolled;
      setEnabled(['btnDevEnroll', 'btnEnroll'], true);

      setEnabled(['btnDevDelete', 'btnDel'], fpcMethod.enrollmentStatus[fpcMethod.selectedFinger] === 0x01);

      const s = fpcMethod.enrollmentStatus;
      const anyEnrolled = s[0] === 0x02 || s[0] === 0x03 || s[1] === 0x02 || s[1] === 0x03;
      setEnabled(['btnDevMatching', 'btnMatching'], anyEnrolled);
      enrollCard = anyEnrolled;
    }

    if (!$('cbReTouch').checked) setText(['btnDevEnroll', 'btnEnroll'], 'ENROLL');
  }

  function cardAppendText(text, color, time, newLine) {
    const log = $('rtbCardLog');
    if (time) text = text + ' : (' + ((Date.now() - start) / 1000).toFixed(3) + ' sec)';
    if (newLine) text = text + '\n';

    const span = document.createElement('span');
    span.className = 'c-' + (color || 'black');
    span.textContent = text;
    log.appendChild(span);

    // Keep the log bounded for long repeat-matching runs.
    while (log.childNodes.length > 5000) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  // ---------------------------------------------------------------- card information
  async function cardReadInformation() {
    if (!activeCard) {
      await msgError('Card Not Activation');
      return ErrorCodes.ERR_DISCONNECT;
    }

    try {
      if (!fpcMethod.seleted && await fpcMethod.selectApplet() === ErrorCodes.UNDEFINE) {
        await msgError('Selection Fail');
        return ErrorCodes.ERR_NOT_FP_CARD;
      }

      cardInitState(false);
      cardEnrollState(false);

      if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) {
        await msgError('Information Inquiry Fail');
        return ErrorCodes.ERR_FP_DATA_NONE;
      }

      const authOrFail = async () => {
        if (!fpcMethod.cardAuth && await fpcMethod.cardAuthenticate() === ErrorCodes.UNDEFINE) {
          await msgError('Authentication Fail');
          return false;
        }
        return true;
      };

      if (fpcMethod.isLegacyApplet()) {
        let retryGetData = false;

        // Status 0x0F = invalid template: delete it
        for (const finger of [0, 1]) {
          if (fpcMethod.enrollmentStatus[finger] === 0x0F) {
            retryGetData = true;
            if (!await authOrFail()) return ErrorCodes.ERR_DISCONNECT;
            if (await fpcMethod.deleteTemplate(finger) !== ErrorCodes.NO_ERROR) {
              await msgError('Fingerprint Template deletion failed');
              return ErrorCodes.ERR_DISCONNECT;
            }
          }
        }

        if (retryGetData && await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) {
          await msgError('Information Inquiry Fail');
          return ErrorCodes.ERR_FP_DATA_NONE;
        }
      } else if (fpcMethod.enrollmentStatus[0] === 0x0F || fpcMethod.enrollmentStatus[1] === 0x0F) {
        if (fpcMethod.securityOption[2] === 0x01) {
          if (!await authOrFail()) return ErrorCodes.ERR_DISCONNECT;
        }

        if (await fpcMethod.deleteTemplate(2) !== ErrorCodes.NO_ERROR) {
          await msgError('Fingerprint Template deletion failed');
          return ErrorCodes.ERR_DISCONNECT;
        }

        if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) {
          await msgError('Information Inquiry Fail');
          return ErrorCodes.ERR_FP_DATA_NONE;
        }
      }
    } catch (ex) {
      await msgError(ex.message);
      return ErrorCodes.ERR_DISCONNECT;
    }

    if (fpcMethod.isLegacyApplet()) {
      $('btnInitalization').hidden = false;
    } else {
      $('btnInitalization').hidden = true;
      fpcMethod.appInit = true;
    }

    cardInitState(fpcMethod.appInit);
    cardEnrollState(fpcMethod.fpcEnrolled);
    updateEnrollStatus();

    return ErrorCodes.NO_ERROR;
  }

  // ---------------------------------------------------------------- enrollment
  async function stopEnrollTimer() {
    if (!$('cbReTouch').checked) tEnroll.stop();

    const cnt = fpcMethod.enrollmentCnt[fpcMethod.selectedFinger];
    updateEnrollStatus();
    if (fpcMethod.fpcEnrolled) {
      await msgInfo('Enrollment Success (' + cnt + '/16)');
      cardEnrollState(true);
    } else {
      await msgError('Enrollment Error');
      cardEnrollState(false);
    }
  }

  async function fpEnroll() {
    if (!initCard) {
      await msgError('Card Not Initailzation');
      return;
    }

    try {
      if (tEnroll.enabled) {
        // CANCEL
        tEnroll.stop();
        enrollGen++; // drop the result of an APDU still in flight

        setText(['btnEnroll', 'btnDevEnroll'], 'ENROLL');
        updateEnrollStatus();
        setEnabled(['btnDevDelete', 'btnDel'], fpcMethod.enrollmentCnt[fpcMethod.selectedFinger] !== 0);

        if (fpcMethod.isLegacyApplet()) {
          if (await fpcMethod.cancel() === ErrorCodes.NO_ERROR) await msgInfo('Enrollment Cancel');
          else await msgError('Failed to cancel fingerprint template enrollment');
        } else {
          await msgInfo('Enrollment Cancel');
        }
        return;
      }

      if (!fpcMethod.seleted && await fpcMethod.selectApplet() === ErrorCodes.UNDEFINE) {
        await msgError('Selection Fail');
        return;
      }

      if (fpcMethod.securityOption[0] === 0x01) {
        if (!fpcMethod.cardAuth && await fpcMethod.cardAuthenticate() === ErrorCodes.UNDEFINE) {
          await msgError('Authentication Fail');
          return;
        }
      }

      isContinueCmd = false;
      updateEnrollStatus(true, fpcMethod.enrollmentCnt[fpcMethod.selectedFinger]);
      matchCnt = 5;
      tEnroll.start();

      if ($('cbReTouch').checked) setEnabled(['btnDevEnroll', 'btnEnroll'], false);
      else setText(['btnDevEnroll', 'btnEnroll'], 'CANCEL');
      setEnabled(['btnDevDelete', 'btnDel'], false);
    } catch (ex) {
      await msgError(ex.message);
      await updateDisconnectionUI();
    }
  }

  async function tcbEnrollment() {
    if ($('cbReTouch').checked) tEnroll.stop();

    if (enrollBusy) {
      if (enrollApduPending) cardAppendText('apdu cmd processing...', 'red', true, true);
      return;
    }

    enrollBusy = true;
    const gen = enrollGen;
    try {
      const { result, message } = await enrollmentProcessor();
      if (gen !== enrollGen) return; // cancelled / disconnected meanwhile
      await enrollmentResultDsp(result, message);
    } finally {
      enrollBusy = false;
    }
  }

  async function enrollmentProcessor() {
    cardAppendText('[Start Enrollment] ', 'orange', false, true);
    enrollApduPending = true;
    try {
      let result;
      if (fpcMethod.isLegacyApplet()) {
        if (!isContinueCmd) {
          result = await fpcMethod.enrollment();
          isContinueCmd = true;
        } else {
          result = await fpcMethod.continueEnrollment();
        }
      } else {
        result = await fpcMethod.enrollment();
      }
      return { result, message: null };
    } catch (ex) {
      return { result: ErrorCodes.ERR_EXCEPTION, message: ex.message };
    } finally {
      enrollApduPending = false;
    }
  }

  async function enrollmentResultDsp(result, message) {
    const reTouch = $('cbReTouch').checked;
    let isTimer = false;

    try {
      if (result === ErrorCodes.NO_ERROR) { // SW 9000 - enrollment complete
        if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) throw new Error('Failed to get data');
        cardAppendText('[Success Enrollment]', 'green', true, true);
        await stopEnrollTimer();
      } else if (result === ErrorCodes.ERR_EXCEPTION) {
        if (!reTouch) tEnroll.stop();
        await updateDisconnectionUI();
        await msgError(message);
      } else if (result === ErrorCodes.FP_PROCESSING) { // SW 6202
        if (reTouch) {
          await msgError('Remove your finger from the card sensor.\nAnd change the position of the fingerprint to a different angle and try again.', 'Try again');
          isTimer = true;
        }
      } else if (result === ErrorCodes.FP_DETECTED) { // SW 6203 - one touch accepted
        updateEnrollStatus(false, fpcMethod.enrollmentCnt[fpcMethod.selectedFinger]);
        fpcMethod.enrollmentCnt[fpcMethod.selectedFinger]++;
        matchCnt = 5;

        if ($('cbManual').checked) {
          if (!reTouch) tEnroll.stop();
          if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) throw new Error('Failed to get data');
          cardEnrollState(fpcMethod.fpcEnrolled);
          await msgInfo('Enrollment Success (' + fpcMethod.enrollmentCnt[fpcMethod.selectedFinger] + '/16)');
        } else {
          updateEnrollStatus(true, fpcMethod.enrollmentCnt[fpcMethod.selectedFinger]);
          if (reTouch) isTimer = true;
        }
      } else if (result === ErrorCodes.FP_ERROR) { // SW 6204
        if (!reTouch) tEnroll.stop();
        updateEnrollStatus();
        cardEnrollState(fpcMethod.fpcEnrolled);
        await msgError('Enrolled template quality is not good.\nIn this case, user should delete all template in that finger and change another finger for enrollment.');
      } else {
        if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) throw new Error('Failed to get data');
        await stopEnrollTimer();
      }
    } catch (ex) {
      if (!reTouch) tEnroll.stop();
      await updateDisconnectionUI();
      await msgError(ex.message);
    }

    if ($('cbReTouch').checked && isTimer && activeCard) tEnroll.start();
  }

  async function fpDelete() {
    try {
      const opt = fpcMethod.securityOption[2];
      if (opt === 0x01 || opt === 0x03) {
        if (!fpcMethod.cardAuth && await fpcMethod.cardAuthenticate() === ErrorCodes.UNDEFINE) {
          if (opt === 0x01) {
            await msgError('Authentication Fail');
            return;
          }
        }
      }

      if (await fpcMethod.deleteTemplate(fpcMethod.selectedFinger) === ErrorCodes.NO_ERROR) {
        if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) {
          await updateDisconnectionUI();
          await msgError('Information Inquiry Fail');
        } else {
          await msgInfo('FingerPrint Template Deleted');
          cardEnrollState(fpcMethod.fpcEnrolled);
          updateEnrollStatus();
          updateEnrollImgStatus();
        }
      } else {
        await msgError('Deletion fail');
      }
    } catch (ex) {
      await msgError(ex.message);
      await updateDisconnectionUI();
    }
  }

  // ---------------------------------------------------------------- matching
  function setMatchImage(src) {
    $('pbMatch').src = src;
    $('pbDevEnroll').src = src;
  }

  function matchStatsText() {
    return 'Total Test Count : ' + matchProcessingCnt + '\nMatching Success : ' + matchSuccessCnt +
      '\nMatching Fail : ' + matchFailCnt + '\nMatching NA : ' + matchNACnt;
  }

  // MATCH / CANCEL button. Repeat matching only applies to runs started from the DEV tab.
  async function fpMatch(fromDev) {
    if (!(activeCard && initCard && enrollCard)) {
      if (!activeCard) await msgError('Card Not Activation');
      else if (!initCard) await msgError('Card Not Initailzation');
      else if (!enrollCard) await msgError('Card Not Enrollment');
      return;
    }

    if (matchRunning) {
      // CANCEL
      tMatch.stop();
      matchRunning = false;
      matchGen++;

      setMatchImage(IMG.fp);
      setText(['btnMatching', 'btnDevMatching'], 'MATCH');

      if (matchRepeat) {
        await msgInfo('Matching Cancel\n' + matchStatsText(), 'Matching Result');
        initMatchingVariables();
      } else {
        await msgInfo('Matching Cancel');
      }
      return;
    }

    matchRepeat = !!fromDev && $('cbMatch').checked;
    await fpMatchStart();
  }

  async function fpMatchStart() {
    try {
      if (!fpcMethod.seleted && await fpcMethod.selectApplet() === ErrorCodes.UNDEFINE) {
        await msgError('Selection Fail');
        return;
      }

      if (!fpcMethod.isLegacyApplet() && fpcMethod.securityOption[1] === 0x01) {
        if (!fpcMethod.cardAuth && await fpcMethod.cardAuthenticate() === ErrorCodes.UNDEFINE) {
          await msgError('Authentication Fail');
          return;
        }
      }
    } catch (ex) {
      await msgError(ex.message);
      await updateDisconnectionUI();
      return;
    }

    setText(['btnMatching', 'btnDevMatching'], 'CANCEL');
    setMatchImage(IMG.scan);

    matchCnt = matchRepeat ? 1 : 3;
    matchRunning = true;
    tMatch.start();
  }

  async function tcbMatch() {
    if (matchRepeat && tMatch.enabled) tMatch.stop();

    if (matchBusy) {
      if (matchApduPending) cardAppendText('apdu cmd processing...', 'red', true, true);
      return;
    }

    matchBusy = true;
    const gen = matchGen;
    try {
      const { result, message } = await matchProcessor();
      if (gen !== matchGen) return;
      await matchResultDsp(result, message);
    } finally {
      matchBusy = false;
    }
  }

  async function matchProcessor() {
    cardAppendText('[MATCHING START] ', 'orange', false, true);
    matchApduPending = true;
    try {
      matchStartTime = performance.now();
      const result = await fpcMethod.fingerPrintIsValidate();
      matchDuration = performance.now() - matchStartTime;
      return { result, message: null };
    } catch (ex) {
      return { result: ErrorCodes.ERR_EXCEPTION, message: ex.message };
    } finally {
      matchApduPending = false;
    }
  }

  async function matchResultDsp(result) {
    const repeat = matchRepeat;
    let bResult = false;

    try {
      if (result === ErrorCodes.NO_ERROR) {
        cardAppendText('[FingerPrint Match]', 'green', true, true);
        setMatchImage(IMG.match);

        if (!repeat) {
          tMatch.stop();
          if (await fpcMethod.getInformation() === ErrorCodes.UNDEFINE) throw new Error('Failed to get data');
          await showResultAndContinue('Matching Success\nMatching time : ' + matchDuration.toFixed(1) + ' ms\n\n' +
            'Enrollment Status (' + fpcMethod.enrollmentCnt[fpcMethod.selectedFinger] + '/16)');
        } else {
          setText(['btnMatching', 'btnDevMatching'], 'MATCH');
          matchSuccessCnt++;
          bResult = true;
        }
      } else if (result === ErrorCodes.ERR_EXCEPTION) {
        tMatch.stop();
        matchRunning = false;
        setMatchImage(IMG.fp);
        setText(['btnMatching', 'btnDevMatching'], 'MATCH');
        await updateDisconnectionUI();
        await msgError('Exception', 'Matching Result');
      } else if (result === ErrorCodes.FP_PROCESSING) {
        if (--matchCnt === 0) {
          cardAppendText('[Not Match(TimeOut)]', 'red', true, true);
          setMatchImage(IMG.notMatch);

          if (!repeat) {
            await showResultAndContinue('Not Match (TimeOut)');
          } else {
            setText(['btnMatching', 'btnDevMatching'], 'MATCH');
            matchNACnt++;
            bResult = true;
          }
        }
      } else if (result === ErrorCodes.FP_FAILED) {
        cardAppendText('[Not Match]', 'red', true, true);
        setMatchImage(IMG.notMatch);

        if (!repeat) {
          await showResultAndContinue('Not Match');
        } else {
          setText(['btnMatching', 'btnDevMatching'], 'MATCH');
          matchFailCnt++;
          bResult = true;
        }
      } else {
        cardAppendText('[Unsupport Command]', 'red', true, true);
        setMatchImage(IMG.fp);
        setText(['btnMatching', 'btnDevMatching'], 'MATCH');
        tMatch.stop();
        matchRunning = false;
        if (repeat) initMatchingVariables();
        await msgError('Unsupport Command', 'Matching Result');
      }
    } catch (ex) {
      tMatch.stop();
      matchRunning = false;
      setText(['btnMatching', 'btnDevMatching'], 'MATCH');
      await updateDisconnectionUI();
      await msgError(ex.message);
      return;
    }

    if (bResult && repeat) {
      ++matchProcessingCnt;
      cardAppendText(matchStatsText() + '\n', 'red', false, true);

      if (matchProcessingCnt >= matchTotalCnt) {
        matchRunning = false;
        await msgInfo(matchStatsText(), 'Matching Result');
        initMatchingVariables();
      } else {
        const gen = matchGen;
        await sleep(matchDelay);
        if (gen !== matchGen || !matchRunning || !activeCard) return; // cancelled during the delay
        matchRunning = false;
        await fpMatchStart();
      }
    }
  }

  // Single (non-repeat) matching runs continuously: keep the result image (match / not match) on screen
  // for 1 s without a popup, then match again until the user presses CANCEL. The result is still logged.
  async function showResultAndContinue(text) {
    tMatch.stop();
    const gen = matchGen;
    cardAppendText(text.replace(/\n+/g, ' | '), 'black', false, true);
    await sleep(1000);
    if (gen !== matchGen || !matchRunning || !activeCard) return; // cancelled / disconnected

    setMatchImage(IMG.scan);
    matchCnt = 3;
    tMatch.start();
  }

  function initMatchingVariables() {
    matchProcessingCnt = 0;
    matchSuccessCnt = 0;
    matchFailCnt = 0;
    matchNACnt = 0;
  }

  // ---------------------------------------------------------------- connect / disconnect
  async function btnConnectClick() {
    if (!selectedReaderName) {
      await msgError('Select Reader');
      return;
    }

    try {
      await updateDisconnectionUI();
      const { atr } = await bridge.connect(selectedReaderName);
      cardAppendText('[CARD ACTIVATE] ' + atr, 'blue', false, true);

      cardActiveState(true);
      fpcMethod.seleted = false;
      fpcMethod.cardAuth = false;

      const result = await cardReadInformation();
      if (result === ErrorCodes.NO_ERROR) {
        setEnabled(['btnDisconnect', 'btnEnrollment', 'btnMatch', 'btnSetting', 'cbSelectFinger', 'cbDevSelectFinger'], true);
        updateStatusTextBox();
        updateEnrollImgStatus();
      } else {
        await updateDisconnectionUI();
      }
    } catch (ex) {
      cardActiveState(false);
      await msgError('Card Connection Fail\n\n' + ex.message);
    }
  }

  async function updateDisconnectionUI() {
    if (!selectedReaderName || !activeCard) return;

    // Stop background activity (the WinForms version aborted its worker threads)
    tEnroll.stop();
    tMatch.stop();
    tInit.stop();
    enrollGen++;
    matchGen++;
    matchRunning = false;
    setText(['btnEnroll', 'btnDevEnroll'], 'ENROLL');
    setText(['btnMatching', 'btnDevMatching'], 'MATCH');
    setText(['btnInit'], 'INITIALIZATION');
    $('pbInitState').src = IMG.fp;
    setMatchImage(IMG.fp);

    try {
      if (bridge.connected) await bridge.disconnect();
    } catch (e) {
      // ignore - card or bridge already gone
    }
    fpcMethod.disconnect();

    cardActiveState(false);
    cardInitState(false);
    cardEnrollState(false);

    fpcMethod.seleted = false;
    setEnabled(['btnDisconnect', 'btnInitalization', 'btnInit', 'btnEnrollment', 'btnMatch', 'btnSetting',
      'btnEnroll', 'btnDevEnroll', 'btnDel', 'btnDevDelete', 'btnMatching', 'btnDevMatching',
      'cbSelectFinger', 'cbDevSelectFinger'], false);

    fpcMethod.enrollmentCnt[0] = 0;
    fpcMethod.enrollmentCnt[1] = 0;

    initMatchingVariables();
    updateEnrollStatus();
  }

  // ---------------------------------------------------------------- finger selection
  function selectFinger(index, updateTiles) {
    fpcMethod.selectedFinger = index;
    const s = fpcMethod.enrollmentStatus[index];
    fpcMethod.fpcEnrolled = s === 0x02 || s === 0x03;

    if (activeCard) cardEnrollState(fpcMethod.fpcEnrolled);
    updateEnrollStatus();
    if (updateTiles) updateEnrollImgStatus();
  }

  // ---------------------------------------------------------------- navigation
  const TABS = ['tbEnrollment', 'tbMatch', 'tbAbout', 'tbDev'];
  const NAV = { tbEnrollment: 'btnEnrollment', tbMatch: 'btnMatch', tbAbout: 'btnAbout', tbDev: 'btnDev' };

  function selectTab(tabId) {
    for (const t of TABS) {
      $(t).hidden = t !== tabId;
      $(NAV[t]).classList.toggle('active', t === tabId);
    }
  }

  // ---------------------------------------------------------------- initialization dialog (initForm)
  function openInitForm() {
    if (!activeCard) {
      msgError('Card Not Activation');
      return;
    }
    $('pbInitState').src = IMG.fp;
    if (!tInit.enabled) setText(['btnInit'], 'INITIALIZATION');
    $('btnInit').disabled = initCard;
    $('initForm').showModal();
  }

  async function stopInitTimer() {
    tInit.stop();
    $('pbInitState').src = IMG.fp;
    setText(['btnInit'], 'INITIALIZATION');

    if (fpcMethod.appInit) {
      await msgInfo('Initialization successful');
      cardInitState(true);
      $('btnInit').disabled = true;
    } else {
      await msgError('Initialization failed');
      cardInitState(false);
      $('btnInit').disabled = false;
    }
  }

  async function btnInitClick() {
    if (initCard) {
      await msgError('Already Initialized');
      return;
    }

    if (tInit.enabled || initBusy) {
      // CANCEL
      tInit.stop();
      try {
        await fpcMethod.cancel();
      } catch (e) {
        // ignore
      }
      setText(['btnInit'], 'INITIALIZATION');
      $('pbInitState').src = IMG.fp;
      await msgInfo('Initialization Cancel');
      return;
    }

    try {
      if (await fpcMethod.selectApplet() === ErrorCodes.UNDEFINE) {
        await msgError('Selection Fail');
        return;
      }

      if (!fpcMethod.cardAuth && await fpcMethod.cardAuthenticate() === ErrorCodes.UNDEFINE) {
        await msgError('Authentication Fail');
        return;
      }

      $('pbInitState').src = IMG.scan;
      if (await fpcMethod.cardInitialize() === ErrorCodes.UNDEFINE) {
        $('pbInitState').src = IMG.fp;
        await msgError('Card Initialize Fail');
        return;
      }

      tInit.start();
      if (!initCard) setText(['btnInit'], 'CANCEL');
    } catch (ex) {
      await msgError(ex.message);
      $('btnInit').disabled = true;
      $('pbInitState').src = IMG.fp;
      await updateDisconnectionUI();
    }
  }

  async function tcbInit() {
    if (initBusy) return;
    initBusy = true;
    try {
      const stillBusy = await fpcMethod.initContinue();
      if (!tInit.enabled) return; // cancelled meanwhile
      if (!stillBusy) await stopInitTimer();
    } catch (ex) {
      if (tInit.enabled) {
        await stopInitTimer();
        await updateDisconnectionUI();
      }
    } finally {
      initBusy = false;
    }
  }

  function closeInitForm() {
    tInit.stop();
    if ($('initForm').open) $('initForm').close();
  }

  // ---------------------------------------------------------------- setting dialog (settingForm)
  function openSettingForm() {
    const raw = storageGet(KEY_STORAGE);
    const parts = raw ? raw.split(';') : ['', '', ''];
    $('tbEnc').value = parts[0] || '';
    $('tbMac').value = parts[1] || '';
    $('tbDek').value = (parts[2] || '').replace(/\r?\n/g, '');
    $('settingForm').showModal();
  }

  async function btnSettingOk() {
    const keys = ['tbEnc', 'tbMac', 'tbDek'].map((id) => $(id).value.trim().toUpperCase());
    if (keys.every((k) => /^[0-9A-F]{32}$/.test(k))) {
      storageSet(KEY_STORAGE, keys.join(';'));
      $('settingForm').close();
      await msgInfo('Key Changed');
    } else {
      await msgError('Key Length Error');
    }
  }

  async function btnSettingDefault() {
    storageSet(KEY_STORAGE, null);
    await msgInfo('Use default Key');
    ['tbEnc', 'tbMac', 'tbDek'].forEach((id) => { $(id).value = ''; });
  }

  // ---------------------------------------------------------------- dev tab
  async function btnApduSendClick() {
    if (!activeCard) {
      await msgError('Card Not Activation');
      return;
    }

    const apdu = $('tbApdu').value.replace(/\s+/g, '').toUpperCase();
    $('tbApdu').value = apdu;
    if (apdu.length === 0) return;

    try {
      await fpcMethod.sendApdu(apdu);
    } catch (e) {
      await msgError('Wrong APDU' + (e && e.message && !/hex/i.test(e.message) ? '\n\n' + e.message : ''));
    }
  }

  async function btnSensorTestClick() {
    try {
      if (!fpcMethod.seleted && await fpcMethod.selectApplet() === ErrorCodes.UNDEFINE) {
        await msgError('Selection Fail');
      }

      if (await fpcMethod.sensorSelfTest() === ErrorCodes.NO_ERROR) {
        const r1 = fpcMethod.sensorFirstResult <= 159 ? 'PASS' : 'FAIL';
        const r2 = fpcMethod.sensorSecondResult <= 4 ? 'PASS' : 'FAIL';
        const r3 = fpcMethod.sensorThirdResult <= 2000 ? 'PASS' : 'FAIL';
        await msgInfo(
          'Sensor crack and Clock noise : ' + r1 + ' (' + fpcMethod.sensorFirstResult + ')\n' +
          'Sensor crack : ' + r2 + ' (' + fpcMethod.sensorSecondResult + ')\n' +
          'Clock noise : ' + r3 + ' (' + fpcMethod.sensorThirdResult + ')',
          'Sensor Self-Test Result');
      } else {
        await msgError('Please try the Sensor Self-Test again.');
      }
    } catch (ex) {
      await msgError(ex.message);
    }
  }

  // ---------------------------------------------------------------- events
  function wireEvents() {
    $('msgOk').addEventListener('click', closeMessageBox);
    $('msgBox').addEventListener('close', closeMessageBox); // Esc

    $('bridgeRetry').addEventListener('click', guarded(connectBridge));
    $('cbSelReader').addEventListener('change', (e) => { selectedReaderName = e.target.value || null; });
    $('btnReload').addEventListener('click', guarded(async () => {
      if (!bridge.connected) await connectBridge();
      else await readerListLoad();
    }));
    $('btnConnect').addEventListener('click', guarded(btnConnectClick));
    $('btnDisconnect').addEventListener('click', guarded(updateDisconnectionUI));
    $('btnSetting').addEventListener('click', openSettingForm);
    $('btnInitalization').addEventListener('click', openInitForm);

    $('btnEnrollment').addEventListener('click', () => {
      selectTab('tbEnrollment');
      $('cbSelectFinger').selectedIndex = fpcMethod.selectedFinger;
      updateEnrollImgStatus();
      updateEnrollStatus();
    });
    $('btnMatch').addEventListener('click', () => selectTab('tbMatch'));
    $('btnAbout').addEventListener('click', () => selectTab('tbAbout'));
    $('btnDev').addEventListener('click', () => {
      selectTab('tbDev');
      $('cbDevSelectFinger').selectedIndex = fpcMethod.selectedFinger;
    });

    // Hidden features (Ctrl+Shift+F11: DEV tab, F10: MATCH tab, F9: finger selection)
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      if (e.key === 'F11') $('btnDev').hidden = false;
      else if (e.key === 'F10') $('btnMatch').hidden = false;
      else if (e.key === 'F9') $('cbSelectFinger').hidden = false;
      else return;
      e.preventDefault();
    });

    $('cbSelectFinger').addEventListener('change', (e) => selectFinger(e.target.selectedIndex, true));
    $('cbDevSelectFinger').addEventListener('change', (e) => selectFinger(e.target.selectedIndex, false));

    // ENROLL / MATCH double as CANCEL, so they bypass the busy guard while a run is active.
    const enrollClick = async () => {
      if (uiBusy && !tEnroll.enabled) return;
      uiBusy = true;
      try { await fpEnroll(); } finally { uiBusy = false; }
    };
    const matchClick = (fromDev) => async () => {
      if (uiBusy && !matchRunning) return;
      uiBusy = true;
      try { await fpMatch(fromDev); } finally { uiBusy = false; }
    };
    $('btnEnroll').addEventListener('click', enrollClick);
    $('btnDevEnroll').addEventListener('click', enrollClick);
    $('btnDel').addEventListener('click', guarded(fpDelete));
    $('btnDevDelete').addEventListener('click', guarded(fpDelete));
    $('btnMatching').addEventListener('click', matchClick(false));
    $('btnDevMatching').addEventListener('click', matchClick(true));

    $('cbReTouch').addEventListener('change', (e) => tEnroll.setInterval(e.target.checked ? 20 : 1000));

    $('btnApduSend').addEventListener('click', guarded(btnApduSendClick));
    $('tbApdu').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        guarded(btnApduSendClick)();
      }
    });
    $('btnSensorTest').addEventListener('click', guarded(btnSensorTestClick));
    $('btnDevClear').addEventListener('click', () => {
      $('rtbCardLog').textContent = '';
      start = Date.now();
    });

    $('cbMatch').addEventListener('change', (e) => {
      const on = e.target.checked;
      $('tbMatchDelay').disabled = !on;
      $('tbMatchCount').disabled = !on;
      if (on) {
        matchDelay = parseInt($('tbMatchDelay').value, 10) || 0;
        matchTotalCnt = parseInt($('tbMatchCount').value, 10) || 1;
      }
    });
    $('tbMatchDelay').addEventListener('input', (e) => {
      if (e.target.value !== '') matchDelay = parseInt(e.target.value, 10) || 0;
    });
    $('tbMatchCount').addEventListener('input', (e) => {
      if (e.target.value !== '') matchTotalCnt = parseInt(e.target.value, 10) || 1;
    });

    // Init dialog
    $('btnInit').addEventListener('click', async () => {
      if (uiBusy && !tInit.enabled) return;
      uiBusy = true;
      try { await btnInitClick(); } finally { uiBusy = false; }
    });
    $('btnInitExit').addEventListener('click', closeInitForm);
    $('initForm').addEventListener('cancel', () => tInit.stop());

    // Setting dialog
    $('btnOk').addEventListener('click', btnSettingOk);
    $('btnDefault').addEventListener('click', btnSettingDefault);
    $('btnCancel').addEventListener('click', () => $('settingForm').close());
    $('btnSettingExit').addEventListener('click', () => $('settingForm').close());
  }

  // Expose for debugging from the console
  window.fpcManager = { bridge, fpcMethod, UBScp02, DES };

  pnMainLoad();
})();
