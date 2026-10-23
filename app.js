(() => {
  'use strict';

  // Safari (desktop and iOS 14.5+) only exposes the prefixed constructor.
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // If nothing is heard within this window we stop and show "no speech".
  // iOS Safari often never fires the 'no-speech' error itself, so we can't rely on it.
  const NO_SPEECH_TIMEOUT_MS = 8000;

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'),
    statusText: $('status-text'),
    transcript: $('transcript'),
    final: $('final'),
    interim: $('interim'),
    error: $('error'),
    errorTitle: $('error-title'),
    errorBody: $('error-body'),
    mic: $('mic'),
    copy: $('copy'),
    clear: $('clear'),
    log: $('log'),
  };

  const STATUS_TEXT = {
    idle: 'Tap the mic to start',
    starting: 'Starting… allow microphone access if asked',
    listening: 'Listening… tap to stop',
    processing: 'Processing…',
    done: 'Done',
    error: 'Something went wrong',
  };

  const ERRORS = {
    unsupported: {
      title: 'This browser doesn’t support speech recognition',
      body: 'Open this page in Safari on iPhone (iOS 14.5 or later), or in Chrome or Edge on desktop. In-app browsers such as Instagram’s or Gmail’s usually don’t support it.',
    },
    insecure: {
      title: 'This page needs HTTPS',
      body: 'Browsers only allow microphone access on secure (https://) pages or localhost.',
    },
    'not-allowed': {
      title: 'Microphone access was blocked',
      body: 'On iPhone: Settings → Apps → Safari → Microphone → Allow (or tap “aA” in the address bar → Website Settings → Microphone). Then reload and try again.',
    },
    'service-not-allowed': {
      title: 'Speech recognition is turned off',
      body: 'Safari uses Apple’s dictation service. On iPhone, check Settings → General → Keyboard → Enable Dictation, and that Speech Recognition is allowed for Safari under Settings → Privacy & Security.',
    },
    'no-speech': {
      title: 'No speech detected',
      body: 'I didn’t hear anything. Check that your mic isn’t muted or blocked, move somewhere quieter, and tap the mic to try again.',
    },
    'audio-capture': {
      title: 'No microphone found',
      body: 'Another app may be using the microphone (a call, or a voice memo recording). Close it and try again.',
    },
    network: {
      title: 'Network error',
      body: 'Recognition runs on a server in some browsers. Check your connection and try again.',
    },
    'language-not-supported': {
      title: 'Language not supported',
      body: 'Your device language isn’t supported for dictation. Try switching to English (US).',
    },
    unknown: {
      title: 'Recognition stopped unexpectedly',
      body: 'Tap the mic to try again.',
    },
  };

  let recognition = null;
  let state = 'idle';
  let errorShown = false;
  let heardSomething = false;
  let userAborted = false;
  let noSpeechTimer = null;
  let t0 = 0;
  let finalText = '';

  function log(msg) {
    const li = document.createElement('li');
    const ms = t0 ? `+${Math.round(performance.now() - t0)}ms ` : '';
    li.textContent = ms + msg;
    els.log.appendChild(li);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setState(next) {
    state = next;
    els.status.dataset.state = next;
    els.statusText.textContent = STATUS_TEXT[next];
    const active = next === 'starting' || next === 'listening';
    els.mic.setAttribute('aria-pressed', String(active));
    els.mic.setAttribute('aria-label', active ? 'Stop listening' : 'Start listening');
    els.mic.disabled = next === 'processing';
    const hasText = finalText.length > 0;
    els.copy.disabled = !hasText || active;
    els.clear.disabled = !hasText || active;
  }

  function showError(code) {
    const e = ERRORS[code] || ERRORS.unknown;
    errorShown = true;
    els.errorTitle.textContent = e.title;
    els.errorBody.textContent = e.body;
    els.error.hidden = false;
    setState('error');
  }

  function hideError() {
    errorShown = false;
    els.error.hidden = true;
  }

  function renderTranscript(finalStr, interimStr) {
    els.final.textContent = finalStr;
    els.interim.textContent = interimStr ? (finalStr ? ' ' : '') + interimStr : '';
    els.transcript.dataset.empty = String(!finalStr && !interimStr);
  }

  // Rebuild the whole transcript from event.results on every event rather than
  // appending. Some iOS versions resend earlier results, or return a final result
  // that already contains the previous ones; appending would duplicate words.
  function buildTranscript(results) {
    let fin = '';
    let interim = '';
    for (let i = 0; i < results.length; i++) {
      const text = results[i][0].transcript.trim();
      if (!text) continue;
      if (results[i].isFinal) {
        const prev = fin.toLowerCase();
        if (prev && text.toLowerCase().startsWith(prev)) {
          fin = text; // cumulative result: replace instead of appending
        } else if (text.split(/\s+/).length >= 3 && prev.endsWith(text.toLowerCase())) {
          // repeat of a phrase we already have: skip (short words like "yes" may repeat legitimately)
        } else {
          fin = fin ? `${fin} ${text}` : text;
        }
      } else {
        interim = interim ? `${interim} ${text}` : text;
      }
    }
    return { fin, interim };
  }

  function clearNoSpeechTimer() {
    clearTimeout(noSpeechTimer);
    noSpeechTimer = null;
  }

  function start() {
    hideError();
    heardSomething = false;
    userAborted = false;
    finalText = '';
    renderTranscript('', '');
    els.log.innerHTML = '';
    t0 = performance.now();

    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => log('start');
    recognition.onaudiostart = () => {
      log('audiostart');
      setState('listening');
    };
    recognition.onsoundstart = () => log('soundstart');
    recognition.onspeechstart = () => {
      log('speechstart');
      heardSomething = true;
      clearNoSpeechTimer();
    };
    recognition.onspeechend = () => log('speechend');
    recognition.onsoundend = () => log('soundend');
    recognition.onaudioend = () => log('audioend');

    recognition.onresult = (event) => {
      heardSomething = true;
      clearNoSpeechTimer();
      if (state === 'starting') setState('listening');
      const { fin, interim } = buildTranscript(event.results);
      finalText = fin;
      renderTranscript(fin, interim);
      const last = event.results[event.results.length - 1];
      log(`result #${event.resultIndex}/${event.results.length} ${last.isFinal ? 'final' : 'interim'}: "${last[0].transcript.trim()}"`);
    };

    recognition.onnomatch = () => log('nomatch');

    recognition.onerror = (event) => {
      log(`error: ${event.error}${event.message ? ` (${event.message})` : ''}`);
      clearNoSpeechTimer();
      if (event.error === 'aborted' && userAborted) return;
      showError(event.error in ERRORS ? event.error : 'unknown');
    };

    recognition.onend = () => {
      log('end');
      clearNoSpeechTimer();
      recognition = null;
      if (errorShown) return;
      // Finalise whatever interim text is left. Safari sometimes ends without
      // marking the last chunk final.
      const leftover = els.interim.textContent.trim();
      if (leftover) finalText = finalText ? `${finalText} ${leftover}` : leftover;
      renderTranscript(finalText, '');
      if (!finalText) {
        showError('no-speech');
      } else {
        setState('done');
      }
    };

    setState('starting');
    noSpeechTimer = setTimeout(() => {
      if (!heardSomething && recognition) {
        log(`no speech after ${NO_SPEECH_TIMEOUT_MS / 1000}s, stopping`);
        userAborted = true;
        recognition.abort();
        showError('no-speech');
      }
    }, NO_SPEECH_TIMEOUT_MS);

    try {
      // Must run synchronously inside the tap handler or iOS refuses to start.
      recognition.start();
    } catch (err) {
      log(`start() threw: ${err.name}`);
      clearNoSpeechTimer();
      recognition = null;
      showError('unknown');
    }
  }

  function stop() {
    if (!recognition) return;
    clearNoSpeechTimer();
    setState('processing');
    log('stop() called');
    recognition.stop(); // onend fires once the last result is delivered
  }

  els.mic.addEventListener('click', () => {
    if (state === 'starting' || state === 'listening') stop();
    else start();
  });

  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(finalText);
      els.copy.textContent = 'Copied';
    } catch {
      // Older iOS: fall back to selecting the text so the user can copy it.
      const range = document.createRange();
      range.selectNodeContents(els.final);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      els.copy.textContent = 'Selected';
    }
    setTimeout(() => { els.copy.textContent = 'Copy'; }, 1500);
  });

  els.clear.addEventListener('click', () => {
    finalText = '';
    renderTranscript('', '');
    hideError();
    setState('idle');
  });

  // iOS suspends the mic when Safari goes to the background; end cleanly
  // instead of leaving the UI stuck on "Listening".
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && recognition) {
      log('page hidden, stopping');
      stop();
    }
  });

  // Feature checks up front so the user never taps a button that can't work.
  if (!SpeechRecognition) {
    showError('unsupported');
    els.mic.disabled = true;
  } else if (!window.isSecureContext) {
    showError('insecure');
    els.mic.disabled = true;
  } else {
    setState('idle');
  }
})();
