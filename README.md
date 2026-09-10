# QVAC local voice assistant

This Expo example records a short Spanish voice message, transcribes it with a local QVAC Whisper model, and streams a Spanish answer from a local QVAC Llama model. Audio and model inference stay on the Android phone after the first model download.

## Run on Android

QVAC uses native inference and does not run in an Android emulator. Use a physical Android device.

```sh
npx expo prebuild
npx expo run:android --device
```

The first launch downloads the Spanish Whisper Tiny and Llama 3.2 1B models. Later launches use the cached model files and work offline.

Tap the green button, speak in Spanish, then tap it again. QVAC transcribes the recording and streams the response into the chat.
