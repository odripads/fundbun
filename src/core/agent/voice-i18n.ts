import { delayPhrase } from '../finance/copy'
import type { CategoryId, ISODate, YearMonth } from '../types'
import type { Lang } from './lang'
import type { Intent } from './nlu'

/**
 * Bun's voice in Chinese and Indonesian: hand-written templates for the intents people ask most (overview,
 * breakdown, bills, affordability, goals, subscriptions, the common actions, refusals, help and fallbacks) —
 * not machine translation. Same template syntax as voice.ts: `{key}` inserts a fact, `[ … ]` is dropped when a
 * fact inside it is missing. An intent with no localized variant that fits falls back to English.
 */

export interface I18nVariant {
  /** fact values that select this variant; null = the fact must be absent */
  when?: Record<string, string | string[] | null>
  t: string
}

const v = (t: string, when?: I18nVariant['when']): I18nVariant => ({ t, when })

type LocalLang = Exclude<Lang, 'en'>

// ───────────────────────────── labels ─────────────────────────────

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const MONTHS_ID_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "2026年10月" · "Oktober 2026" (short: "10月" · "Okt"); English is left to dates.monthLabel. */
export function monthName(month: YearMonth | string | undefined, lang: LocalLang, short = false): string | undefined {
  const m = /^(\d{4})-(\d{2})/.exec(month ?? '')
  if (!m) return undefined
  const year = Number(m[1])
  const idx = Number(m[2]) - 1
  if (idx < 0 || idx > 11) return undefined
  if (lang === 'zh') return short ? `${idx + 1}月` : `${year}年${idx + 1}月`
  return short ? MONTHS_ID_SHORT[idx] : `${MONTHS_ID[idx]} ${year}`
}

/** "10月28日" · "28 Okt". */
export function dateName(d: ISODate | string | undefined, lang: LocalLang): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '')
  if (!m) return undefined
  const idx = Number(m[2]) - 1
  const day = Number(m[3])
  if (idx < 0 || idx > 11) return undefined
  return lang === 'zh' ? `${idx + 1}月${day}日` : `${day} ${MONTHS_ID_SHORT[idx]}`
}

const CATEGORY_NAMES: Record<LocalLang, Partial<Record<CategoryId, string>>> = {
  zh: {
    housing: '房租住房', utilities: '水电燃气', phone_internet: '话费宽带', groceries: '买菜日用', dining: '外出吃饭', delivery: '外卖',
    coffee_tea: '咖啡奶茶', transport: '交通', shopping: '购物', subscriptions: '订阅会员', entertainment: '娱乐', health: '健康',
    education: '学习', travel: '旅行', personal_care: '个人护理', gifts: '礼物红包', insurance: '保险', fees: '手续费', other: '其他',
    income: '收入', transfer: '转账', savings: '梦想储蓄',
  },
  id: {
    housing: 'Sewa & tempat tinggal', utilities: 'Listrik & air', phone_internet: 'Pulsa & internet', groceries: 'Belanja dapur',
    dining: 'Makan di luar', delivery: 'Pesan antar makanan', coffee_tea: 'Kopi & teh susu', transport: 'Transportasi', shopping: 'Belanja',
    subscriptions: 'Langganan', entertainment: 'Hiburan', health: 'Kesehatan', education: 'Belajar', travel: 'Jalan-jalan',
    personal_care: 'Perawatan diri', gifts: 'Hadiah & angpao', insurance: 'Asuransi', fees: 'Biaya', other: 'Lainnya', income: 'Pemasukan',
    transfer: 'Transfer', savings: 'Tabungan impian',
  },
}

export function categoryName(category: string | undefined, lang: LocalLang): string | undefined {
  return category ? CATEGORY_NAMES[lang][category as CategoryId] : undefined
}

export function groupName(group: string | undefined, lang: Lang): string | undefined {
  if (group !== 'food') return undefined
  return lang === 'zh' ? '吃的' : lang === 'id' ? 'Makanan' : 'Food'
}

/** "A、B和C" · "A, B dan C" · "A, B and C". */
export function joinList(items: string[], lang: Lang): string {
  const list = items.filter(Boolean)
  if (list.length <= 1) return list[0] ?? ''
  if (lang === 'zh') return `${list.slice(0, -1).join('、')}和${list[list.length - 1]}`
  const and = lang === 'id' ? 'dan' : 'and'
  return list.length === 2 ? `${list[0]} ${and} ${list[1]}` : `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`
}

// ───────────────────────────── templates ─────────────────────────────

