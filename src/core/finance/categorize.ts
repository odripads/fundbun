import { isSpendingCategory } from '../categories'
import type { CategoryId, Minor } from '../types'

export interface CategorizeResult {
  category: CategoryId
  source: 'rule' | 'model' | 'user'
  /** 0..1 */
  confidence: number
}

export type SubscriptionNiche = 'video' | 'music' | 'cloud' | 'fitness' | 'software' | 'gaming'

export interface MerchantEntry {
  /** canonical display name */
  name: string
  category: CategoryId
  /** lowercase aliases; CJK aliases match as substrings, Latin aliases on word boundaries */
  aliases: string[]
  subscription?: boolean
  niche?: SubscriptionNiche
  /** false for generic concepts (rent, canteen, salary): categorise, but keep the counterparty's own name */
  rename?: boolean
}

const m = (name: string, category: CategoryId, aliases: string[], extra: Partial<MerchantEntry> = {}): MerchantEntry => ({
  name,
  category,
  aliases,
  ...extra,
})
const sub = (niche: SubscriptionNiche): Partial<MerchantEntry> => ({ subscription: true, niche })
const generic: Partial<MerchantEntry> = { rename: false }

export const MERCHANTS: MerchantEntry[] = [
  // food delivery
  m('Meituan Delivery', 'delivery', ['美团外卖', 'meituan waimai', 'meituan delivery', 'meituan food']),
  m('Meituan Grocery', 'groceries', ['美团买菜', '小象超市', 'meituan grocery']),
  m('Meituan Bike', 'transport', ['美团单车', 'meituan bike']),
  m('Meituan', 'delivery', ['美团', 'meituan']),
  m('Ele.me', 'delivery', ['饿了么', 'ele.me']),
  // coffee & milk tea
  m('Heytea', 'coffee_tea', ['喜茶', 'heytea', 'hey tea']),
  m('Luckin Coffee', 'coffee_tea', ['瑞幸', 'luckin']),
  m('Mixue', 'coffee_tea', ['蜜雪冰城', 'mixue']),
  m('Chagee', 'coffee_tea', ['霸王茶姬', 'chagee']),
  m('Starbucks', 'coffee_tea', ['星巴克', 'starbucks']),
  m('Nayuki', 'coffee_tea', ['奈雪', 'nayuki']),
  m('Chabaidao', 'coffee_tea', ['茶百道', 'chabaidao']),
  m('Cotti Coffee', 'coffee_tea', ['库迪', 'cotti coffee']),
  m('Manner Coffee', 'coffee_tea', ['manner coffee']),
  m('Guming', 'coffee_tea', ['古茗', 'guming']),
  m('CoCo Fresh Tea', 'coffee_tea', ['coco都可', 'coco fresh']),
  // dining
  m('Haidilao', 'dining', ['海底捞', 'haidilao']),
  m('KFC', 'dining', ['肯德基', 'kfc']),
  m("McDonald's", 'dining', ['麦当劳', "mcdonald's", 'mcdonalds']),
  m('Burger King', 'dining', ['汉堡王', 'burger king']),
  m('Pizza Hut', 'dining', ['必胜客', 'pizza hut']),
  m('Xibei', 'dining', ['西贝', 'xibei']),
  m('Campus canteen', 'dining', ['食堂', '饭堂', '学生餐厅', 'canteen'], generic),
  // transport
  m('DiDi', 'transport', ['滴滴', 'didi']),
  m('Shenzhen Metro', 'transport', ['深圳通', '深圳地铁', 'shenzhen metro', 'shenzhen tong', 'szt']),
  m('Hello Bike', 'transport', ['哈啰', 'hellobike', 'hello bike']),
  m('Amap Taxi', 'transport', ['高德打车', 'amap taxi']),
  m('Sinopec', 'transport', ['中国石化', 'sinopec']),
  m('PetroChina', 'transport', ['中国石油', 'petrochina']),
  // shopping
  m('Taobao', 'shopping', ['淘宝', 'taobao']),
  m('Tmall', 'shopping', ['天猫', 'tmall']),
  m('JD Daojia', 'groceries', ['京东到家', 'jd daojia']),
  m('JD', 'shopping', ['京东', 'jd.com', 'jingdong', 'jd']),
  m('Pinduoduo', 'shopping', ['拼多多', 'pinduoduo', 'pdd']),
  m('Uniqlo', 'shopping', ['优衣库', 'uniqlo']),
  m('IKEA', 'shopping', ['宜家', 'ikea']),
  m('Miniso', 'shopping', ['名创优品', 'miniso']),
  m('Xiaomi', 'shopping', ['小米之家', '小米商城', 'xiaomi']),
  m('Douyin Mall', 'shopping', ['抖音商城', 'douyin']),
  m('Decathlon', 'shopping', ['迪卡侬', 'decathlon']),
  m('Zara', 'shopping', ['zara']),
  m('H&M', 'shopping', ['h&m']),
  m('Nike', 'shopping', ['耐克', 'nike']),
  m('Adidas', 'shopping', ['阿迪达斯', 'adidas']),
  m('Muji', 'shopping', ['无印良品', 'muji']),
  m('Apple Store', 'shopping', ['apple store', 'apple']),
  // groceries
  m('Hema', 'groceries', ['盒马', 'hema', 'freshippo']),
  m("Sam's Club", 'groceries', ['山姆', "sam's club", 'sams club']),
  m('Walmart', 'groceries', ['沃尔玛', 'walmart']),
  m('Yonghui', 'groceries', ['永辉', 'yonghui']),
  m('Vanguard', 'groceries', ['华润万家', 'vanguard']),
  m('Qian Da Ma', 'groceries', ['钱大妈']),
  m('Pagoda', 'groceries', ['百果园', 'pagoda']),
  m('Dingdong', 'groceries', ['叮咚买菜', 'dingdong']),
  m('7-Eleven', 'groceries', ['7-eleven', '7-11', '柒一拾壹']),
  m('FamilyMart', 'groceries', ['全家便利', 'familymart', 'family mart']),
  m('Lawson', 'groceries', ['罗森', 'lawson']),
  m('Costco', 'groceries', ['开市客', 'costco']),
  // subscriptions
  m('iQIYI', 'subscriptions', ['爱奇艺', 'iqiyi'], sub('video')),
  m('Tencent Video', 'subscriptions', ['腾讯视频', 'tencent video', 'v.qq.com'], sub('video')),
  m('Youku', 'subscriptions', ['优酷', 'youku'], sub('video')),
  m('Mango TV', 'subscriptions', ['芒果tv', 'mango tv', 'mgtv'], sub('video')),
  m('Bilibili', 'subscriptions', ['哔哩哔哩', 'bilibili', 'b站', '大会员'], sub('video')),
  m('Netflix', 'subscriptions', ['netflix'], sub('video')),
  m('Disney+', 'subscriptions', ['disney+', 'disney plus'], sub('video')),
  m('YouTube Premium', 'subscriptions', ['youtube premium', 'youtube'], sub('video')),
  m('QQ Music', 'subscriptions', ['qq音乐', 'qq music', '绿钻'], sub('music')),
  m('NetEase Cloud Music', 'subscriptions', ['网易云音乐', 'netease cloud music', 'netease music', '黑胶vip'], sub('music')),
  m('Kugou Music', 'subscriptions', ['酷狗', 'kugou'], sub('music')),
  m('Kuwo Music', 'subscriptions', ['酷我', 'kuwo'], sub('music')),
  m('Spotify', 'subscriptions', ['spotify'], sub('music')),
  m('Apple Music', 'subscriptions', ['apple music'], sub('music')),
  m('iCloud', 'subscriptions', ['icloud', 'icloud+'], sub('cloud')),
  m('Baidu Netdisk', 'subscriptions', ['百度网盘', 'baidu netdisk'], sub('cloud')),
  m('Apple Services', 'subscriptions', ['apple.com/bill', 'app store', 'itunes'], sub('software')),
  m('WPS', 'subscriptions', ['wps会员', 'wps office'], sub('software')),
  m('Microsoft 365', 'subscriptions', ['microsoft 365', 'office 365'], sub('software')),
  // health & fitness
  m('Pure Fitness', 'health', ['pure fitness', 'pure健身', 'pure yoga'], sub('fitness')),
  m('Super Monkey', 'health', ['超级猩猩', 'super monkey'], sub('fitness')),
  m('LeFit', 'health', ['乐刻', 'lefit'], sub('fitness')),
  m('Dashenlin Pharmacy', 'health', ['大参林', 'dashenlin']),
  m('LBX Pharmacy', 'health', ['老百姓大药房', 'lbx pharmacy']),
  // phone & internet
  m('China Mobile', 'phone_internet', ['中国移动', 'china mobile', 'cmcc']),
  m('China Unicom', 'phone_internet', ['中国联通', 'china unicom']),
  m('China Telecom', 'phone_internet', ['中国电信', 'china telecom']),
  // utilities
  m('Shenzhen Power Supply', 'utilities', ['深圳供电', '深圳市供电', 'shenzhen power supply', 'shenzhen power']),
  m('China Southern Power Grid', 'utilities', ['南方电网', 'china southern power grid', 'csg power']),
  m('Shenzhen Water', 'utilities', ['深圳水务', '深圳市水务', 'shenzhen water']),
  m('Shenzhen Gas', 'utilities', ['深圳燃气', 'shenzhen gas']),
  // personal care
  m('Watsons', 'personal_care', ['屈臣氏', 'watsons']),
  m('Sephora', 'personal_care', ['丝芙兰', 'sephora']),
  // travel
  m('Trip.com', 'travel', ['携程', 'ctrip', 'trip.com']),
  m('China Railway 12306', 'travel', ['12306', '中国铁路', 'china railway']),
  m('Fliggy', 'travel', ['飞猪', 'fliggy']),
  m('Qunar', 'travel', ['去哪儿', 'qunar']),
  m('Airbnb', 'travel', ['爱彼迎', 'airbnb']),
  m('China Southern Airlines', 'travel', ['南方航空', 'china southern airlines']),
  // entertainment
  m('Steam', 'entertainment', ['steam', 'steampowered'], sub('gaming')),
  m('Maoyan', 'entertainment', ['猫眼', 'maoyan']),
  m('Damai', 'entertainment', ['大麦', 'damai']),
  m('Nintendo eShop', 'entertainment', ['nintendo']),
  m('PlayStation Store', 'entertainment', ['playstation']),
  // education
  m('New Oriental', 'education', ['新东方', 'new oriental']),
  m('Youdao', 'education', ['有道', 'youdao']),
  m('Coursera', 'education', ['coursera']),
  m('Duolingo', 'education', ['duolingo', '多邻国']),
  // housing
  m('Rent', 'housing', ['房租', '租金', '房东', 'landlord', 'rent payment'], generic),
  m('Dorm', 'housing', ['宿舍', '住宿费', '学生公寓', 'dormitory', 'dorm'], generic),
  m('Ziroom', 'housing', ['自如', 'ziroom']),
  // insurance
  m('Ping An Insurance', 'insurance', ['平安保险', '中国平安', 'ping an']),
  m('China Life', 'insurance', ['中国人寿', 'china life']),
  // income / gifts / transfers
  m('Salary', 'income', ['工资', '薪资', '代发', 'payroll', 'salary'], generic),
  m('Scholarship', 'income', ['奖学金', '助学金', 'scholarship', 'stipend'], generic),
  m('Red packet', 'gifts', ['微信红包', '红包', 'red packet', 'hongbao'], generic),
  m('WeChat Transfer', 'transfer', ['微信转账', 'wechat transfer'], generic),
  m('Alipay Transfer', 'transfer', ['支付宝转账', 'alipay transfer'], generic),
  m("Yu'e Bao", 'transfer', ['余额宝', 'yuebao']),
]

