import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Press-and-hold speech-to-text using the browser's built-in Web Speech API
 * (Chrome / Edge on Windows and Android). No extra library or API key.
 * Only audio goes to the browser's speech service; product and customer lists never leave the device.
 */

export type SpeechLang = 'ur-PK' | 'en-IN';
export type SpeechState = 'idle' | 'listening' | 'processing';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => typeof window !== 'undefined' && recognitionCtor() !== null;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission required hai. Browser ke address bar mein 🎤 par click karke Allow karein.',
  'service-not-allowed': 'Microphone permission required hai.',
  'audio-capture': 'Microphone nahi mila. Mic lagayein ya check karein.',
  network: 'Voice ke liye internet chahiye (browser ki speech service online hai).',
  'no-speech': 'Sorry, command samajh nahi aayi. Dobara bolain.',
  'language-not-supported': 'Yeh zubaan is browser mein support nahi. Roman/English try karein.',
};

export function useSpeech(lang: SpeechLang, onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [interim, setInterim] = useState('');
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef('');
  const errorRef = useRef<string | null>(null);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      handlers.current.onError('Is browser mein voice support nahi. Chrome ya Edge use karein — ya command type karein.');
      return;
    }
    if (recRef.current) return; // already listening
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalRef.current = '';
    errorRef.current = null;
    setInterim('');
    rec.onresult = (e) => {
      let finalText = '';
      let live = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += `${r[0]!.transcript} `;
        else live += r[0]!.transcript;
      }
      finalRef.current = finalText;
      setInterim(`${finalText}${live}`.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      errorRef.current = ERRORS[e.error] ?? 'Sorry, command samajh nahi aayi. Dobara bolain.';
    };
    rec.onend = () => {
      recRef.current = null;
      const text = finalRef.current.trim();
      setState('idle');
      if (errorRef.current && !text) handlers.current.onError(errorRef.current);
      else if (!text) handlers.current.onError('Sorry, command samajh nahi aayi. Dobara bolain.');
      else handlers.current.onText(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setState('listening');
    } catch {
      recRef.current = null;
      handlers.current.onError('Microphone shuru nahi ho saka. Dobara try karein.');
    }
  }, [lang]);

  /** Release: stop listening; the final text arrives in onend. */
  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    setState('processing');
    rec.stop();
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { state, interim, start, stop, supported: speechSupported() };
}