export const I18N_TEMPLATES: Record<LocalLang, Partial<Record<Intent, I18nVariant[]>>> = {
  zh: {
    greeting: [v('你好[，{name}]！[{headline} ]我是Bun，你的理财小助手。可以问我这个月花得怎么样、有哪些账单要交，或者某样东西买不买得起。')],
    help: [
      v('没问题——打开聊天右上角的⋯菜单，点“Talk to a human”。真人客服会收到一段简短的聊天摘要（绝不包含PIN或完整卡号），他们处理时你也可以先暂停我。', { focus: 'handoff' }),
      v('你的数据属于你：设置 → 隐私 → 导出，会把全部数据下载到这台设备上。我不会把它发给任何人。', { focus: 'export' }),
      v('目标和收入由你自己设置：设置 → 个人资料（不需要PIN）。[现在你的目标是{target}，][收入{income}。][在那里改成{amount}，我马上按新数字算。]', { focus: 'profile' }),
      v('我还不能在聊天里添加梦想——打开“梦想”→“添加梦想”[，把{label}加进心愿单][（{amount}）]，还可以配一张照片。', { focus: 'add_dream' }),
      v('我可以：看本月花销、按类别拆分、查交易、检查账单和订阅、判断买不买得起，还能在你自己的储蓄罐之间转钱——每次都要你确认。我从不给别人转账。想找真人，点⋯菜单里的“Talk to a human”。'),
    ],
    thanks: [v('不客气[，{name}]！随时找我。')],
    overview: [
      v('{account}的余额是{checking}。[储蓄罐：{pots}。]', { focus: 'balance' }),
      v('{month}的{target}目标已经用完了——超出{overBy}，还剩{daysLeft}天，所以这个月已经没有可以放心花的钱了。[从{nextMonth}起，每天约{nextMonthDaily}就能守住目标。]', { focus: 'safe_to_spend' }),
      v('{month}的目标还剩{remaining}[，剩下{daysLeft}天大约每天{perDayLeft}]。[今天可以放心花：{safeToSpend}。]', { focus: 'safe_to_spend' }),
      v('这个月你留住了收入的{savingsRate}（收入{income}，已花{spent}）。[其中{savedToGoals}存进了储蓄罐。]', { focus: 'savings_rate' }),
      v('这个月收入{income}，已花{spent}。', { focus: 'savings_rate' }),
      v('{month}你已花了{spent}，目标是{target}，超出了{delta}。[{goalName}会因此推迟{goalDelay}。]要不要看看哪些类别花得最多？', { status: 'over' }),
      v('{month}目前已花{spent}，目标{target}。[照这个速度，月底会花到约{projected}。][每天控制在{safeToSpend}以内就能回到正轨。]', { status: 'pace_over' }),
      v('做得好：{month}已花{spent}，目标{target}[，预计月底约{projected}]。[有望结余{delta}。][要把它存进{goalName}吗？]', { status: 'under' }),
      v('进展顺利：{month}已花{spent}，目标{target}[，还剩{remaining}][，大约每天{safeToSpend}]。', { status: 'on_track' }),
      v('{month}还没有消费记录。', { status: 'no_data' }),
      v('你已花了{spent}，目标是{target}[，还剩{remaining}]。'),
      v('暂时读不到你本月的情况，请稍后再试。'),
    ],
    breakdown: [
      v('{category}：{month}截至目前{categorySpent}，{prevMonth}同期{categoryPrev}（{change}）。[{prevMonth}全月：{categoryPrevFull}。]', { focus: 'compare', likeForLike: 'yes' }),
      v('{category}：{month}{categorySpent}，{prevMonth}{categoryPrev}（{change}）。', { focus: 'compare' }),
      v('{month}截至目前花了{total}，{prevMonth}同期是{prevToDate}（{change}）。[变化最大：{movers}。][{prevMonth}全月：{prevTotal}。]', { focus: 'compare', likeForLike: 'yes' }),
      v('{month}共花了{total}，{prevMonth}是{prevTotal}（{change}）。[变化最大：{movers}。]', { focus: 'compare' }),
      v('{category}最近{monthsCount}个月：{rangeList}[，合计{rangeTotal}]。'),
      v('{groupLabel}方面[{month}]共花了{groupSpent}：{groupParts}。[上个月：{groupPrev}。]'),
      v('{category}：[{month}]花了{categorySpent}[，共{count}笔][，是预算{categoryLimit}的{categoryPct}]。[上个月：{categoryPrev}。]'),
      v('[{month}共花了{total}。]花得最多的是{topCategory}，{topAmount}[（占{topShare}）]。'),
      v('这是你按类别的消费明细。'),
    ],
    bills: [
      v('{billName}：{amount}，{dueDate}到期[（{dueIn}）]。', { focus: 'due' }),
      v('未来{windowDays}天内到期：{windowList}。'),
      v('未来{windowDays}天内没有到期的账单。[下一笔：{nextBill}。]'),
      v('{dupMerchant}在{dupDate}重复扣了{dupAmount}——要我帮你申诉吗？需要用PIN确认。', { focus: 'duplicate' }),
      v('没有发现重复扣费。[下一笔到期：{nextBill}。]', { focus: 'duplicate' }),
      v('账单一切正常[，下一笔是{nextBill}]。', { count: '0' }),
      v('我检查了你的账单：{actionable}项需要留意[，{fyi}项供参考]。[{dupMerchant}重复扣了{dupAmount}。][{spikeBill}比平时高{spikePct}。][{hikeMerchant}涨价了。][下一笔到期：{nextBill}。]'),
      v('下一笔到期：{nextBill}。'),
      v('这是你的账单情况。'),
    ],
    afford: [
      v('{label}多少钱？告诉我价格，我帮你对照这个月的预算。', { stage: 'need_amount' }),
      v('多少钱？告诉我价格，我帮你算算。', { stage: 'need_amount' }),
      v('{label}（{amount}）：在预算内——买完这个月还剩{remainingAfter}。[相当于{hoursOfWork}小时的工作。]买不买，你决定。', { verdict: 'go' }),
      v('{label}（{amount}）勉强可以，但这个月只剩{remainingAfter}了。[{goalName}会推迟{goalDelay}。]要不再考虑一下？', { verdict: 'think' }),
      v('建议先缓一缓：{label}（{amount}）会让你超出目标{overTargetBy}。[{goalName}会再晚{goalDelay}。]', { verdict: 'skip' }),
      v('在预算内：买完这个月还剩{remainingAfter}。', { verdict: 'go' }),
      v('勉强可以，但这个月只剩{remainingAfter}了。要不再考虑一下？', { verdict: 'think' }),
      v('建议先缓一缓：这会让你超出目标{overTargetBy}。', { verdict: 'skip' }),
      v('这是这笔消费对本月的影响。'),
    ],
    goals: [
      v('如果每月存{monthly}，{goalName}大约还需{months}个月——{eta}左右。[比现在每月{currentRate}的速度快{sooner}个月。]', { focus: 'what_if' }),
      v('你还没有添加梦想。', { count: '0' }),
      v('{goalName}：已存{saved}，目标{price}（{pct}）。[按现在的速度，大约{eta}能达成。][其他梦想：{others}。]'),
      v('这是你的梦想进度。'),
    ],
    subscriptions: [
      v('我建议先取消：{recommend}。[一年能省{saving}。]点下面的按钮就能取消，需要用PIN确认。', { focus: 'recommend' }),
      v('没有明显该取消的：没有重复、涨价或多扣的订阅。[你的订阅一年{annualTotal}。]', { focus: 'recommend' }),
      v('你目前没有订阅。', { count: '0' }),
      v('你有{count}个订阅[，每月约{monthlyTotal}][（一年{annualTotal}）]。'),
      v('这是你的订阅和自动扣费。'),
    ],
    save_to_goal: [
      v('要往{goalName}存多少？', { stage: 'need_amount' }),
      v('要存多少？', { stage: 'need_amount' }),
      v('存到哪个梦想？[你有：{options}。]', { stage: 'need_target' }),
      v('这笔没办成。[原因：{reason}。]钱没有动。', { stage: 'blocked' }),
      v('完成——{amount}已存入{goalName}。[进度{newPct}！]', { stage: 'done' }),
      v('完成。', { stage: 'done' }),
      v('准备把{amount}存入{goalName}，请在卡片上点确认。'),
      v('请在下方卡片上确认。'),
    ],
    cancel_sub: [
      v('要取消哪个订阅？[你有：{options}。]', { stage: 'need_target' }),
      v('这个没办成。[原因：{reason}。]', { stage: 'blocked' }),
      v('已取消{merchant}。[一年省下{annualCost}。]', { stage: 'done' }),
      v('完成。', { stage: 'done' }),
      v('准备取消{merchant}[（每月{amount}）]。[一年能省{annualCost}。]需要用PIN确认。'),
      v('请在下方卡片上用PIN确认。'),
    ],
    pay_bill: [
      v('要交哪笔账单？[有：{options}。]', { stage: 'need_target' }),
      v('这笔账单没付成。[原因：{reason}。]我只付给已验证的收款方，而且每次都要你的PIN。', { stage: 'blocked' }),
      v('完成——{billName}[（{amount}）]已处理。[将于{scheduledFor}付款。]', { stage: 'done' }),
      v('完成。', { stage: 'done' }),
      v('准备支付{billName}[，{amount}][，收款方{payee}][，{dueDate}到期]。需要用PIN确认。'),
      v('请在下方卡片上用PIN确认。'),
    ],
    unknown: [
      v('我只管你的钱[，没法帮你看{topic}]。要不要看看今天还能放心花多少？', { focus: 'out_of_scope' }),
      v('{amount}是做什么用的？我可以把它存进梦想、看看这么大一笔消费合不合适，或者在单笔消费超过这个数时提醒你。', { focus: 'bare_amount' }),
      v('我没太听懂。你可以问我：这个月花得怎么样？有哪些账单要交？某样东西买得起吗？'),
    ],
  },
  id: {
    greeting: [v('Halo[ {name}]! [{headline} ]Aku Bun, teman keuanganmu. Tanya aja soal pengeluaran bulan ini, tagihan yang jatuh tempo, atau apakah sesuatu masih masuk budget.')],
    help: [
      v('Bisa — buka menu ⋯ di chat lalu ketuk “Talk to a human”. Petugas akan menerima ringkasan singkat obrolan kita (tanpa PIN atau nomor kartu lengkap), dan kamu bisa menjeda aku selama dibantu.', { focus: 'handoff' }),
      v('Datamu milikmu: Pengaturan → Privasi → Ekspor akan mengunduh semuanya ke perangkat ini. Aku tidak pernah mengirimnya ke siapa pun.', { focus: 'export' }),
      v('Target dan pemasukan kamu atur sendiri: Pengaturan → Profil (tanpa PIN).[ Sekarang targetmu {target}][ dan pemasukanmu {income}].[ Ubah ke {amount} di sana, nanti langsung aku pakai.]', { focus: 'profile' }),
      v('Aku belum bisa menambah impian dari chat — buka Impian → Tambah impian[ untuk memasukkan {label}][ ({amount})], boleh pakai foto juga.', { focus: 'add_dream' }),
      v('Aku bisa: cek pengeluaran bulan ini, rincian per kategori, cari transaksi, periksa tagihan dan langganan, cek apakah sesuatu terjangkau, dan memindahkan uang antar celenganmu sendiri — selalu dengan konfirmasimu. Aku tidak pernah mengirim uang ke orang lain. Mau bicara dengan petugas? Ketuk “Talk to a human” di menu ⋯.'),
    ],
    thanks: [v('Sama-sama[, {name}]! Kapan pun butuh, aku ada.')],
    overview: [
      v('Saldo {account}: {checking}.[ Di celengan: {pots}.]', { focus: 'balance' }),
      v('Target {target} untuk {month} sudah habis — lebih {overBy}, masih {daysLeft} hari lagi, jadi bulan ini tidak ada sisa yang aman dibelanjakan.[ Mulai {nextMonth}, sekitar {nextMonthDaily} per hari menjaga target.]', { focus: 'safe_to_spend' }),
      v('Sisa target {month}: {remaining}[ — sekitar {perDayLeft} per hari untuk {daysLeft} hari lagi].[ Aman dibelanjakan hari ini: {safeToSpend}.]', { focus: 'safe_to_spend' }),
      v('Bulan ini kamu menyisihkan {savingsRate} dari pemasukan ({income} masuk, {spent} keluar).[ {savedToGoals} di antaranya masuk ke celengan.]', { focus: 'savings_rate' }),
      v('Bulan ini pemasukanmu {income}, pengeluaran {spent}.', { focus: 'savings_rate' }),
      v('Di {month} kamu sudah belanja {spent} dari target {target} — lebih {delta}.[ {goalName} jadi mundur {goalDelay}.] Mau lihat kategori mana yang paling boros?', { status: 'over' }),
      v('Sejauh ini kamu sudah belanja {spent} dari {target}.[ Dengan kecepatan ini, akhir bulan kira-kira {projected}.][ Jaga di bawah {safeToSpend} per hari supaya kembali aman.]', { status: 'pace_over' }),
      v('Mantap: {spent} dari target {target} sejauh ini[, perkiraan akhir bulan {projected}].[ Kamu bisa hemat {delta}.][ Mau disimpan ke {goalName}?]', { status: 'under' }),
      v('Aman: {spent} dari {target} untuk {month}[, sisa {remaining}][ — sekitar {safeToSpend} per hari].', { status: 'on_track' }),
      v('Belum ada pengeluaran di {month}.', { status: 'no_data' }),
      v('Kamu sudah belanja {spent} dari target {target}[ — sisa {remaining}].'),
      v('Data bulan ini belum bisa dimuat. Coba lagi sebentar ya.'),
    ],
    breakdown: [
      v('{category}: {categorySpent} sejauh ini di {month}, dibanding {categoryPrev} pada titik yang sama di {prevMonth} ({change}).[ Sebulan penuh {prevMonth}: {categoryPrevFull}.]', { focus: 'compare', likeForLike: 'yes' }),
      v('{category}: {categorySpent} di {month}, dibanding {categoryPrev} di {prevMonth} ({change}).', { focus: 'compare' }),
      v('{month} sejauh ini: {total}, dibanding {prevToDate} pada titik yang sama di {prevMonth} ({change}).[ Perubahan terbesar: {movers}.][ Sebulan penuh {prevMonth}: {prevTotal}.]', { focus: 'compare', likeForLike: 'yes' }),
      v('{month}: {total}, dibanding {prevTotal} di {prevMonth} ({change}).[ Perubahan terbesar: {movers}.]', { focus: 'compare' }),
      v('{category} dalam {monthsCount} bulan terakhir: {rangeList}[ — total {rangeTotal}].'),
      v('{groupLabel}[ di {month}]: {groupSpent} — {groupParts}.[ Bulan lalu: {groupPrev}.]'),
      v('{category}: {categorySpent}[ di {month}][, {count} transaksi][ — {categoryPct} dari budget {categoryLimit}].[ Bulan lalu: {categoryPrev}.]'),
      v('[Di {month} kamu sudah belanja {total}. ]Kategori terbesar: {topCategory}, {topAmount}[ ({topShare})].'),
      v('Ini rincian pengeluaranmu per kategori.'),
    ],
    bills: [
      v('{billName}: {amount}, jatuh tempo {dueDate}[ ({dueIn})].', { focus: 'due' }),
      v('Jatuh tempo dalam {windowDays} hari ke depan: {windowList}.'),
      v('Tidak ada tagihan yang jatuh tempo dalam {windowDays} hari ke depan.[ Berikutnya: {nextBill}.]'),
      v('{dupMerchant} menagih {dupAmount} dua kali pada {dupDate} — mau aku ajukan sanggahan? Konfirmasi dengan PIN.', { focus: 'duplicate' }),
      v('Tidak ada tagihan ganda.[ Berikutnya: {nextBill}.]', { focus: 'duplicate' }),
      v('Tagihanmu aman[, yang berikutnya {nextBill}].', { count: '0' }),
      v('Aku sudah cek tagihanmu: {actionable} perlu diperhatikan[, {fyi} sekadar info].[ {dupMerchant} menagih {dupAmount} dua kali.][ {spikeBill} {spikePct} lebih tinggi dari biasanya.][ {hikeMerchant} naik harga.][ Berikutnya: {nextBill}.]'),
      v('Berikutnya: {nextBill}.'),
      v('Ini kondisi tagihanmu.'),
    ],
    afford: [
      v('Berapa harga {label}? Kasih tahu harganya, nanti aku cek dengan budget bulan ini.', { stage: 'need_amount' }),
      v('Berapa harganya? Kasih tahu, nanti aku hitung.', { stage: 'need_amount' }),
      v('{label} seharga {amount}: masih masuk budget — sisa {remainingAfter} untuk bulan ini.[ Itu setara {hoursOfWork} jam kerja.] Keputusan di tanganmu.', { verdict: 'go' }),
      v('{label} seharga {amount} masih bisa, tapi pas-pasan — sisa {remainingAfter} untuk sisa bulan.[ {goalName} mundur {goalDelay}.] Mungkin dipikir dulu?', { verdict: 'think' }),
      v('Mending tahan dulu: {label} seharga {amount} bikin kamu lewat target {overTargetBy}.[ {goalName} jadi mundur {goalDelay}.]', { verdict: 'skip' }),
      v('Masih masuk budget: sisa {remainingAfter} bulan ini.', { verdict: 'go' }),
      v('Masih bisa, tapi pas-pasan — sisa {remainingAfter}. Mungkin dipikir dulu?', { verdict: 'think' }),
      v('Mending tahan dulu: ini bikin kamu lewat target {overTargetBy}.', { verdict: 'skip' }),
      v('Ini dampak pembelian itu ke bulanmu.'),
    ],
    goals: [
      v('Kalau menabung {monthly} per bulan, {goalName} tercapai sekitar {months} bulan lagi — kira-kira {eta}.[ Itu {sooner} bulan lebih cepat dari kecepatanmu sekarang ({currentRate} per bulan).]', { focus: 'what_if' }),
      v('Kamu belum menambahkan impian.', { count: '0' }),
      v('{goalName}: {saved} dari {price} ({pct}).[ Dengan kecepatan sekarang, tercapai sekitar {eta}.][ Impian lain: {others}.]'),
      v('Ini progres impianmu.'),
    ],
    subscriptions: [
      v('Saranku, batalkan dulu: {recommend}.[ Hemat {saving} setahun.] Ketuk tombol di bawah untuk membatalkan — konfirmasi dengan PIN.', { focus: 'recommend' }),
      v('Tidak ada yang jelas perlu dibatalkan: tidak ada langganan dobel, naik harga, atau tertagih dua kali.[ Total langgananmu {annualTotal} setahun.]', { focus: 'recommend' }),
      v('Kamu belum punya langganan.', { count: '0' }),
      v('Kamu punya {count} langganan[, sekitar {monthlyTotal} per bulan][ ({annualTotal} setahun)].'),
      v('Ini langganan dan tagihan rutinmu.'),
    ],
    save_to_goal: [
      v('Mau pindahkan berapa ke {goalName}?', { stage: 'need_amount' }),
      v('Mau pindahkan berapa?', { stage: 'need_amount' }),
      v('Ke impian yang mana?[ Pilihannya: {options}.]', { stage: 'need_target' }),
      v('Belum bisa dilakukan.[ {reason}.] Tidak ada uang yang pindah.', { stage: 'blocked' }),
      v('Beres — {amount} sudah masuk ke {goalName}.[ Sudah {newPct}!]', { stage: 'done' }),
      v('Beres.', { stage: 'done' }),
      v('Siap memindahkan {amount} ke {goalName}. Cek kartunya lalu ketuk konfirmasi.'),
      v('Cek kartu di bawah untuk konfirmasi.'),
    ],
    cancel_sub: [
      v('Langganan mana yang mau dibatalkan?[ Pilihannya: {options}.]', { stage: 'need_target' }),
      v('Belum bisa dilakukan.[ {reason}.]', { stage: 'blocked' }),
      v('{merchant} sudah dibatalkan.[ Hemat {annualCost} setahun.]', { stage: 'done' }),
      v('Beres.', { stage: 'done' }),
      v('Siap membatalkan {merchant}[ ({amount} per bulan)].[ Hemat {annualCost} setahun.] Konfirmasi dengan PIN.'),
      v('Konfirmasi dengan PIN di kartu bawah.'),
    ],
    pay_bill: [
      v('Tagihan mana yang mau dibayar?[ Ada: {options}.]', { stage: 'need_target' }),
      v('Tagihan itu belum bisa dibayar.[ {reason}.] Aku hanya membayar ke penerima terverifikasi, selalu dengan PIN-mu.', { stage: 'blocked' }),
      v('Beres — {billName}[ ({amount})] sudah diurus.[ Dibayar pada {scheduledFor}.]', { stage: 'done' }),
      v('Beres.', { stage: 'done' }),
      v('Siap membayar {billName}[ — {amount}][ ke {payee}][, jatuh tempo {dueDate}]. Konfirmasi dengan PIN.'),
      v('Konfirmasi dengan PIN di kartu bawah.'),
    ],
    unknown: [
      v('Aku cuma mengurus uangmu[, jadi tidak bisa bantu soal {topic}]. Mau lihat berapa yang aman dibelanjakan hari ini?', { focus: 'out_of_scope' }),
      v('{amount} itu untuk apa? Aku bisa memindahkannya ke impian, mengecek apakah belanja sebesar itu masih masuk budget, atau mengingatkanmu kalau sekali belanja lebih dari itu.', { focus: 'bare_amount' }),
      v('Aku belum paham. Coba tanya: bulan ini aku boros nggak? Tagihan apa saja yang jatuh tempo? Aku mampu beli ini nggak?'),
    ],
  },
}

