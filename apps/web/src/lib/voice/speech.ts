import { useCallback, useEffect, useRef, useState } from 'react';
import { completeWakeCommand, removeWakeWords, sleepCommandRemainder, wakeWordRemainder } from './interaction';

/**
 * Browser speech recognition for push-to-talk and explicit wake-word hands-free mode.
 * Product/customer data stays in the app; the browser speech service receives microphone audio.
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

type Mode = 'manual' | 'wake' | null;

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

const RESTART_DELAY_MS = 250;

export function useSpeech(
  lang: SpeechLang,
  onText: (text: string) => void,
  onError: (message: string) => void,
  onSleep: () => void = () => undefined,
) {
  const [state, setState] = useState<SpeechState>('idle');
  const [interim, setInterim] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const modeRef = useRef<Mode>(null);
  const finalRef = useRef('');
  const errorRef = useRef<string | null>(null);
  const wakeActiveRef = useRef(false);
  const recognitionFallbackRef = useRef(false);
  const commandRef = useRef('');
  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandBoundaryRecRef = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError, onSleep });
  handlers.current = { onText, onError, onSleep };
  const interimCommandRef = useRef('');

  const clearCommandTimer = () => {
    if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
    commandTimerRef.current = null;
  };

  const clearRestartTimer = () => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  };

  const finishWakeCommand = useCallback(() => {
    const text = commandRef.current.trim();
    commandRef.current = '';
    interimCommandRef.current = '';
    wakeActiveRef.current = false;
    setWakeWordActive(false);
    setInterim('');
    if (text) handlers.current.onText(text);
  }, []);

  const finishSleepCommand = useCallback((remainder: string) => {
    clearCommandTimer();
    commandRef.current = remainder;
    interimCommandRef.current = '';
    finishWakeCommand();
    handlers.current.onSleep();
    const rec = recRef.current;
    if (rec) {
      commandBoundaryRecRef.current = rec;
      rec.stop();
    }
  }, [clearCommandTimer, finishWakeCommand]);

  const startRecognition = useCallback(() => {
    if (modeRef.current === null || recRef.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      modeRef.current = null;
      setHandsFree(false);
      setState('idle');
      handlers.current.onError('Is browser mein voice support nahi. Chrome ya Edge use karein — ya command type karein.');
      return;
    }

    const mode = modeRef.current;
    const rec = new Ctor();
    rec.lang = mode === 'wake' && recognitionFallbackRef.current ? 'en-IN' : lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (mode !== modeRef.current || rec !== recRef.current || commandBoundaryRecRef.current === rec) return;
      if (mode === 'manual') {
        let finalText = '';
        let live = '';
        for (let i = 0; i < e.results.length; i++) {
          const result = e.results[i]!;
          if (result.isFinal) finalText += `${result[0]!.transcript} `;
          else live += result[0]!.transcript;
        }
        finalRef.current = finalText;
        setInterim(`${finalText}${live}`.trim());
        return;
      }

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const transcript = result[0]!.transcript.trim();
        if (!transcript) continue;
        if (!result.isFinal) {
          const previousInterim = interimCommandRef.current;
          if (!wakeActiveRef.current) {
            const remainder = wakeWordRemainder(transcript);
            if (remainder === null) continue;
            wakeActiveRef.current = true;
            interimCommandRef.current = remainder;
            setWakeWordActive(true);
            setInterim('Noor suna — ab command bolain');
          } else {
            interimCommandRef.current = removeWakeWords(transcript);
            setInterim([commandRef.current, interimCommandRef.current].filter(Boolean).join(' '));
          }
          const sleepRemainder = completeWakeCommand(commandRef.current, transcript, previousInterim);
          if (sleepRemainder !== null) {
            finishSleepCommand(sleepRemainder);
            return;
          }
          continue;
        }
        let commandPart = '';
        if (!wakeActiveRef.current) {
          const remainder = wakeWordRemainder(transcript);
          if (remainder === null) continue;
          wakeActiveRef.current = true;
          setWakeWordActive(true);
          commandPart = remainder;
        } else {
          commandPart = removeWakeWords(transcript);
        }
        const combined = [commandRef.current, commandPart].filter(Boolean).join(' ');
        const sleepRemainder = completeWakeCommand(commandRef.current, commandPart, interimCommandRef.current)
          ?? sleepCommandRemainder(combined);
        if (sleepRemainder !== null) {
          finishSleepCommand(sleepRemainder);
          return;
        }
        if (commandPart) {
          commandRef.current = combined;
          interimCommandRef.current = '';
        }
        clearCommandTimer();
        if (commandRef.current.trim()) {
          setInterim(commandRef.current);
        } else {
          setInterim('Noor suna — ab command bolain');
        }
      }
      if (wakeActiveRef.current) {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]!;
          if (!result.isFinal && result[0]!.transcript.trim()) setInterim(commandRef.current ? `${commandRef.current} ${result[0]!.transcript}` : result[0]!.transcript);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted' || mode !== modeRef.current) return;
      if (mode === 'wake' && e.error === 'no-speech') return;
      if (mode === 'wake' && e.error === 'language-not-supported' && lang !== 'en-IN' && !recognitionFallbackRef.current) {
        recognitionFallbackRef.current = true;
        return;
      }
      errorRef.current = ERRORS[e.error] ?? 'Sorry, command samajh nahi aayi. Dobara bolain.';
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (commandBoundaryRecRef.current === rec) commandBoundaryRecRef.current = null;
      if (mode !== modeRef.current) return;
      if (mode === 'manual') {
        modeRef.current = null;
        const text = finalRef.current.trim();
        setState('idle');
        setInterim('');
        if (errorRef.current && !text) handlers.current.onError(errorRef.current);
        else if (!text) handlers.current.onError('Sorry, command samajh nahi aayi. Dobara bolain.');
        else handlers.current.onText(text);
        return;
      }

      if (wakeActiveRef.current) {
        const combined = [commandRef.current, interimCommandRef.current].filter(Boolean).join(' ').trim();
        const sleepRemainder = sleepCommandRemainder(combined);
        if (sleepRemainder !== null) {
          finishSleepCommand(sleepRemainder);
        } else {
          interimCommandRef.current = '';
          if (combined) commandRef.current = combined;
        }
      }

      if (errorRef.current) {
        modeRef.current = null;
        clearCommandTimer();
        setHandsFree(false);
        setWakeWordActive(false);
        setState('idle');
        handlers.current.onError(errorRef.current);
        errorRef.current = null;
        return;
      }
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        startRecognition();
      }, RESTART_DELAY_MS);
    };
    recRef.current = rec;
    try {
      rec.start();
      setState('listening');
    } catch {
      recRef.current = null;
      modeRef.current = null;
      if (mode === 'wake') {
        wakeActiveRef.current = false;
        commandRef.current = '';
        clearCommandTimer();
        setHandsFree(false);
        setWakeWordActive(false);
      }
      setState('idle');
      handlers.current.onError('Microphone shuru nahi ho saka. Dobara try karein.');
    }
  }, [clearCommandTimer, clearRestartTimer, finishSleepCommand, finishWakeCommand, lang]);

  const start = useCallback(() => {
    if (modeRef.current !== null) return;
    finalRef.current = '';
    errorRef.current = null;
    setInterim('');
    modeRef.current = 'manual';
    startRecognition();
  }, [startRecognition]);

  const startHandsFree = useCallback(() => {
    if (modeRef.current !== null) return;
    errorRef.current = null;
    recognitionFallbackRef.current = false;
    commandBoundaryRecRef.current = null;
    wakeActiveRef.current = false;
    commandRef.current = '';
    interimCommandRef.current = '';
    setInterim('');
    setWakeWordActive(false);
    modeRef.current = 'wake';
    setHandsFree(true);
    startRecognition();
  }, [startRecognition]);

  const stopHandsFree = useCallback(() => {
    if (modeRef.current !== 'wake') return;
    modeRef.current = null;
    wakeActiveRef.current = false;
    commandRef.current = '';
    interimCommandRef.current = '';
    commandBoundaryRecRef.current = null;
    clearCommandTimer();
    clearRestartTimer();
    const rec = recRef.current;
    recRef.current = null;
    rec?.abort();
    setHandsFree(false);
    setWakeWordActive(false);
    setInterim('');
    setState('idle');
  }, []);

  /** Release: stop push-to-talk; the final text arrives in onend. */
  const stop = useCallback(() => {
    if (modeRef.current !== 'manual') return;
    const rec = recRef.current;
    if (!rec) return;
    setState('processing');
    rec.stop();
  }, []);

  useEffect(() => () => {
    modeRef.current = null;
    clearCommandTimer();
    clearRestartTimer();
    recRef.current?.abort();
  }, []);

  return {
    state,
    interim,
    handsFree,
    wakeWordActive,
    start,
    stop,
    startHandsFree,
    stopHandsFree,
    supported: speechSupported(),
  };
}
