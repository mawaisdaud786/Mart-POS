import { db } from './db';
import { useSession } from './session';
import { useLiveQuery } from './store';
import type { SpeechLang } from './voice/speech';

/** Each person's own choices (like the speech language for voice billing), kept on the server with their account. */
export function useVoiceLang(): [SpeechLang, (lang: SpeechLang) => void] {
  const { user } = useSession();
  const pref = useLiveQuery(() => (user ? db.prefs.get(`u:${user.id}`) : undefined), [user?.id]);
  const lang: SpeechLang = pref?.voiceLang ?? 'ur-PK';
  const set = (next: SpeechLang) => {
    if (user) void db.prefs.put({ id: `u:${user.id}`, voiceLang: next });
  };
  return [lang, set];
}