// ───────────────────────────── refusals ─────────────────────────────

export interface LocalRefusal {
  title: string
  text: string
}

/** Refusals for every refusal intent plus the instruction-override reply ('override'). */
export const REFUSALS_I18N: Record<LocalLang, Record<string, LocalRefusal>> = {
  zh: {
    external_transfer: { title: '只有你本人能给别人转账', text: '给别人转账只能由你本人在银行App里操作。我可以在你自己的储蓄罐之间转钱，或者用你的PIN支付已验证的账单。' },
    add_payee: { title: '新收款人只能由你添加', text: '添加新收款人只能由你本人在银行App里完成——我只会付款给你已验证的收款方。我可以帮你看看即将到期的账单，或者设置提醒。' },
    invest: { title: '不提供投资建议', text: '我不能帮你买投资产品，也不能给个性化的投资建议——我不是持牌顾问。我可以帮你存钱：把钱存进梦想储蓄罐，或者看看每月能存多少。' },
    credit: { title: '不办理借贷', text: '我不能帮你申请贷款、信用卡或提高额度。我可以帮你看看什么在预算之内，或者设一个消费提醒。' },
    change_permissions: { title: '只有你能改我的权限', text: '只有你本人能改变我的权限——在设置 → 权限里，用你的PIN。收紧限额或暂停我随时一键完成，不需要PIN。' },
    sensitive_request: { title: '我会保守秘密', text: '我从不透露你的PIN、密码或完整的卡号和证件号，也从不把你的数据发给别人。你可以在App里看打码后的账号（后4位）或摘要。' },
    override: { title: '安全规则不会关闭', text: '我的安全规则不能通过聊天关闭。钱只能在你自己的储蓄罐之间移动，受限额约束，而且要你在卡片上点确认。要不要往梦想里存点钱？' },
  },
  id: {
    external_transfer: { title: 'Hanya kamu yang bisa kirim uang ke orang lain', text: 'Kirim uang ke orang lain hanya bisa kamu lakukan sendiri di aplikasi bank. Aku bisa memindahkan uang antar celenganmu sendiri, atau membayar tagihan terverifikasi dengan PIN-mu.' },
    add_payee: { title: 'Penerima baru hanya bisa kamu tambahkan', text: 'Menambah penerima baru hanya bisa kamu lakukan sendiri di aplikasi bank — aku cuma membayar ke penerima yang sudah kamu verifikasi. Aku bisa tunjukkan tagihan yang akan datang atau pasang pengingat.' },
    invest: { title: 'Tidak ada saran investasi', text: 'Aku tidak bisa membeli investasi atau memberi saran investasi pribadi — aku bukan penasihat berlisensi. Aku bisa bantu menabung: simpan uang ke celengan impian, atau lihat berapa yang bisa disisihkan tiap bulan.' },
    credit: { title: 'Tidak mengajukan kredit', text: 'Aku tidak bisa mengajukan pinjaman, kartu kredit, atau kenaikan limit. Aku bisa cek apa yang masih masuk budget, atau pasang pengingat sebelum belanja besar.' },
    change_permissions: { title: 'Hanya kamu yang bisa mengubah izinku', text: 'Hanya kamu yang bisa mengubah apa yang boleh aku lakukan — di Pengaturan → Izin, dengan PIN. Memperketat batas atau menjeda aku selalu cukup satu ketukan, tanpa PIN.' },
    sensitive_request: { title: 'Rahasiamu aman', text: 'Aku tidak pernah membuka PIN, kata sandi, atau nomor kartu dan identitas lengkapmu, dan tidak pernah mengirim datamu ke orang lain. Kamu bisa lihat nomor yang disamarkan (4 digit terakhir) atau ringkasan di aplikasi.' },
    override: { title: 'Aturan keamanan tetap jalan', text: 'Aturan keamananku tidak bisa dimatikan lewat chat. Uang hanya bisa pindah antar celenganmu sendiri, sesuai batas, dan dengan ketukanmu di kartu. Mau menabung ke impian?' },
  },
}

