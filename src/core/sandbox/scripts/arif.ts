import { toMinor as y } from '../../money'
import { renderBillText } from '../bill-text'
import type { BillSeriesSpec, MerchantSpec, PersonaScript } from '../script-types'
import { fixedQuote } from '../tariffs'

/**
 * Arif Nasution, 23 · Indonesian master's student in Shenzhen — the UNDER story (CONTRACT §4).
 * October-to-date spending ≈ ¥2,250; projected month-end ≈ ¥2,900–3,000 against a ¥3,600 target.
 */

const canteen = (items: readonly string[], median: number, min: number, max: number): MerchantSpec => ({
  merchant: 'Campus Canteen',
  description: '学生食堂 CAMPUS CANTEEN 校园卡 {item}',
  items,
  category: 'dining',
  channel: 'card',
  price: { median: y(median), sigma: 0.2, min: y(min), max: y(max), step: 50 },
  repeatable: true,
})

const lamian: MerchantSpec = {
  merchant: 'Lanzhou Beef Noodles',
  description: '兰州牛肉拉面 清真 HALAL NOODLES {item}',
  items: ['牛肉拉面', '炒刀削面', '大盘鸡拌面'],
  category: 'dining',
  channel: 'wechat_pay',
  price: { median: y(22), sigma: 0.15, min: y(16), max: y(32) },
}
const walmart: MerchantSpec = {
  merchant: 'Walmart',
  description: '沃尔玛 WALMART 南山店',
  category: 'groceries',
  channel: 'alipay',
  price: { median: y(58), sigma: 0.35, min: y(25), max: y(130), step: 1 },
}
const meiyijia: MerchantSpec = {
  merchant: 'Meiyijia',
  description: '美宜佳便利店 MEIYIJIA {item}',
  items: ['方便面 instant noodles', '水果', '牛奶面包', '日用品'],
  category: 'groceries',
  channel: 'wechat_pay',
  price: { median: y(14), sigma: 0.4, min: y(5), max: y(35), step: 1 },
}
const mixue: MerchantSpec = {
  merchant: 'Mixue',
  description: '蜜雪冰城 MIXUE {item}',
  items: ['冰鲜柠檬水', '珍珠奶茶', '满杯百香果'],
  category: 'coffee_tea',
  channel: 'wechat_pay',
  price: { pick: [400, 500, 600, 700, 800, 1000] },
  weight: 3,
}
const coco: MerchantSpec = {
  merchant: 'CoCo',
  description: '都可 CoCo {item}',
  items: ['珍珠奶茶', '百香果双响炮', '鲜芋青稞牛奶'],
  category: 'coffee_tea',
  channel: 'wechat_pay',
  price: { median: y(13), sigma: 0.12, min: y(10), max: y(18) },
  weight: 2,
}
const metro: MerchantSpec = {
  merchant: 'Shenzhen Metro',
  description: '深圳通 SHENZHEN METRO 乘车码 {item}',
  items: ['大学城→深圳北', '西丽→车公庙', '大学城→华强北', '塘朗→福田'],
  category: 'transport',
  channel: 'wechat_pay',
  price: { pick: [300, 400, 500] },
  repeatable: true,
}
const taobao: MerchantSpec = {
  merchant: 'Taobao',
  description: '淘宝 TAOBAO {item}',
  items: ['充电宝', '床上用品', '衣架收纳', '冬季外套', '台灯'],
  category: 'shopping',
  channel: 'alipay',
  price: { median: y(55), sigma: 0.6, min: y(10), max: y(220), step: 10 },
  weight: 2,
}
const pdd: MerchantSpec = {
  merchant: 'Pinduoduo',
  description: '拼多多 PDD {item}',
  items: ['袜子 10双', '数据线', '水果 5斤', '洗衣液'],
  category: 'shopping',
  channel: 'wechat_pay',
  price: { median: y(22), sigma: 0.55, min: y(5), max: y(90), step: 10 },
  weight: 3,
}

const dorm: BillSeriesSpec = {
  key: 'dorm',
  payeeId: 'payee_dorm',
  name: 'Dorm rent',
  category: 'housing',
  dueDay: 1,
  leadMonths: 1,
  periodOffset: 0,
  channel: 'wechat_pay',
  payLeadDays: [0, 0],
  payHours: [9, 11],
  quote: () => fixedQuote('Dormitory fee 住宿费 · twin room, Building 7', y(900)),
  rawText: ({ period, dueDate, issueDate, quote }) =>
    renderBillText({
      header: ['Student Apartment Office 学生公寓管理中心', 'Accommodation Fee Notice 住宿费缴费通知'],
      fields: [
        ['Resident 住户', 'NASUTION A. (international student)'],
        ['Room 房间', 'Building 7, Room 4xx (masked)'],
        ['Month 月份', period],
        ['Issued 通知日期', issueDate],
      ],
      items: quote.lineItems,
      total: quote.amount,
      dueDate,
      notes: ['Pay via the campus WeChat service account 校园服务号.', 'Office hours Mon–Fri 9:00–17:00.'],
    }),
}

