import type { AppState } from '../types'

/**
 * Reply language for the on-device engine: English, Simplified Chinese or Indonesian — the languages FundBun's
 * users actually write in. Detection is per message (script + a small Indonesian word list); a message with no
 * signal of its own ("¥300", "Birkin", "ok") keeps the language of the user's recent messages.
 */
export type Lang = 'en' | 'zh' | 'id'

export const LANGS: readonly Lang[] = ['en', 'zh', 'id']

const HAN_RE = /\p{Script=Han}/gu
const LATIN_WORD_RE = /[a-z]+/g

/** Words that only occur in Indonesian (never in an English finance question). */
const ID_STRONG = new Set([
  'saya', 'aku', 'gue', 'gua', 'berapa', 'bulan', 'tagihan', 'langganan', 'pindahkan', 'tabungan', 'uang', 'duit', 'nggak',
  'gak', 'enggak', 'tidak', 'gimana', 'bagaimana', 'kapan', 'sisa', 'saldo', 'batalkan', 'tolong', 'boleh', 'bisa', 'beli',
  'mampu', 'sudah', 'udah', 'belum', 'pengeluaran', 'kenapa', 'boros', 'hemat', 'kirim', 'bayar', 'makan', 'untuk', 'dari',
  'yang', 'kasih', 'lihat', 'tunjukkan', 'listrik', 'sewa', 'hari', 'minggu', 'lalu', 'depan', 'terima', 'kasih', 'makasih',
  'selamat', 'pagi', 'siang', 'malam', 'punya', 'gaji', 'anggaran', 'rekening', 'cicilan', 'pinjaman', 'investasi', 'saham',
  'abaikan', 'aturan', 'semua', 'uangku', 'aturanmu', 'habis', 'banget', 'dong', 'deh', 'sih', 'kok', 'apakah', 'jajan',
  'belanja', 'tahun', 'kemarin', 'impian', 'mau', 'ingin', 'pengen', 'nabung', 'menabung', 'simpan', 'tarik', 'ambil',
  'aja', 'saja', 'juga', 'masih', 'cek', 'periksa', 'lagi', 'ini', 'itu', 'kamu', 'anda', 'bantu', 'bantuan', 'manusia',
  'berhenti', 'batal', 'tadi', 'barusan', 'kembalikan', 'ganda', 'jatuh', 'tempo', 'penerima', 'sebaiknya', 'mana',
])
/** Words Indonesian shares with English or Chinese pinyin — count only alongside another signal. */
const ID_WEAK = new Set(['ke', 'di', 'dan', 'ada', 'apa', 'ya', 'target', 'budget', 'kos', 'hp', 'transfer', 'halo', 'hai'])

/** The language a message is written in, or null when it carries no signal (numbers, names, "ok"). */
export function detectLang(text: string): Lang | null {
  const t = String(text ?? '').normalize('NFKC').toLowerCase()
  const han = (t.match(HAN_RE) ?? []).length
  const words = t.match(LATIN_WORD_RE) ?? []
  if (han >= 2 && han > words.length) return 'zh'
  if (han >= 1 && words.length <= 1) return 'zh'
  let strong = 0
  let weak = 0
  for (const w of words) {
    if (ID_STRONG.has(w)) strong++
    else if (ID_WEAK.has(w)) weak++
  }
  if (strong >= 2 || (strong >= 1 && (weak >= 1 || words.length <= 3))) return 'id'
  if (strong === 1 && words.length >= 4) {
    // one Indonesian word in a longer English sentence ("send it to Budi dong") — English wins
    const english = words.filter((w) => EN_HINT.has(w)).length
    return english >= 2 ? 'en' : 'id'
  }
  // names alone ("QQ Music", "Birkin 25") say nothing about the language
  const english = words.filter((w) => EN_HINT.has(w)).length
  return english >= 1 ? 'en' : null
}

const EN_HINT = new Set([
  'the', 'my', 'is', 'are', 'how', 'what', 'whats', 'much', 'can', 'i', 'you', 'me', 'to', 'for', 'of', 'and', 'did', 'do',
  'show', 'move', 'pay', 'cancel', 'month', 'spend', 'spent', 'bill', 'bills', 'please', 'should', 'when', 'where', 'which',
  'any', 'hi', 'hello', 'hey', 'thanks', 'thank', 'yes', 'no', 'help', 'stop', 'undo', 'list', 'find', 'set', 'save', 'stash',
  'put', 'transfer', 'send', 'check', 'it', 'that', 'this', 'in', 'on', 'at', 'with', 'from', 'all', 'some', 'money', 'budget',
  'goal', 'goals', 'make', 'want', 'need', 'afford', 'buy', 'alert', 'remind', 'explain', 'compare', 'last', 'next', 'week',
  'balance', 'subscriptions', 'subscription', 'where', 'who', 'why', 'tell', 'give', 'get', 'see', 'go', 'ok', 'okay', 'sure',
])

/** The language to answer in: this message's, else the most recent user message that had one, else English. */
export function replyLang(text: string, state?: Pick<AppState, 'chat'> | null): Lang {
  const own = detectLang(text)
  if (own) return own
  const chat = state?.chat ?? []
  for (let i = chat.length - 1, seen = 0; i >= 0 && seen < 6; i--) {
    const m = chat[i]
    if (m.role !== 'user') continue
    seen++
    if (m.text === text && seen === 1) continue
    const lang = detectLang(m.text)
    if (lang) return lang
  }
  return 'en'
}