// ───────────────────────────── one-liners ─────────────────────────────

/** Short engine lines (notes, warnings, undo, disambiguation) in every language; same `{key}` / `[ … ]` syntax. */
export const LINES: Record<string, Record<Lang, string>> = {
  overrideNote: {
    en: 'That message tried to switch off my safety rules — they stay on.',
    zh: '这条消息试图关闭我的安全规则——它们不会关闭。',
    id: 'Pesan itu mencoba mematikan aturan keamananku — aturannya tetap jalan.',
  },
  overrideNoticeTitle: { en: 'Safety rules stay on', zh: '安全规则保持开启', id: 'Aturan keamanan tetap jalan' },
  overrideNoticeText: {
    en: 'Your message asked me to ignore my rules. I don’t: money only moves between your own pots, within your caps, with your tap.',
    zh: '你的消息要求我忽略规则。我不会：钱只在你自己的储蓄罐之间移动，受限额约束，并需要你点确认。',
    id: 'Pesanmu memintaku mengabaikan aturan. Aku tidak melakukannya: uang hanya pindah antar celenganmu sendiri, sesuai batas, dengan ketukanmu.',
  },
  pinWarning: {
    en: 'Please never type your PIN in chat — I only ask for it on the action card’s keypad. I didn’t keep it: it’s masked in our chat. If someone else might have seen it, change it in Settings → Security.',
    zh: '请不要在聊天里输入PIN——我只会在操作卡片的键盘上请你输入。我没有保存它：聊天记录里已经打码。如果担心被别人看到，请在设置 → 安全里修改PIN。',
    id: 'Jangan ketik PIN di chat ya — aku hanya meminta PIN lewat keypad di kartu aksi. PIN-nya tidak disimpan: sudah disamarkan di chat. Kalau khawatir ada yang melihat, ganti di Pengaturan → Keamanan.',
  },
  pinNoticeTitle: { en: 'Keep your PIN off the chat', zh: '不要在聊天里发PIN', id: 'Jangan kirim PIN lewat chat' },
  pinNoticeText: {
    en: 'Your PIN was masked before anything was stored or sent. Approvals only happen on the card keypad.',
    zh: '你的PIN在保存或发送前已被打码。确认只会在卡片键盘上进行。',
    id: 'PIN-mu disamarkan sebelum apa pun disimpan atau dikirim. Persetujuan hanya lewat keypad di kartu.',
  },
  pinApproveHint: {
    en: 'To approve “{title}”, tap Approve on the card and enter your PIN there.',
    zh: '要确认“{title}”，请点卡片上的批准，在那里输入PIN。',
    id: 'Untuk menyetujui “{title}”, ketuk Setujui di kartu dan masukkan PIN di sana.',
  },
  undoMoney: { en: 'Undone — {amount} is back where it was.', zh: '已撤销——{amount}已退回原处。', id: 'Dibatalkan — {amount} sudah kembali ke tempat semula.' },
  undoOther: { en: 'Undone — “{title}” was reverted.', zh: '已撤销——“{title}”已恢复原样。', id: 'Dibatalkan — “{title}” sudah dikembalikan.' },
  undoNothing: {
    en: 'There’s nothing to undo — nothing has run in this chat that I could reverse.',
    zh: '没有可以撤销的操作——这段聊天里还没有执行过可撤销的操作。',
    id: 'Tidak ada yang bisa dibatalkan — belum ada aksi di chat ini yang bisa dikembalikan.',
  },
  undoPending: {
    en: 'Dropped — “{title}” never ran, so nothing changed.',
    zh: '已放弃——“{title}”还没有执行，所以什么都没变。',
    id: 'Dibatalkan — “{title}” belum dijalankan, jadi tidak ada yang berubah.',
  },
  undoAlready: { en: '“{title}” was already undone.', zh: '“{title}”已经撤销过了。', id: '“{title}” sudah dibatalkan sebelumnya.' },
  undoExpired: {
    en: 'The {seconds}-second undo window for “{title}” has passed, so I can’t reverse it automatically.[ I can move it back instead: say “take {amount} out of {goal}”.]',
    zh: '“{title}”的{seconds}秒撤销时间已过，没法自动撤回。[我可以帮你转回来：说“从{goal}取出{amount}”。]',
    id: 'Waktu {seconds} detik untuk membatalkan “{title}” sudah lewat, jadi tidak bisa otomatis.[ Aku bisa memindahkannya kembali: bilang “ambil {amount} dari {goal}”.]',
  },
  undoFinal: {
    en: '“{title}” can’t be undone from FundBun — payments, cancellations and disputes are final once they run.[ If something was wrong, I can help you dispute it.]',
    zh: '“{title}”无法在FundBun里撤销——付款、取消和申诉执行后就不可逆。[如果有问题，我可以帮你申诉。]',
    id: '“{title}” tidak bisa dibatalkan dari FundBun — pembayaran, pembatalan, dan sanggahan bersifat final.[ Kalau ada yang salah, aku bisa bantu ajukan sanggahan.]',
  },
  disambiguate: {
    en: 'Just to be sure — did you mean “{a}” or “{b}”?',
    zh: '想确认一下——你是想“{a}”，还是“{b}”？',
    id: 'Biar pasti — maksudmu “{a}” atau “{b}”?',
  },
  reaskChoices: {
    en: 'Sorry, I didn’t catch which one. Pick one below — or say “cancel”.',
    zh: '抱歉，没听清是哪一个。请从下面选一个，或者说“取消”。',
    id: 'Maaf, aku belum tangkap yang mana. Pilih salah satu di bawah — atau bilang “batal”.',
  },
  reaskOpen: {
    en: 'Sorry, I didn’t catch that. Could you say it another way — or say “cancel”?',
    zh: '抱歉，没听懂。能换个说法吗？或者说“取消”。',
    id: 'Maaf, aku belum paham. Bisa pakai kalimat lain — atau bilang “batal”?',
  },
  moveAllNote: {
    en: 'I can only move money between your own pots — at most {cap} per move — and I always leave enough in checking for upcoming bills.',
    zh: '我只能在你自己的储蓄罐之间转钱——每次最多{cap}，而且会在账户里留足即将到期的账单。',
    id: 'Aku hanya bisa memindahkan uang antar celenganmu sendiri — paling banyak {cap} sekali pindah — dan selalu menyisakan cukup untuk tagihan yang akan datang.',
  },
  repeatNote: {
    en: 'I can’t schedule repeating transfers, so this is a one-off {amount} — ask again whenever you like.',
    zh: '我不能设置定期转账，所以这次是一次性的{amount}——需要时再跟我说就行。',
    id: 'Aku tidak bisa menjadwalkan transfer berulang, jadi ini sekali saja {amount} — minta lagi kapan pun kamu mau.',
  },
  billAmountNote: {
    en: 'Your {bill} bill is {due} — I can only pay the billed amount, so the card is for {due}.',
    zh: '你的{bill}账单是{due}——我只能按账单金额支付，所以卡片上是{due}。',
    id: 'Tagihan {bill} kamu {due} — aku hanya bisa membayar sesuai tagihan, jadi kartunya untuk {due}.',
  },
  billAmountKeep: {
    en: 'Bills are paid in full: {bill} is {due}, and that’s what the card above will pay. Nothing else changed.',
    zh: '账单按全额支付：{bill}是{due}，上面的卡片就是付这个金额。其他没变。',
    id: 'Tagihan dibayar penuh: {bill} sebesar {due}, dan itu yang akan dibayar kartu di atas. Tidak ada yang lain berubah.',
  },
  brandMissing: {
    en: 'You don’t have {brand}[ — did you mean {merchant}]?',
    zh: '你没有订阅{brand}[——你是指{merchant}吗]？',
    id: 'Kamu tidak berlangganan {brand}[ — maksudmu {merchant}]?',
  },
  othersBill: {
    en: 'I can only pay your own bills, to payees you’ve verified — {person}’s bill isn’t one I can pay.',
    zh: '我只能用你已验证的收款方支付你自己的账单——{person}的账单我不能付。',
    id: 'Aku hanya bisa membayar tagihanmu sendiri ke penerima terverifikasi — tagihan {person} tidak bisa aku bayar.',
  },
  stashNote: {
    en: '{amount} gets {goal} to {pct}[ — the other {rest} of your {surplus} surplus stays yours to decide].',
    zh: '存{amount}能让{goal}达到{pct}[——{surplus}结余里剩下的{rest}由你决定]。',
    id: '{amount} membuat {goal} mencapai {pct}[ — sisa {rest} dari kelebihan {surplus} tetap terserah kamu].',
  },
  correctedExecuted: {
    en: 'That one already went through. Say “undo that” within {seconds} seconds (or tap Undo on its card), then tell me the new amount.',
    zh: '那笔已经执行了。在{seconds}秒内说“撤销”（或点卡片上的撤销），再告诉我新的金额。',
    id: 'Yang itu sudah jalan. Bilang “batalkan yang tadi” dalam {seconds} detik (atau ketuk Undo di kartunya), lalu sebutkan jumlah barunya.',
  },
  corrected: { en: 'Got it — I changed it.', zh: '好的，已经改好了。', id: 'Siap — sudah aku ubah.' },
  correctedPending: { en: 'Got it — I dropped the earlier proposal.', zh: '好的，之前的提议已作废。', id: 'Siap — usulan sebelumnya aku batalkan.' },
  capNote: {
    en: 'You’re already at {spent} on {category} this month, so treat {cap} as next month’s line.',
    zh: '这个月{category}已经花了{spent}，所以{cap}就当作下个月的上限吧。',
    id: 'Bulan ini {category} sudah {spent}, jadi anggap {cap} sebagai batas bulan depan.',
  },
  recatDone: {
    en: 'Done — {merchant}’s {amount} charge on {date} now counts as {to} (it was {from}). Future {merchant} charges go there too.',
    zh: '好了——{merchant}在{date}的{amount}已改为{to}（原来是{from}）。以后{merchant}的消费也会归到这里。',
    id: 'Beres — tagihan {merchant} {amount} pada {date} sekarang masuk {to} (sebelumnya {from}). Transaksi {merchant} berikutnya juga masuk ke sana.',
  },
  recatConfirm: {
    en: 'Ready to file {merchant}’s {amount} charge on {date} under {to} (it’s {from} now). Tap to confirm.',
    zh: '准备把{merchant}在{date}的{amount}改为{to}（现在是{from}），请点确认。',
    id: 'Siap memindahkan tagihan {merchant} {amount} pada {date} ke {to} (sekarang {from}). Ketuk untuk konfirmasi.',
  },
  recatSame: {
    en: '{merchant}’s {amount} charge on {date} is already filed as {to}.',
    zh: '{merchant}在{date}的{amount}已经是{to}了。',
    id: 'Tagihan {merchant} {amount} pada {date} sudah masuk {to}.',
  },
  recatBlocked: {
    en: 'I couldn’t recategorise that.[ {reason}.] Nothing was changed.',
    zh: '这笔没能改类别。[原因：{reason}。]什么都没变。',
    id: 'Kategorinya belum bisa diubah.[ {reason}.] Tidak ada yang berubah.',
  },
  handoffNoticeTitle: { en: 'Talk to a human', zh: '联系真人客服', id: 'Bicara dengan petugas' },
  handoffNoticeText: {
    en: 'Open the ⋯ menu → “Talk to a human”. You can pause Bun while a person helps.',
    zh: '打开⋯菜单 →“Talk to a human”。真人处理时可以暂停Bun。',
    id: 'Buka menu ⋯ → “Talk to a human”. Kamu bisa menjeda Bun selama dibantu petugas.',
  },
  approveFromCard: {
    en: 'To keep your money safe I never approve things from chat — tap Approve on the card[{pin}]. That way nobody can approve on your behalf with a look-alike message.',
    zh: '为了你的资金安全，我从不在聊天里批准操作——请点卡片上的批准[{pin}]。这样别人就无法用相似的消息替你批准。',
    id: 'Demi keamanan uangmu, aku tidak pernah menyetujui dari chat — ketuk Setujui di kartu[{pin}]. Dengan begitu tidak ada yang bisa menyetujui atas namamu lewat pesan tiruan.',
  },
  pinSuffix: { en: ' and enter your PIN', zh: '并输入PIN', id: ' lalu masukkan PIN' },
}

