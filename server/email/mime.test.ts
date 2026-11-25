import { describe, expect, it } from 'vitest'
import { isAllowedSender, readMailbox, senderDomain } from '../../src/core/email/allowlist'
import { readEmail } from '../../src/core/email/parse'
import {
  MAX_BODY_BYTES,
  bodyText,
  capBytes,
  decodeCharset,
  decodeEntities,
  decodeQuotedPrintable,
  decodeUnknown,
  decodeWords,
  headerDate,
  headerText,
  headerValues,
  htmlToText,
  parseContentType,
  parseHeaders,
  senderCheckOf,
  senderOf,
  senderText,
  splitMultipart,
} from './mime'

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64')
const hex = (h: string) => Buffer.from(h, 'hex')
const headersOf = (text: string) => parseHeaders(text)
const body = (headerBlock: string, raw: string | Buffer) => bodyText(headersOf(headerBlock), Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'))

describe('charsets', () => {
  it.each([
    ['utf-8', Buffer.from('瑞幸咖啡 ¥23.50'), '瑞幸咖啡 ¥23.50'],
    ['UTF8', Buffer.from('café'), 'café'],
    ['gb2312', hex('d5d0c9ccd2f8d0d0'), '招商银行'],
    ['GBK', hex('d6d0cec4'), '中文'],
    ['x-gbk', hex('d6d0cec4'), '中文'],
    ['gb18030', hex('d6d0cec4'), '中文'],
    ['"big5"', hex('a578b9f4'), '台幣'],
    ['iso-8859-1', Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'café'],
    ['windows-1252', Buffer.from([0x80, 0x35]), '€5'],
    ['us-ascii', Buffer.from('plain'), 'plain'],
    ['x-made-up-charset', Buffer.from('瑞幸'), '瑞幸'],
    [undefined, Buffer.from('瑞幸'), '瑞幸'],
  ])('decodes %s', (charset, bytes, text) => {
    expect(decodeCharset(bytes, charset)).toBe(text)
  })

  it('drops a character cut off at the end instead of failing', () => {
    const cut = Buffer.from('金额', 'utf8').subarray(0, 4)
    expect(() => decodeCharset(cut, 'utf-8')).not.toThrow()
    expect(decodeCharset(cut, 'utf-8')).toBe('金')
    expect(decodeCharset(hex('d5d0c9'), 'gbk')).toBe('招')
  })

  it('reads unlabelled bytes as UTF-8 when they are, and as GB18030 otherwise', () => {
    expect(decodeUnknown(Buffer.from('支付宝'))).toBe('支付宝')
    expect(decodeUnknown(hex('d6d0cec4'))).toBe('中文')
    // UTF-8 cut mid-character is still UTF-8
    expect(decodeUnknown(Buffer.from('支付宝').subarray(0, 7))).toBe('支付')
  })
})

describe('encoded-words in headers', () => {
  it('decodes B and Q words, upper or lower case', () => {
    expect(decodeWords(`=?UTF-8?B?${b64('招商银行')}?= <x@cmbchina.com>`)).toBe('招商银行 <x@cmbchina.com>')
    expect(decodeWords('=?utf-8?q?Payment_received_=E2=82=AC5?=')).toBe('Payment received €5')
    expect(decodeWords('=?iso-8859-1?Q?caf=E9?=')).toBe('café')
  })

  it('joins adjacent words without the space between them, even across a folded line', () => {
    const bytes = Buffer.from('交易提醒')
    const folded = `Subject: =?utf-8?B?${b64(bytes.subarray(0, 4))}?=\r\n =?utf-8?B?${b64(bytes.subarray(4))}?=\r\n`
    expect(headerText(headersOf(folded).get('subject'))).toBe('交易提醒')
  })

  it('keeps the space between a word and plain text', () => {
    expect(decodeWords(`Re: =?utf-8?B?${b64('账单')}?= ready`)).toBe('Re: 账单 ready')
    expect(decodeWords(`=?utf-8?B?${b64('甲')}?= and =?utf-8?B?${b64('乙')}?=`)).toBe('甲 and 乙')
  })

  it('decodes GB2312 words and a language tag', () => {
    expect(decodeWords(`=?GB2312?B?${b64(hex('bdbbd2d7cce1d0d1'))}?=`)).toBe('交易提醒')
    expect(decodeWords('=?utf-8*en?Q?Hello?=')).toBe('Hello')
  })

  it('leaves malformed words and unknown charsets readable', () => {
    expect(decodeWords('=?utf-8?X?abc?= plain')).toBe('=?utf-8?X?abc?= plain')
    expect(decodeWords(`=?made-up?B?${b64('ok')}?=`)).toBe('ok')
    expect(() => decodeWords('=?utf-8?B?***?=')).not.toThrow()
  })

  it('headerText removes line breaks and control characters and caps the length', () => {
    expect(headerText('a\r\n\tb\u0000c')).toBe('a b c')
    expect(headerText('x'.repeat(1000))).toHaveLength(400)
    expect(headerText(undefined)).toBe('')
  })

  it('senderText decodes the name but never lets an encoded-word make an address', () => {
    expect(senderText(`=?UTF-8?B?${b64('招商银行')}?= <x@cmbchina.com>`)).toBe('招商银行 <x@cmbchina.com>')
    expect(senderText('service@paypal.com')).toBe('service@paypal.com')
    expect(senderText('service@paypal.com (PayPal)')).toBe('（PayPal） <service@paypal.com>')
    // a bare address followed by a word that decodes to a bank address is not one plain address: refused
    expect(senderText('attacker@evil.example =?utf-8?Q?=3Calerts=40bca.co.id=3E?=')).toBe('')
    expect(senderText(`=?utf-8?B?${b64('alerts@bca.co.id')}?=`)).toBe('')
    expect(senderText(`"=?utf-8?B?${b64('<alerts@bca.co.id>')}?=" <attacker@evil.example>`)).toBe('‹alerts＠bca.co.id› <attacker@evil.example>')
    // other headers keep what the sender wrote
    expect(headerText('=?utf-8?Q?Shop_=40_Mall?=')).toBe('Shop @ Mall')
  })

  it('senderText never cuts the address: a long quoted name holding a bank address stays a name', () => {
    const raw = `"${'A'.repeat(380)} <alerts@bca.co.id> padding" <attacker@evil.example>`
    const from = senderText(parseHeaders(`From: ${raw}\r\n`).get('from'))
    expect(from.endsWith(' <attacker@evil.example>')).toBe(true)
    expect(from).not.toContain('<alerts@bca.co.id>')
    expect(from.length).toBeLessThan(400)
    expect(isAllowedSender(from)).toBe(false)
    expect(senderDomain(from)).toBe('evil.example')
  })

  it('senderText refuses an address too long to be real instead of cutting it into a bank one', () => {
    const raw = `${'a'.repeat(390)}@bca.co.id.evil.example`
    expect(senderText(raw)).toBe('')
    expect(senderText(`Bank <${raw}>`)).toBe('')
  })

  it('senderText turns brackets decoded from an encoded-word into look-alikes, so they cannot make a comment', () => {
    const from = senderText('alerts@bca.co.id =?utf-8?Q?=28?= <x@evil.example> =?utf-8?Q?=29?=')
    // the raw header's one address is x@evil.example; text after it is not allowed, so the header is refused
    expect(from).toBe('')
    // an unquoted address in the name is refused outright: other readers take it as the sender
    expect(senderText('alerts@bca.co.id =?utf-8?Q?=28?= <x@evil.example>')).toBe('')
    const named = senderText('=?utf-8?Q?alerts=40bca.co.id_=28?= <x@evil.example>')
    expect(named).toBe('alerts＠bca.co.id （ <x@evil.example>')
    expect(isAllowedSender(named)).toBe(false)
  })

  it('senderText refuses two mailboxes, groups and broken quoting', () => {
    for (const raw of [
      '"A" <x@evil.example>, "B" <alerts@bca.co.id>',
      'x@evil.example, <alerts@bca.co.id>',
      'Undisclosed recipients:;',
      '"unclosed <alerts@bca.co.id>',
      'Name (unclosed <alerts@bca.co.id>',
      '<alerts@bca.co.id',
      'Bank <alerts@bca.co.id> trailing words',
    ]) {
      expect(senderText(raw), raw).toBe('')
    }
  })
})

describe('the sender is read from the header bytes, before any charset', () => {
  const block = (from: string | Buffer) => Buffer.concat([Buffer.from('From: '), Buffer.isBuffer(from) ? from : Buffer.from(from, 'latin1'), Buffer.from('\r\nSubject: Notifikasi\r\nContent-Type: text/plain; charset=utf-8\r\n')])
  // 0x81 then "\": GB18030 joins the two into one Chinese character, so a decoded view loses the escape
  const RAW = '"a\x81\\" <alerts@bca.co.id> (" <x@evil.example> (c\x81\\))'

  it('a byte that swallows a backslash in GB18030 cannot turn a forged sender into a bank', () => {
    // byte by byte, as mail servers read it: the bank address is inside the quoted name
    expect(readMailbox(RAW)?.address).toBe('x@evil.example')
    // decoded as GB18030 the same header would name the bank
    expect(readMailbox(decodeUnknown(Buffer.from(RAW, 'latin1')))?.address).toBe('alerts@bca.co.id')
    // the bytes and the text disagree: refused
    expect(senderOf(block(RAW))).toBe('')
    expect(isAllowedSender(senderOf(block(RAW)))).toBe(false)
    // one raw value is read byte by byte, so it never names the bank
    expect(senderText(RAW)).toMatch(/ <x@evil\.example>$/)
    expect(isAllowedSender(senderText(RAW))).toBe(false)
  })

  it('still reads a Chinese name sent as raw GBK or UTF-8 bytes, or as encoded-words', () => {
    expect(senderOf(block(Buffer.concat([Buffer.from('"'), hex('d5d0c9ccd2f8d0d0'), Buffer.from('" <x@cmbchina.com>')])))).toBe('招商银行 <x@cmbchina.com>')
    expect(senderOf(block(Buffer.from('"招商银行" <x@cmbchina.com>', 'utf8')))).toBe('招商银行 <x@cmbchina.com>')
    expect(senderOf(block(`=?UTF-8?B?${b64('支付宝')}?= <service@alipay.com>`))).toBe('支付宝 <service@alipay.com>')
    expect(senderOf(Buffer.from('From: BCA\r\n <bca@bca.co.id>\r\n'))).toBe('BCA <bca@bca.co.id>')
    expect(senderOf(block('service@paypal.com'))).toBe('service@paypal.com')
    // ":" and "[ ]" in a decoded name become look-alikes, so the app still reads one plain address
    const named = senderOf(block(`"Bank: Alerts [ID]" <bca@bca.co.id>`))
    expect(named).toBe('Bank： Alerts ［ID］ <bca@bca.co.id>')
    expect(isAllowedSender(named)).toBe(true)
    expect(senderOf(block('=?UTF-8?Q?Bank=3A_Alerts_=5BID=5D?= <bca@bca.co.id>'))).toBe('Bank： Alerts ［ID］ <bca@bca.co.id>')
    expect(isAllowedSender(senderOf(block('alerts@bca.co.id <alerts@bca.co.id>')))).toBe(true)
  })

  it('refuses a raw GBK name whose second byte is a backslash: its bytes and its text disagree', () => {
    expect(senderOf(block(Buffer.concat([Buffer.from('"'), hex('815c'), Buffer.from('" <x@cmbchina.com>')])))).toBe('')
  })

  it('refuses a header block with no From, or with two', () => {
    expect(senderOf(Buffer.from('Subject: hi\r\n'))).toBe('')
    expect(senderOf(Buffer.from('From: BCA <bca@bca.co.id>\r\nFrom: <x@evil.example>\r\n'))).toBe('')
    expect(senderOf(Buffer.from('FROM: <x@evil.example>\r\nSubject: hi\r\nfrom: BCA <bca@bca.co.id>\r\n'))).toBe('')
  })

  it('refuses a From with a bare CR or another control character in it', () => {
    expect(senderOf(block('"\rFrom: <x@evil.example>\r" <alerts@bca.co.id>'))).toBe('')
    expect(senderText('BCA <bca@bca.co.id>\u0000')).toBe('')
    expect(senderText('BCA\t<bca@bca.co.id>')).toBe('BCA <bca@bca.co.id>')
  })
})

describe('headers and content types', () => {
  it('unfolds lines, lower-cases names and keeps the first of a repeated header', () => {
    const h = parseHeaders('From: A <a@x.com>\r\nSubject: one\r\n two\r\nSUBJECT: later\r\nbroken line\r\n')
    expect(h.get('from')).toBe('A <a@x.com>')
    expect(h.get('subject')).toBe('one two')
  })

  it('headerValues gives every value of a repeated header, in order', () => {
    expect(headerValues('From: A <a@x.com>\r\nSubject: s\r\nfrom: B\r\n <b@y.com>\r\n', 'From')).toEqual(['A <a@x.com>', 'B <b@y.com>'])
    expect(headerValues('Subject: s\r\n', 'from')).toEqual([])
  })

  it('reads the type, subtype and parameters', () => {
    expect(parseContentType('Multipart/Alternative; boundary="--=_Part_1;x"; charset=UTF-8')).toEqual({
      type: 'multipart', subtype: 'alternative', params: { boundary: '--=_Part_1;x', charset: 'UTF-8' },
    })
    expect(parseContentType("text/plain; charset*=utf-8''gb2312")).toMatchObject({ params: { charset: 'gb2312' } })
    expect(parseContentType(undefined)).toEqual({ type: '', subtype: '', params: {} })
  })

  it('headerDate turns the Date header into ISO 8601, or null', () => {
    expect(headerDate('Tue, 24 Nov 2026 10:00:00 +0800 (CST)')).toBe('2026-11-24T02:00:00.000Z')
    expect(headerDate('not a date')).toBeNull()
    expect(headerDate(undefined)).toBeNull()
  })
})

describe('transfer encodings', () => {
  it('decodes quoted-printable with soft line breaks', () => {
    expect(decodeQuotedPrintable('=E9=87=91=E9=A2=9D=\r\n: =C2=A558.00').toString('utf8')).toBe('金额: ¥58.00')
    expect(decodeQuotedPrintable('a=\nb').toString()).toBe('ab')
  })

  it('drops a cut-off escape at the very end', () => {
    expect(decodeQuotedPrintable('total=').toString()).toBe('total')
    expect(decodeQuotedPrintable('total=4').toString()).toBe('total')
    expect(decodeQuotedPrintable('a = b').toString()).toBe('a = b')
  })
})

describe('HTML mail as text', () => {
  it('drops scripts, styles, the head and comments', () => {
    const html = '<html><head><title>T</title><style>p{color:red}</style></head><body><!-- hidden --><script>alert("x")</script><p>付款金额：&yen;23.50</p></body></html>'
    expect(htmlToText(html)).toBe('付款金额：¥23.50')
  })

  it('turns blocks into lines and table cells into "a | b"', () => {
    const html = `<table><tr><th>交易日期</th><th>交易商户</th><th>交易金额</th></tr>
      <tr><td>2026-11-12</td><td> 瑞幸咖啡 </td><td>&#165;45.00</td><td></td></tr></table><div>Thanks<br>Bank</div>`
    expect(htmlToText(html)).toBe('交易日期 | 交易商户 | 交易金额\n2026-11-12 | 瑞幸咖啡 | ¥45.00\nThanks\nBank')
  })

  it('reads a nested layout table without empty cells', () => {
    const html = '<table><tr><td><table><tr><td>收款方：</td><td>瑞幸咖啡</td></tr></table></td><td></td></tr></table>'
    expect(htmlToText(html)).toBe('收款方： | 瑞幸咖啡')
  })

  it('keeps an empty cell inside a row, so each amount stays in its column', () => {
    const html =
      '<table><tr><td>交易日期</td><td>摘要</td><td>交易金额</td><td>余额</td></tr><tr><td>2026-09-21</td><td></td><td>12.00</td><td>988.00</td></tr></table>'
    const text = htmlToText(html)
    expect(text).toBe('交易日期 | 摘要 | 交易金额 | 余额\n2026-09-21 |  | 12.00 | 988.00')
    // and the app reads the spending, not the balance
    const reading = readEmail({ id: 'blank', from: 'service@cmbchina.com', subject: '交易提醒', date: '2026-09-21T02:00:00.000Z', body: text, source: 'imap' }, 'CNY')
    expect(reading.candidates.map((c) => c.amount)).toEqual([1_200])
    // an empty first cell is kept too: the header row and the data rows still line up
    expect(htmlToText('<table><tr><td></td><td>Total</td><td>Rp 50.000</td></tr></table>')).toBe('| Total | Rp 50.000')
  })

  it('decodes named and numeric entities, and drops control characters', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&#39;&#x20AC;&nbsp;&copy;&unknown;&#0;&#x1F;')).toBe('&<>"\'€ ©&unknown;')
    expect(htmlToText('A&nbsp;&nbsp;B &mdash; C')).toBe('A B - C')
  })

  it('keeps a "<" that does not open a tag, and a ">" inside a quoted attribute', () => {
    expect(htmlToText('<p>price < 5 & more</p>')).toBe('price < 5 & more')
    expect(htmlToText('<a title="a > b" href="x">link</a> text')).toBe('link text')
  })

  it('ends cleanly when the document is cut off', () => {
    expect(htmlToText('<p>Amount 12</p><a href="https://exa')).toBe('Amount 12')
    expect(htmlToText('<p>Amount 12</p><script>var a = 1')).toBe('Amount 12')
    expect(htmlToText('<p>Amount 12</p><!-- never closed')).toBe('Amount 12')
  })

  it('reads on past a head that is never closed', () => {
    expect(htmlToText('<head><meta charset="utf-8"><body><p>Paid 9.90</p>')).toBe('Paid 9.90')
  })

  it('stays fast on hostile markup', () => {
    const started = Date.now()
    htmlToText('<a'.repeat(8000))
    htmlToText('<a href="'.repeat(2000))
    htmlToText('<script>'.repeat(2000))
    htmlToText('<td>'.repeat(4000))
    htmlToText('<svg>'.repeat(4000))
    htmlToText('<head>x'.repeat(3000))
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('message bodies', () => {
  const ALT = [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '=E4=BB=98=E6=AC=BE=E9=87=91=E9=A2=9D=EF=BC=9A=C2=A523.50',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64('<p>HTML version</p>'),
    '--b1--',
    '',
  ].join('\r\n')

  it('prefers the text/plain part', () => {
    expect(body('Content-Type: multipart/alternative; boundary=b1', ALT)).toBe('付款金额：¥23.50')
  })

  it('uses the HTML part when there is no plain text, or the plain text is empty', () => {
    const htmlOnly = ALT.replace(/--b1\r\nContent-Type: text\/plain[\s\S]*?(?=--b1\r\nContent-Type: text\/html)/, '')
    expect(body('Content-Type: multipart/alternative; boundary=b1', htmlOnly)).toBe('HTML version')
    const blankPlain = ALT.replace('=E4=BB=98=E6=AC=BE=E9=87=91=E9=A2=9D=EF=BC=9A=C2=A523.50', '   ')
    expect(body('Content-Type: multipart/alternative; boundary=b1', blankPlain)).toBe('HTML version')
  })

  it('finds the text inside nested multiparts and skips attachments', () => {
    const raw = [
      'preamble to ignore',
      '--outer',
      'Content-Type: text/plain; name="statement.txt"',
      'Content-Disposition: attachment; filename="statement.txt"',
      '',
      'ATTACHMENT TEXT',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/html; charset=gb2312',
      '',
      Buffer.from('<p>', 'latin1').toString('latin1') + hex('d6d0cec4').toString('latin1') + '</p>',
      '--inner--',
      '--outer',
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--outer--',
    ].join('\r\n')
    expect(body('Content-Type: multipart/mixed; boundary="outer"', Buffer.from(raw, 'latin1'))).toBe('中文')
  })

  it('treats boundaries as case-sensitive and ignores look-alike lines', () => {
    const raw = '--AbC\r\nContent-Type: text/plain\r\n\r\nline one\r\n--abc\r\n--AbCdef\r\n--AbC--'
    expect(body('Content-Type: multipart/mixed; boundary=AbC', raw)).toBe('line one\r\n--abc\r\n--AbCdef'.replace(/\r\n/g, '\n'))
  })

  it('decodes a single-part base64 body in its charset', () => {
    expect(body('Content-Type: text/plain; charset=gbk\r\nContent-Transfer-Encoding: base64', b64(hex('d6d0cec4')))).toBe('中文')
  })

  it('turns a single-part HTML body into text, and HTML labelled as plain text too', () => {
    expect(body('Content-Type: text/html; charset=utf-8', '<div>Paid <b>¥9.90</b></div>')).toBe('Paid ¥9.90')
    expect(body('Content-Type: text/plain', '<!DOCTYPE html><html><body><p>Paid 9.90</p></body></html>')).toBe('Paid 9.90')
  })

  it('reads a body with no Content-Type as plain text, and returns nothing for other types', () => {
    expect(body('', 'hello\r\n\r\n\r\n\r\nthere\u0007')).toBe('hello\n\nthere')
    expect(body('Content-Type: image/png\r\nContent-Transfer-Encoding: base64', 'iVBORw0KGgo=')).toBe('')
  })

  it('keeps spaces that line up a plain-text table', () => {
    expect(body('Content-Type: text/plain', '交易日期    交易金额\r\n2026-11-01  ¥10.00')).toBe('交易日期    交易金额\n2026-11-01  ¥10.00')
  })

  it('decodes a body cut off at 16 KB in the middle of base64, quoted-printable and multipart', () => {
    const long = '支付'.repeat(4000)
    const cutB64 = b64(long).slice(0, 16_384)
    expect(() => body('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64', cutB64)).not.toThrow()
    expect(body('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64', cutB64)).toMatch(/^(支付)+支?$/)
    const qp = [...Buffer.from(long)].map((b) => `=${b.toString(16).toUpperCase()}`).join('').slice(0, 16_383)
    expect(body('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable', qp)).toMatch(/^(支付)+支?$/)
    const multi = `--b\r\nContent-Type: text/html\r\n\r\n<table><tr><td>${'金额'.repeat(5000)}`.slice(0, 16_384)
    expect(body('Content-Type: multipart/alternative; boundary=b', multi)).toMatch(/^(金额)+金?$/)
  })

  it('caps the text at 16 KB without splitting a character', () => {
    const text = body('Content-Type: text/plain; charset=utf-8', '金'.repeat(10_000))
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_BODY_BYTES)
    expect(text).toMatch(/^金+$/)
    expect(capBytes('abc', 10)).toBe('abc')
    expect(capBytes('金金', 4)).toBe('金')
  })

  it('splitMultipart keeps the last part of a cut-off body', () => {
    expect(splitMultipart('--x\r\nContent-Type: text/plain\r\n\r\nfirst\r\n--x\r\nContent-Type: text/plain\r\n\r\nsecond, cut', 'x')).toEqual([
      { headers: 'Content-Type: text/plain', body: 'first' },
      { headers: 'Content-Type: text/plain', body: 'second, cut' },
    ])
  })

  it('never throws, whatever it is given', () => {
    for (const ct of ['multipart/mixed', 'multipart/mixed; boundary=', 'text/plain; charset=☃', ';;;', 'text/html; charset="']) {
      expect(() => body(`Content-Type: ${ct}`, Buffer.from([0xff, 0xfe, 0x00, 0x3c]))).not.toThrow()
    }
  })
})

describe('senderCheckOf (the receiving server\'s Authentication-Results)', () => {
  const block = (...lines: string[]) => Buffer.from(`${lines.join('\r\n')}\r\nFrom: BCA <bca@bca.co.id>\r\n\r\n`, 'latin1')

  it('says fail only when the TOPMOST header says dmarc=fail', () => {
    expect(senderCheckOf(block('Authentication-Results: mx.google.com;\r\n       spf=softfail smtp.mailfrom=evil.example;\r\n       dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=bca.co.id'))).toBe('fail')
    expect(senderCheckOf(block('Authentication-Results: mx.example; DMARC=Fail action=none header.from=bca.co.id'))).toBe('fail')
    expect(senderCheckOf(block('Authentication-Results: mx.google.com; dkim=pass header.i=@bca.co.id; dmarc=pass (p=REJECT) header.from=bca.co.id'))).toBeUndefined()
  })

  it('a header the sender added below the server\'s own changes nothing, either way', () => {
    // the receiving server writes its header on top; a sender can only add lines underneath
    expect(senderCheckOf(block('Authentication-Results: mx.google.com; dmarc=pass header.from=bca.co.id', 'Authentication-Results: fake; dmarc=fail'))).toBeUndefined()
    expect(senderCheckOf(block('Authentication-Results: mx.google.com; dmarc=fail header.from=bca.co.id', 'Authentication-Results: fake; dmarc=pass'))).toBe('fail')
  })

  it('no header, or words that only look alike, give nothing to act on', () => {
    expect(senderCheckOf(block('Subject: hi'))).toBeUndefined()
    expect(senderCheckOf(block('Authentication-Results: mx; dmarc=failure-not-a-result'))).toBeUndefined()
    expect(senderCheckOf(block('Authentication-Results: mx; xdmarc=fail'))).toBeUndefined()
    expect(senderCheckOf(Buffer.alloc(0))).toBeUndefined()
  })
})