const phone: BillSeriesSpec = {
  key: 'phone',
  payeeId: 'payee_china_unicom',
  name: 'China Unicom plan',
  category: 'phone_internet',
  dueDay: 25,
  leadMonths: 0,
  periodOffset: -1,
  channel: 'alipay',
  payLeadDays: [0, 2],
  payHours: [12, 22],
  quote: () => fixedQuote('Campus King Card 校园大王卡 月费', y(58)),
  rawText: ({ period, dueDate, issueDate, quote }) =>
    renderBillText({
      header: ['中国联通 China Unicom Guangdong', 'Monthly Statement 月结账单'],
      fields: [
        ['Number 号码', '186****8804'],
        ['Statement period 账期', period],
        ['Issue date 出账日期', issueDate],
        ['Plan 套餐', 'Campus King Card ¥58/month · 40GB'],
      ],
      items: quote.lineItems,
      total: quote.amount,
      totalLabel: 'Amount due 本期应缴',
      dueDate,
      notes: ['Pay in the China Unicom app, WeChat Pay or Alipay.', 'Customer service 客服: 10010'],
    }),
}

export const ARIF: PersonaScript = {
  def: {
    id: 'arif',
    name: 'Arif',
    fullName: 'Arif Nasution',
      tagline: "23 · Indonesian master's student in Shenzhen",
    city: 'Shenzhen',
    currency: 'CNY',
    monthlyIncome: y(4_800),
    targetSpend: y(3_600),
    payday: 5,
    story:
      'Under target this month — canteen meals and metro rides leave room for a guilt-free concert ticket, or a bigger step toward his MacBook.',
  },
  tone: 'gentle',
  account: { name: 'Student account', maskedNumber: '•••• 3307', openingBalance: y(1_500) },
  payees: [
    { id: 'payee_dorm', name: 'Student Apartment Office', kind: 'landlord', verified: true, maskedAccount: '•••• 5520', addedAt: '2025-09-01' },
    { id: 'payee_china_unicom', name: 'China Unicom', kind: 'telco', verified: true, maskedAccount: '•••• 8804', addedAt: '2025-09-03' },
  ],
  incomes: [
    { merchant: 'Scholarship Stipend', description: 'SCHOLARSHIP STIPEND 奖学金生活费 · Graduate School', amount: y(3_500), day: 5, time: '10:05', channel: 'bank_transfer' },
    { merchant: 'Tutoring income', description: 'WeChat transfer 微信转账 · English tutoring (4 sessions)', amount: y(1_300), day: 20, time: '20:40', channel: 'wechat_pay' },
  ],
  subscriptions: [
    { merchant: 'Bilibili', description: 'BILIBILI 哔哩哔哩大会员 月卡', category: 'subscriptions', channel: 'alipay', day: 27, time: '00:02', amount: y(25) },
    { merchant: 'QQ Music', description: 'QQ MUSIC 豪华绿钻 连续包月', category: 'subscriptions', channel: 'wechat_pay', day: 28, time: '00:04', amount: y(15) },
  ],
  habits: [
    { key: 'canteen_breakfast', merchants: [canteen(['早餐 包子+豆浆', '肠粉', '鸡蛋饼'], 7.5, 4, 12)], perDay: { work: 0.6, off: 0.3 }, hours: [7.25, 8.75] },
    { key: 'canteen_lunch', merchants: [canteen(['二饭堂 午餐', '清真窗口 halal set', '两荤一素'], 15, 9, 22)], perDay: { work: 0.95, off: 0.65 }, hours: [11.5, 13] },
    { key: 'canteen_dinner', merchants: [canteen(['晚餐 两荤一素', '清真窗口 halal set', '炒饭'], 14, 9, 21)], perDay: { work: 0.85, off: 0.5 }, hours: [17.5, 19.5] },
    { key: 'noodles', merchants: [lamian], perDay: { work: 0.14, off: 0.5 }, hours: [12, 20] },
    { key: 'groceries', merchants: [walmart, { ...meiyijia, weight: 2 }], perDay: { work: 0.32, off: 0.55 }, hours: [9, 22] },
    { key: 'bubble_tea', merchants: [mixue, coco], perDay: { work: 0.38, off: 0.6 }, hours: [13, 21] },
    { key: 'metro', merchants: [metro], perDay: { work: 0.25, off: 0.9 }, hours: [10, 21] },
    { key: 'online_shopping', merchants: [taobao, pdd], perMonth: [4, 7], hours: [12, 23.5] },
    {
      key: 'dinner_out',
      merchants: [{ merchant: 'Xinjiang Restaurant', description: '新疆大盘鸡 XINJIANG RESTAURANT 清真', category: 'dining', channel: 'wechat_pay', price: { median: y(68), sigma: 0.2, min: y(40), max: y(110) } }],
      perMonth: [1, 3],
      on: 'off',
      hours: [18, 20.5],
    },
    {
      key: 'printing',
      merchants: [{ merchant: 'Campus Print Shop', description: '校园打印店 PRINT SHOP 论文打印', category: 'education', channel: 'wechat_pay', price: { median: y(6), sigma: 0.5, min: y(2), max: y(18), step: 10 } }],
      perMonth: [2, 5],
      on: 'work',
      hours: [9, 17],
    },
    {
      key: 'dorm_power',
      merchants: [{ merchant: 'Dorm Electricity Top-up', description: '宿舍电费充值 DORM POWER TOP-UP', category: 'utilities', channel: 'wechat_pay', price: { pick: [3000, 5000, 5000, 6000] } }],
      perMonth: [1, 1],
      hours: [20, 22],
      elasticity: 0,
    },
    {
      key: 'didi',
      merchants: [{ merchant: 'DiDi', description: 'DIDI 滴滴出行 快车 大学城→深圳北站', category: 'transport', channel: 'alipay', price: { median: y(26), sigma: 0.3, min: y(14), max: y(48), step: 1 } }],
      perMonth: [0, 2],
      hours: [9, 22],
    },
    {
      key: 'books',
      merchants: [{ merchant: 'JD.com', description: '京东 JD.COM {item}', items: ['教材 textbook', 'Python 编程书', '笔记本 notebooks'], category: 'education', channel: 'card', price: { median: y(45), sigma: 0.35, min: y(15), max: y(98) } }],
      perMonth: [0, 1],
      hours: [12, 23],
    },
  ],
  fillers: [walmart, taobao, pdd, mixue, canteen(['二饭堂 午餐'], 13, 8, 19)],
  pots: [
    { goalId: 'dream_macbook', name: 'MacBook Air', targetBalance: y(3_680), monthly: [y(350), y(450)], step: y(50), day: 5, time: '10:30' },
    { goalId: 'dream_flight', name: 'Flight home to Medan', monthly: [y(150), y(250)], step: y(50), day: 5, time: '10:31', fromMonthOffset: -2 },
  ],
  bills: [dorm, phone],
  story: [
    // new semester textbooks
    { monthOffset: -1, day: 3, time: '15:20', merchant: 'JD.com', description: '京东 JD.COM 教材 textbooks ×3', amount: -y(186), category: 'education', channel: 'card' },
  ],
  intensity: { [-3]: 1.08, [-2]: 1.1, 0: 0.9 },
  calibration: {
    months: { [-6]: y(3_180), [-5]: y(3_290), [-4]: y(3_240), [-3]: y(3_420), [-2]: y(3_380), [-1]: y(3_310) },
    current: { day: 22, total: y(2_270), dailyVariable: y(62) },
    tolerance: { past: y(70), current: y(25) },
  },
  dreams: [
    { id: 'dream_macbook', name: 'MacBook Air', price: y(7_999), image: 'preset:laptop', kind: 'goal', note: 'For the thesis — and everything after.' },
    { id: 'dream_flight', name: 'Flight home to Medan', price: y(2_600), image: 'preset:plane', kind: 'goal', note: 'Home for the holidays.' },
    { id: 'dream_concert', name: 'Concert ticket', price: y(480), image: 'preset:ticket', kind: 'treat' },
    { id: 'dream_sneakers', name: 'New sneakers', price: y(399), image: 'preset:sneakers', kind: 'treat' },
  ],
  tripwires: [
    { id: 'tw_month_80', kind: 'month_pct', threshold: 80 },
    { id: 'tw_month_100', kind: 'month_pct', threshold: 100 },
    { id: 'tw_single_over', kind: 'single_over', threshold: y(300) },
    { id: 'tw_pace_110', kind: 'pace_over', threshold: 110 },
  ],
  mandate: { autonomy: 'copilot', perActionCap: y(500), dailyCap: y(1_000), monthlyCap: y(5_000) },
}