// ───────────────────────────── chips ─────────────────────────────

/** Quick replies in Chinese / Indonesian — each one is understood by the NLU (tested). */
export const CHIPS_I18N: Record<LocalLang, Partial<Record<Intent, string[]>>> = {
  zh: {
    greeting: ['这个月花得怎么样？', '账单什么时候到期', '我的目标进度'],
    help: ['这个月花得怎么样？', '我的钱都花哪了', '账单什么时候到期', '我有哪些订阅'],
    thanks: ['这个月花得怎么样？', '我的目标进度', '有什么省钱建议'],
    overview: ['我的钱都花哪了', '有什么省钱建议', '我的目标进度', '账单什么时候到期'],
    breakdown: ['有什么省钱建议', '这个月花得怎么样？', '我的目标进度'],
    bills: ['我有哪些订阅', '这个月花得怎么样？', '有什么省钱建议'],
    afford: ['我的目标进度', '这个月花得怎么样？', '还能花多少'],
    goals: ['这个月花得怎么样？', '有什么省钱建议', '还能花多少'],
    subscriptions: ['账单什么时候到期', '这个月花得怎么样？', '我的目标进度'],
    unknown: ['这个月花得怎么样？', '我的钱都花哪了', '账单什么时候到期', '你能做什么'],
    sensitive_request: ['你能做什么', '这个月花得怎么样？', '账单什么时候到期'],
    external_transfer: ['我的目标进度', '这个月花得怎么样？', '账单什么时候到期'],
    save_to_goal: ['我的目标进度', '这个月花得怎么样？', '还能花多少'],
    change_permissions: ['你能做什么', '这个月花得怎么样？', '我的目标进度'],
    invest: ['我的目标进度', '有什么省钱建议', '这个月花得怎么样？'],
    credit: ['这个月花得怎么样？', '帮我做个预算', '我的目标进度'],
    add_payee: ['账单什么时候到期', '这个月花得怎么样？', '我的目标进度'],
    cancel_sub: ['我有哪些订阅', '我的目标进度', '这个月花得怎么样？'],
    pay_bill: ['账单什么时候到期', '有没有重复扣费', '这个月花得怎么样？'],
  },
  id: {
    greeting: ['Bulan ini aku boros nggak?', 'Tagihan apa saja yang jatuh tempo?', 'Progres tabungan aku'],
    help: ['Bulan ini aku boros nggak?', 'Pengeluaran per kategori', 'Tagihan apa saja yang jatuh tempo?', 'Langganan aku apa aja'],
    thanks: ['Bulan ini aku boros nggak?', 'Progres tabungan aku', 'Kasih tips hemat dong'],
    overview: ['Pengeluaran per kategori', 'Kasih tips hemat dong', 'Progres tabungan aku', 'Tagihan apa saja yang jatuh tempo?'],
    breakdown: ['Kasih tips hemat dong', 'Bulan ini aku boros nggak?', 'Progres tabungan aku'],
    bills: ['Langganan aku apa aja', 'Bulan ini aku boros nggak?', 'Kasih tips hemat dong'],
    afford: ['Progres tabungan aku', 'Bulan ini aku boros nggak?', 'Sisa budget bulan ini berapa'],
    goals: ['Bulan ini aku boros nggak?', 'Kasih tips hemat dong', 'Sisa budget bulan ini berapa'],
    subscriptions: ['Tagihan apa saja yang jatuh tempo?', 'Bulan ini aku boros nggak?', 'Progres tabungan aku'],
    unknown: ['Bulan ini aku boros nggak?', 'Pengeluaran per kategori', 'Tagihan apa saja yang jatuh tempo?', 'Kamu bisa apa'],
    sensitive_request: ['Kamu bisa apa', 'Bulan ini aku boros nggak?', 'Tagihan apa saja yang jatuh tempo?'],
    external_transfer: ['Progres tabungan aku', 'Bulan ini aku boros nggak?', 'Tagihan apa saja yang jatuh tempo?'],
    save_to_goal: ['Progres tabungan aku', 'Bulan ini aku boros nggak?', 'Sisa budget bulan ini berapa'],
    change_permissions: ['Kamu bisa apa', 'Bulan ini aku boros nggak?', 'Progres tabungan aku'],
    invest: ['Progres tabungan aku', 'Kasih tips hemat dong', 'Bulan ini aku boros nggak?'],
    credit: ['Bulan ini aku boros nggak?', 'Buatkan anggaran bulanan', 'Progres tabungan aku'],
    add_payee: ['Tagihan apa saja yang jatuh tempo?', 'Bulan ini aku boros nggak?', 'Progres tabungan aku'],
    cancel_sub: ['Langganan aku apa aja', 'Progres tabungan aku', 'Bulan ini aku boros nggak?'],
    pay_bill: ['Tagihan apa saja yang jatuh tempo?', 'Ada tagihan ganda?', 'Bulan ini aku boros nggak?'],
  },
}

