# Voice Input Demo

A small speech-to-text demo for **Safari on iPhone**, built with the browser's Web Speech API. No backend, no API keys, no dependencies: three static files.

**Live demo:** https://pushtishah11.github.io/voice-input-demo/ (open it on your phone)

## What it does

- **Mic button**: tap to start, tap again to stop.
- **Live transcript**: interim words show in grey while you talk and turn solid once the recognizer finalizes them.
- **Clear states**: *Starting* (waiting on permission) → *Listening* → *Processing* (after you tap stop, while the last result comes in) → *Done*.
- **Error handling**, each with a plain-language fix:
  | Case | How it's detected |
  |---|---|
  | Browser not supported | No `SpeechRecognition` / `webkitSpeechRecognition` on load. The mic is disabled before the user can tap it. |
  | Not on HTTPS | `window.isSecureContext` is false. |
  | Mic permission denied | `error` event with `not-allowed` |
  | Dictation / Siri turned off (iOS) | `error` event with `service-not-allowed` |
  | No speech detected | The `no-speech` error, **or** our own 8-second timeout, **or** the session ending with an empty transcript. iOS often doesn't fire `no-speech`, so the fallbacks are needed. |
  | Mic busy, network, unsupported language | `audio-capture`, `network`, `language-not-supported` |
- **Event log** (collapsed at the bottom): every recognition event with a timestamp, so you can see how a given browser behaves.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Browsers allow microphone access on `localhost`. To test on a phone you need HTTPS, so use the GitHub Pages URL.

## Web Speech API vs. Whisper vs. AssemblyAI

| | Web Speech API (this demo) | OpenAI Whisper | AssemblyAI |
|---|---|---|---|
| **Where it runs** | The browser hands audio to the OS/vendor engine (Apple's dictation on Safari, Google's servers on Chrome) | Open-source model you host yourself, or OpenAI's hosted API | Hosted API only |
| **Cost** | Free | Free if self-hosted (you pay for compute); per-minute price on the API | Per-hour pricing |
| **Live results while talking** | Yes, built in (`interimResults`) | Not natively. Whisper transcribes finished clips; "live" needs chunking plus your own stitching | Yes, streaming over a WebSocket |
| **Setup** | Zero: a few lines of JS | Record with `MediaRecorder`, upload the file, and run a backend so the API key isn't exposed | Backend that mints short-lived tokens, plus a WebSocket client |
| **Browser support** | Uneven: Safari and Chromium only; Firefox has none. Each browser behaves differently | Any browser that can record audio | Any browser that can record audio |
| **Accuracy / control** | Good for short dictation. No choice of model, no custom vocabulary, results vary by browser | Strong on accents, noise and punctuation, 90+ languages; same model everywhere | Strong accuracy plus extras: speaker labels, word timestamps, custom vocabulary |
| **Privacy** | Audio goes to Apple or Google, depending on browser | Can stay entirely on your own servers | Goes to AssemblyAI |

**When I'd use each:**
- **Web Speech API**: prototypes and simple "dictate into a text box" features, where free and instant matter more than consistency.
- **Whisper**: when the transcript has to be the same quality on every device, when audio has to stay in-house, or for batch work (voice notes, uploaded recordings).
- **AssemblyAI**: real-time production features where you'd rather pay than run models, especially if you need speaker labels or timestamps.

A sensible production setup is often **both**: Web Speech for instant on-screen feedback, then send the recording to Whisper or AssemblyAI for the transcript you actually save.

## Safari quirks

These are the iOS Safari behaviours the code works around. Each comes from WebKit docs, bug reports or developer write-ups.

1. **Prefixed only.** Safari exposes `webkitSpeechRecognition`, not `SpeechRecognition`, and only on iOS 14.5 and later.
2. **It depends on Siri/Dictation.** If Dictation is turned off on the phone, recognition fails with `service-not-allowed` even when mic permission is granted. That's why the demo treats it as its own error with its own fix.
3. **Two permission prompts.** iOS can ask for microphone access *and* speech recognition access. Safari may also ask again on each visit unless the site is set to "Allow" under Website Settings.
4. **Must start from a tap.** `recognition.start()` has to run synchronously inside the click handler. Calling it after an `await` or a timer is refused.
5. **`no-speech` is unreliable.** iOS often just ends the session quietly instead of firing `no-speech`. The demo adds its own timeout and treats "ended with an empty transcript" as no speech.
6. **Duplicated results with `continuous = true`.** Some iOS versions resend earlier results, or return a final result that already contains the previous ones. The demo rebuilds the transcript from `event.results` on every event, and drops a final result that repeats or contains the text before it, instead of blindly appending.
7. **Sessions can end on their own.** Older iOS versions were reported to stop after a pause or a time limit, even in continuous mode. In my testing on iOS 26 it didn't, but the UI still listens for `end` rather than assuming the session lasts until the user taps stop.
8. **The last chunk may never be marked final.** On `end`, any leftover interim text is kept as final so the user's last words aren't lost.
9. **Backgrounding kills the mic.** Switching apps or locking the phone stops capture. The demo stops cleanly on `visibilitychange` so the UI isn't stuck on "Listening".
10. **In-app browsers and home-screen web apps.** WebViews inside other apps (Instagram, Gmail, and so on) and "Add to Home Screen" apps may not support it at all. The unsupported-browser message says to open the page in Safari.

  ### What I saw on my iPhone

Tested on iPhone, iOS 26.6.1, in Safari.
- **Normal dictation:** worked. The transcript showed live while I spoke, and Copy pasted correctly into Notes.
- **Long input (30+ seconds):** kept listening the whole time without cutting off.
- **Pauses:** with `continuous = true`, a ~5 second pause didn't end the session. It picked up where I left off.
- **Silence:** showed "No speech detected" with the fix-it message, so the fallback works.
- **Switching apps:** iOS stopped the mic, and the page ended cleanly instead of getting stuck on "Listening".

## Files

- `index.html`: markup
- `style.css`: mobile-first styles (safe-area insets, 44pt tap targets, dark mode)
- `app.js`: recognition state machine and error handling