// ───────────────────────────── text normalisation ─────────────────────────────

const CJK = /[㐀-鿿豈-﫿]/

function nfkc(s: string): string {
  return s.normalize('NFKC')
}

/** lowercase, NFKC, no whitespace or punctuation — for CJK substring matching */
function compact(s: string): string {
  return nfkc(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

interface CompiledAlias {
  entry: MerchantEntry
  weight: number
  test: (spaced: string, packed: string) => boolean
}

function compileAlias(entry: MerchantEntry, alias: string): CompiledAlias {
  const lower = nfkc(alias).toLowerCase()
  if (CJK.test(lower)) {
    const packed = compact(lower)
    return { entry, weight: packed.length * 2, test: (_s, p) => p.includes(packed) }
  }
  const words = lower.split(/[^a-z0-9+]+/).filter(Boolean)
  const body = words.map((w) => w.replace(/[+]/g, '\\+')).join('[^a-z0-9]*')
  const re = new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`)
  return { entry, weight: words.join('').length, test: (s) => re.test(s) }
}

const COMPILED: CompiledAlias[] = MERCHANTS.flatMap((e) =>
  [...new Set([...e.aliases, e.name.toLowerCase()])].map((a) => compileAlias(e, a)),
)

/** Dictionary lookup — the most specific (longest) alias wins, so "美团外卖" beats "美团". */
export function merchantInfo(raw: string): MerchantEntry | undefined {
  const spaced = nfkc(raw).toLowerCase()
  const packed = compact(raw)
  let best: CompiledAlias | undefined
  for (const c of COMPILED) {
    if ((!best || c.weight > best.weight) && c.test(spaced, packed)) best = c
  }
  return best?.entry
}

export function subscriptionNiche(merchant: string): SubscriptionNiche | undefined {
  return merchantInfo(merchant)?.niche
}

const LEGAL_SUFFIX = /(有限责任公司|股份有限公司|有限公司|分公司|\s+(co\.?,?\s*ltd\.?|ltd\.?|inc\.?|llc|limited|corp\.?))$/i
const TRAILING_REF = /\s+(#?\d[\d-]*|no\.?\s*\d+|[A-Z]{2})$/

function titleCaseIfShouting(s: string): string {
  if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function cleanMerchant(raw: string): string {
  let s = nfkc(raw).replace(/\s+/g, ' ').trim()
  s = s.replace(/[（(][^（）()]*[)）]/g, ' ').trim()
  const star = s.lastIndexOf('*')
  if (star >= 0 && star < s.length - 1) s = s.slice(star + 1).trim()
  for (let i = 0; i < 4; i++) {
    const next = s.replace(TRAILING_REF, '').replace(LEGAL_SUFFIX, '').trim()
    if (next === s || next.length === 0) break
    s = next
  }
  s = s.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
  return titleCaseIfShouting(s)
}

const normalizeCache = new Map<string, string>()

/** "MEITUAN*美团外卖 SZ 0931" → "Meituan Delivery". Stable, deterministic, display-friendly. */
export function normalizeMerchant(raw: string): string {
  const cached = normalizeCache.get(raw)
  if (cached !== undefined) return cached
  const entry = merchantInfo(raw)
  const cleaned = cleanMerchant(raw)
  const out = entry && entry.rename !== false ? entry.name : cleaned || nfkc(raw).trim() || 'Unknown'
  if (normalizeCache.size > 5000) normalizeCache.clear()
  normalizeCache.set(raw, out)
  return out
}

// ───────────────────────────── keyword rules ─────────────────────────────

const KEYWORD_RULES: [RegExp, CategoryId][] = [
  [/转账|\btransfer\b|还款|repayment|余额宝/, 'transfer'],
  [/外卖|takeout|take-out|food delivery/, 'delivery'],
  [/奶茶|咖啡|茶饮|\bcoffee\b|\bcafe\b|café|\bmilk tea\b|\bbubble tea\b|\btea\b|\blatte\b/, 'coffee_tea'],
  [/房租|租金|房东|物业|宿舍|\brent\b|landlord|\bdorm/, 'housing'],
  [/电费|水费|燃气费|煤气|供电|电力|水务|\belectricity\b|\bwater bill\b|\bgas bill\b|\butilit/, 'utilities'],
  [/话费|宽带|流量|手机费|\bmobile plan\b|broadband|\btelecom\b|\binternet\b/, 'phone_internet'],
  [/保险|\binsurance\b/, 'insurance'],
  [/医院|诊所|药房|药店|牙科|体检|健身|瑜伽|hospital|clinic|pharmacy|dental|\bgym\b|fitness|\byoga\b/, 'health'],
  [/学费|课程|培训|教材|书店|tuition|\bcourse|textbook|bookstore|exam fee/, 'education'],
  [/机票|航空|酒店|民宿|火车票|高铁|景区|\bflight|airline|\bhotel|hostel|\btravel/, 'travel'],
  [/电影|影城|影院|演唱会|音乐节|ktv|剧本杀|密室|游戏|cinema|\bmovie|concert|karaoke|\bgames?\b|bowling/, 'entertainment'],
  [/会员|订阅|自动续费|\bvip\b|subscription|premium|membership/, 'subscriptions'],
  [/理发|美发|美容|美甲|化妆品|护肤|salon|barber|haircut|\bspa\b|\bnails?\b|cosmetic|skincare/, 'personal_care'],
  [/红包|礼物|礼品|鲜花|花店|\bgifts?\b|\bflowers?\b/, 'gifts'],
  [/超市|便利店|生鲜|菜市场|买菜|supermarket|grocer|\bmart\b|\bmarket\b/, 'groceries'],
  [/地铁|公交|打车|出租车|加油|停车|\bmetro\b|\bbus\b|\btaxi\b|\bride\b|parking|\bfuel\b/, 'transport'],
  [/餐厅|饭店|面馆|小吃|火锅|烧烤|快餐|食堂|餐饮|restaurant|bistro|noodle|dumpling|hotpot|\bbbq\b|canteen|diner|eatery|\bkitchen\b/, 'dining'],
  [/商城|旗舰店|专卖店|服饰|服装|数码|电器|\bshop\b|\bstore\b|\bmall\b|boutique|outlet/, 'shopping'],
  [/手续费|年费|利息|滞纳金|罚款|\bfees?\b|service charge|\binterest\b|penalty|overdraft/, 'fees'],
]

const INCOME_IN = /工资|薪资|代发|奖学金|助学金|奖金|家教|劳务|稿费|salary|payroll|wages?\b|scholarship|stipend|bonus|tutoring|freelance/
const TRANSFER_IN = /转账|红包|转入|退还|\btransfer\b|red packet|hongbao|reimburse|报销/
const REFUND_IN = /退款|refund|reversal|chargeback/
const EMPLOYER_LIKE = /有限公司|公司|大学|学院|\bltd\b|\binc\b|\bco\.|\bcorp|university|college|technolog/

function keywordCategory(text: string): CategoryId | undefined {
  for (const [re, cat] of KEYWORD_RULES) if (re.test(text)) return cat
  return undefined
}

// ───────────────────────────── naive Bayes ─────────────────────────────

/** Built-in labelled examples (merchant / description text → category) for the on-device model. */
const TRAINING: Partial<Record<CategoryId, string[]>> = {
  dining: [
    '兰州拉面', '沙县小吃', '张亮麻辣烫', '杨国福麻辣烫', '老乡鸡', '真功夫', '赛百味 Subway', '太二酸菜鱼', '喜家德水饺',
    '永和大王', '和府捞面', '陈记肠粉', '潮汕牛肉火锅', '湘菜馆', '烤肉店', '东北饺子馆', '云南过桥米线', '重庆小面',
    'Noodle House', 'Dumpling King', 'Ramen bar', 'Sushi restaurant', 'Thai kitchen', 'Bistro lunch', '学生食堂 二楼',
    '饭堂 早餐', 'campus canteen lunch', 'brunch cafe and grill', 'steak house dinner', '日料 寿司',
  ],
  delivery: [
    '美团外卖 订单', '饿了么 外卖订单', 'Meituan order late night', 'food delivery order', '外卖 夜宵', '饿了么 夜宵',
    '美团 跑腿', 'takeout order', 'Ele.me order', '美团外卖 午餐', '外卖 晚餐 配送费', 'delivery fee dinner order',
  ],
  coffee_tea: [
    '奈雪的茶', 'CoCo都可', '一点点 奶茶', '古茗', '书亦烧仙草', 'Manner Coffee', 'Tims 咖啡', 'Costa Coffee',
    "Peet's Coffee", '茶百道', '沪上阿姨', '瑞幸咖啡 生椰拿铁', '喜茶 多肉葡萄', '蜜雪冰城 柠檬水', 'Starbucks latte',
    'bubble tea shop', '霸王茶姬 伯牙绝弦', 'milk tea', 'coffee kiosk', '乐乐茶', '柠檬茶 手打',
  ],
  groceries: [
    '永辉超市', '华润万家', '钱大妈', '百果园', '7-Eleven 便利店', '全家 FamilyMart', '罗森 Lawson', '美宜佳',
    '叮咚买菜', '朴朴超市', '盒马鲜生', '山姆会员店', '沃尔玛 Walmart', 'Costco', '菜市场 蔬菜', '水果店',
    'fresh market', 'supermarket groceries', 'Ole精品超市', '天虹超市', '猪肉 鸡蛋 蔬菜',
  ],
  transport: [
    '滴滴出行 快车', '高德打车', '曹操出行', 'T3出行', '哈啰单车', '青桔单车', '中国石化 加油站', '中国石油',
    '深圳巴士集团', '深圳通 地铁', '地铁 乘车码', '公交 乘车', 'ETC 通行费', '停车场 停车费', 'Shenzhen Metro ride',
    'DiDi Express ride', 'taxi fare', '出租车', 'uber trip', 'bike share',
  ],
  shopping: [
    '淘宝 订单', '天猫 旗舰店', '京东商城', '拼多多 百亿补贴', '优衣库', 'Zara', 'H&M', 'Nike', 'Adidas', '名创优品',
    '宜家家居', '小米之家', '华为商城', '苏宁易购', '唯品会', '抖音商城', '小红书 商城', '迪卡侬', 'Apple Store',
    '无印良品 MUJI', 'online shopping order', 'electronics store', '数码配件', '服装店',
  ],
  subscriptions: [
    '爱奇艺 VIP 会员', '腾讯视频 VIP', '优酷 VIP 会员', '芒果TV 会员', '哔哩哔哩 大会员', 'QQ音乐 豪华绿钻',
    '网易云音乐 黑胶VIP', '酷狗音乐 会员', 'Spotify Premium', 'Apple Music', 'iCloud+ 50GB', '百度网盘 超级会员',
    'WPS 会员', 'Netflix', 'Disney+', 'YouTube Premium', 'ChatGPT Plus', 'Microsoft 365', 'Adobe Creative Cloud',
    '自动续费 会员', 'monthly subscription renewal',
  ],
  entertainment: [
    '猫眼电影', '淘票票', '万达影城', 'KTV 唱歌', '大麦网 演唱会', '网易游戏', '腾讯游戏 王者荣耀', 'Steam 游戏',
    'Nintendo eShop', 'PlayStation Store', '剧本杀', '密室逃脱', '保龄球', '欢乐谷 门票', 'cinema tickets',
    'concert tickets', 'karaoke night', 'escape room', 'bar drinks', '酒吧',
  ],
  health: [
    '大参林药房', '老百姓大药房', '海王星辰', '北大深圳医院', '社康中心', '牙科诊所', '体检中心', '超级猩猩',
    '乐刻运动', 'Pure Fitness', '健身房 月卡', '瑜伽馆', 'pharmacy', 'hospital outpatient', 'dental clinic',
    'gym membership', '中医 推拿',
  ],
  education: [
    '新东方', '网易有道', 'Coursera', '得到 课程', '当当 图书', '知乎 盐选', 'Duolingo', '雅思报名费', '教材 书店',
    'tuition fee', 'online course', 'language school', '中国大学MOOC', '打印 复印 论文',
  ],
  travel: [
    '携程 酒店', '飞猪 机票', '去哪儿 火车票', '12306 高铁票', '南方航空 机票', '中国国航', '如家酒店', '汉庭酒店',
    '全季酒店', 'Airbnb', 'Booking.com hotel', 'flight ticket', 'hotel booking', '景区门票', 'hostel stay',
  ],
  personal_care: [
    '屈臣氏', '丝芙兰 Sephora', '理发店', '美甲店', '美容院', '万宁 Mannings', '完美日记', '花西子', 'barber shop',
    'hair salon', 'skincare', '洗剪吹',
  ],
  gifts: ['微信红包', '红包 生日', '花店 鲜花', '礼品店', '生日礼物', 'gift shop', 'flowers for mum', '结婚礼金'],
  insurance: ['平安保险', '中国人寿', '众安保险', '支付宝 好医保', '太平洋保险', 'insurance premium', 'health insurance'],
  fees: ['银行手续费', '信用卡年费', '跨行转账手续费', '滞纳金', 'ATM fee', 'service charge', 'late fee', 'overdraft interest'],
  housing: [
    '房租 十月', '自如 房租', '链家 租金', '贝壳 租房', '物业管理费', '宿舍 住宿费', '学生公寓', 'monthly rent',
    'landlord rent payment', 'dorm fee',
  ],
  utilities: ['深圳供电局 电费', '南方电网 电费', '深圳水务 水费', '深圳燃气 燃气费', '国家电网', 'electricity bill', 'water bill', 'gas bill'],
  phone_internet: ['中国移动 话费', '中国联通 话费', '中国电信 宽带', '话费充值', '宽带续费', 'mobile plan', 'broadband'],
  income: ['工资 代发', '薪资', '奖学金', '助学金', '家教 收入', 'salary', 'payroll', 'scholarship stipend', 'bonus'],
  transfer: ['微信转账', '支付宝转账', '余额宝 转入', '信用卡还款', 'bank transfer', 'transfer to friend'],
}

/** The hand-written examples plus every dictionary name and alias (so "Burger Joint" learns from "Burger King"). */
function trainingSet(): Partial<Record<CategoryId, string[]>> {
  const out: Partial<Record<CategoryId, string[]>> = {}
  for (const [cat, xs] of Object.entries(TRAINING) as [CategoryId, string[]][]) out[cat] = [...xs]
  for (const e of MERCHANTS) (out[e.category] ??= []).push(e.name, ...e.aliases)
  return out
}

const TRAINING_SET = trainingSet()

/** Size of the hand-labelled list (dictionary aliases are added on top). */
export const NB_TRAINING_SIZE = Object.values(TRAINING).reduce((n, xs) => n + (xs?.length ?? 0), 0)

/** Word tokens + character trigrams, plus CJK uni/bigrams (most of the signal in short Chinese names lives there). */
export function nbTokens(text: string): string[] {
  const lower = nfkc(text).toLowerCase()
  const out: string[] = []
  for (const w of lower.split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2) out.push(`w:${w}`)
  const packed = `^${compact(lower)}$`
  for (let i = 0; i + 3 <= packed.length; i++) out.push(`t:${packed.slice(i, i + 3)}`)
  for (let i = 0; i < packed.length; i++) {
    if (!CJK.test(packed[i])) continue
    out.push(`u:${packed[i]}`)
    if (CJK.test(packed[i + 1] ?? '')) out.push(`b:${packed.slice(i, i + 2)}`)
  }
  return out
}

interface NbModel {
  classes: CategoryId[]
  docs: Map<CategoryId, number>
  counts: Map<CategoryId, Map<string, number>>
  totals: Map<CategoryId, number>
  vocab: Set<string>
  n: number
}

function trainNaiveBayes(data: Partial<Record<CategoryId, string[]>>): NbModel {
  const model: NbModel = { classes: [], docs: new Map(), counts: new Map(), totals: new Map(), vocab: new Set(), n: 0 }
  for (const [cat, examples] of Object.entries(data) as [CategoryId, string[]][]) {
    model.classes.push(cat)
    model.docs.set(cat, examples.length)
    model.n += examples.length
    const counts = new Map<string, number>()
    let total = 0
    for (const ex of examples) {
      for (const tok of nbTokens(ex)) {
        counts.set(tok, (counts.get(tok) ?? 0) + 1)
        model.vocab.add(tok)
        total++
      }
    }
    model.counts.set(cat, counts)
    model.totals.set(cat, total)
  }
  return model
}

const NB_ALPHA = 0.5
const MODEL = trainNaiveBayes(TRAINING_SET)

export interface NbPrediction {
  category: CategoryId
  /** posterior probability of the winning class */
  confidence: number
  /** share of the input's tokens the model has seen */
  coverage: number
}

/** Multinomial naive Bayes over the built-in training set, optionally restricted to `allowed` classes. */
export function predictCategory(text: string, allowed?: (c: CategoryId) => boolean): NbPrediction {
  const tokens = nbTokens(text)
  const known = tokens.filter((t) => MODEL.vocab.has(t))
  const classes = MODEL.classes.filter((c) => !allowed || allowed(c))
  if (known.length === 0 || classes.length === 0) return { category: 'other', confidence: 0, coverage: 0 }
  const v = MODEL.vocab.size
  const scores = classes.map((c) => {
    const counts = MODEL.counts.get(c)!
    const denom = Math.log(MODEL.totals.get(c)! + NB_ALPHA * v)
    let s = Math.log((MODEL.docs.get(c)! + 1) / (MODEL.n + MODEL.classes.length))
    for (const t of known) s += Math.log((counts.get(t) ?? 0) + NB_ALPHA) - denom
    return s
  })
  const max = Math.max(...scores)
  const exps = scores.map((s) => Math.exp(s - max))
  const z = exps.reduce((a, b) => a + b, 0)
  let best = 0
  for (let i = 1; i < classes.length; i++) if (exps[i] > exps[best]) best = i
  return { category: classes[best], confidence: exps[best] / z, coverage: known.length / tokens.length }
}

// ───────────────────────────── cascade ─────────────────────────────

const NB_ACCEPT = 0.45
const NB_MIN_COVERAGE = 0.25

function result(category: CategoryId, source: CategorizeResult['source'], confidence: number): CategorizeResult {
  return { category, source, confidence: Math.round(confidence * 100) / 100 }
}

function lookupUserRule(merchant: string, rules: Record<string, CategoryId>): CategoryId | undefined {
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(rules, k) ? rules[k] : undefined)
  return own(normalizeMerchant(merchant)) ?? own(merchant.trim())
}

function categorizeInflow(merchant: string, text: string): CategorizeResult | undefined {
  if (INCOME_IN.test(text)) return result('income', 'rule', 0.95)
  if (REFUND_IN.test(text)) {
    const cat = merchantInfo(merchant)?.category ?? keywordCategory(text)
    if (cat && isSpendingCategory(cat)) return result(cat, 'rule', 0.8)
  }
  if (TRANSFER_IN.test(text)) return result('transfer', 'rule', 0.85)
  const entry = merchantInfo(merchant)
  if (entry?.category === 'income') return result('income', 'rule', 0.95)
  if (EMPLOYER_LIKE.test(text)) return result('income', 'rule', 0.75)
  return undefined
}

/**
 * Categorise a transaction. Order: user rules (exact normalised merchant) → merchant dictionary →
 * keyword rules → on-device multinomial naive Bayes over character/word tokens (trained on the built-in
 * labelled set) → 'other'. Positive amounts from employers → 'income'.
 */
export function categorize(
  merchant: string,
  description = '',
  amount: Minor = -1,
  userRules: Record<string, CategoryId> = {},
): CategorizeResult {
  const userCat = lookupUserRule(merchant, userRules)
  if (userCat) return result(userCat, 'user', 1)

  const text = nfkc(`${merchant} ${description}`).toLowerCase()
  const inflow = amount > 0
  if (inflow) {
    const r = categorizeInflow(merchant, text)
    if (r) return r
  }
  // income was handled above for inflows; anything matched from here on is spending, a refund or a transfer
  const allowed = (c: CategoryId) => c !== 'income'

  const entry = merchantInfo(merchant) ?? merchantInfo(description)
  if (entry && allowed(entry.category)) return result(entry.category, 'rule', 0.97)

  const kw = keywordCategory(text)
  if (kw && allowed(kw)) return result(kw, 'rule', 0.85)

  const nb = predictCategory(`${merchant} ${description}`, allowed)
  if (nb.confidence >= NB_ACCEPT && nb.coverage >= NB_MIN_COVERAGE) return result(nb.category, 'model', Math.min(0.95, nb.confidence))
  if (inflow) return result('transfer', 'model', 0.4)
  return result('other', 'model', 0.3)
}