/** Words for "in N days" / "overdue by N days" in a bill line. */
/**
 * A goal delay in the reply language, on the one unit convention every surface shares (finance/copy.durationText):
 * days under two weeks, then weeks, then months. 35 → "about 5 weeks" · "约5周" · "sekitar 5 minggu"; 9 → "9 days".
 */
export function delayIn(days: number, lang: Lang): string {
  const d = Math.max(1, Math.round(days))
  if (lang === 'en') return delayPhrase(d)
  const [n, unit] = d < 14 ? [d, 0] : d < 60 ? [Math.round(d / 7), 1] : [Math.round(d / 30.4), 2]
  if (lang === 'zh') return `${d < 14 ? '' : '约'}${n}${['天', '周', '个月'][unit]}`
  return `${d < 14 ? '' : 'sekitar '}${n} ${['hari', 'minggu', 'bulan'][unit]}`
}

export function dueInPhrase(days: number, lang: Lang): string {
  if (lang === 'zh') return days === 0 ? '今天到期' : days > 0 ? `还有${days}天` : `已逾期${-days}天`
  if (lang === 'id') return days === 0 ? 'hari ini' : days > 0 ? `${days} hari lagi` : `telat ${-days} hari`
  return days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} overdue`
}

/** Out-of-scope topics we can name back to the user ("I can't help with the weather"). */
export const TOPICS: [RegExp, Record<Lang, string>][] = [
  [/weather|forecast|rain|天气|下雨|cuaca|hujan/i, { en: 'the weather', zh: '天气', id: 'cuaca' }],
  [/joke|funny|笑话|lelucon|lucu/i, { en: 'jokes', zh: '讲笑话', id: 'lelucon' }],
  [/football|soccer|world cup|nba|score|match|足球|比赛|世界杯|sepak ?bola|piala dunia/i, { en: 'sports scores', zh: '体育比分', id: 'skor olahraga' }],
  [/recipe|cook|dumpling|饺子|菜谱|做饭|resep|masak/i, { en: 'recipes', zh: '菜谱', id: 'resep' }],
  [/translat|翻译|terjemah/i, { en: 'translations', zh: '翻译', id: 'terjemahan' }],
  [/news|新闻|berita/i, { en: 'the news', zh: '新闻', id: 'berita' }],
  [/poem|story|诗|故事|puisi|cerita/i, { en: 'stories and poems', zh: '写诗讲故事', id: 'puisi dan cerita' }],
  [/movie|film|music|song|电影|音乐|lagu/i, { en: 'films and music', zh: '电影音乐', id: 'film dan musik' }],
  [/time is it|几点|jam berapa/i, { en: 'the time', zh: '时间', id: 'jam' }],
]

export function topicOf(text: string, lang: Lang): string | undefined {
  for (const [re, names] of TOPICS) if (re.test(text)) return names[lang]
  return undefined
}
