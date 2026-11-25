/**
 * TEST HELPER ONLY (never imported by the app or the server): a scripted IMAP server on an in-memory stream,
 * so the IMAP client can be tested byte for byte without any network. It records every command it receives,
 * answers synchronizing literals with "+", and can cut its replies into tiny chunks to test split literals.
 */
import { Duplex } from 'node:stream'

export interface ReceivedCommand {
  tag: string
  /** the command without its tag, each literal shown as {size} */
  text: string
  literals: Buffer[]
}

export type Reply = (data: string | Buffer) => void

export interface FakeImapOptions {
  /** the first line the server sends; null sends nothing at all */
  greeting?: string | null
  /** answers one complete command */
  onCommand?: (cmd: ReceivedCommand, reply: Reply, server: FakeImap) => void
  /** cut every reply into pieces of this many bytes, each arriving on its own */
  chunk?: number
  /** wait this long (ms) before each reply */
  delayMs?: number
}

export interface FakeImap {
  socket: Duplex
  commands: ReceivedCommand[]
  /** every byte the client wrote */
  received(): Buffer
  /** ends the connection from the server side once queued replies are out */
  hangUp(): void
}

export function fakeImap(opts: FakeImapOptions = {}): FakeImap {
  const commands: ReceivedCommand[] = []
  const seen: Buffer[] = []
  const outbox: (Buffer | null)[] = []
  let pumping = false
  let inbound = Buffer.alloc(0)
  let literalLeft = 0
  let current: ReceivedCommand | null = null

  const pump = () => {
    if (pumping) return
    pumping = true
    const step = () => {
      if (!outbox.length || socket.destroyed) {
        pumping = false
        return
      }
      const next = outbox.shift() as Buffer | null
      socket.push(next)
      if (next === null) {
        pumping = false
        return
      }
      setImmediate(step)
    }
    setImmediate(step)
  }

  const reply: Reply = (data) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const size = opts.chunk && opts.chunk > 0 ? opts.chunk : bytes.length || 1
    const send = () => {
      for (let i = 0; i < bytes.length; i += size) outbox.push(bytes.subarray(i, i + size))
      pump()
    }
    // timers with the same delay fire in the order they were set, so replies keep their order
    if (opts.delayMs) setTimeout(send, opts.delayMs)
    else send()
  }

  const onBytes = (chunk: Buffer) => {
    inbound = Buffer.concat([inbound, chunk])
    for (;;) {
      if (literalLeft > 0) {
        if (inbound.length < literalLeft) return
        current?.literals.push(Buffer.from(inbound.subarray(0, literalLeft)))
        inbound = inbound.subarray(literalLeft)
        literalLeft = 0
        continue
      }
      const eol = inbound.indexOf('\r\n')
      if (eol < 0) return
      let line = inbound.subarray(0, eol).toString('utf8')
      inbound = inbound.subarray(eol + 2)
      if (!current) {
        const space = line.indexOf(' ')
        current = { tag: space < 0 ? line : line.slice(0, space), text: '', literals: [] }
        line = space < 0 ? '' : line.slice(space + 1)
      }
      current.text += line
      const literal = /\{(\d+)\}$/.exec(line)
      if (literal) {
        literalLeft = Number(literal[1])
        reply('+ Ready for literal data\r\n')
        if (!literalLeft) current.literals.push(Buffer.alloc(0))
        continue
      }
      const done = current
      current = null
      commands.push(done)
      opts.onCommand?.(done, reply, server)
    }
  }

  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      seen.push(Buffer.from(chunk))
      onBytes(Buffer.from(chunk))
      callback()
    },
    final(callback) {
      callback()
    },
  })
  socket.on('error', () => undefined)

  const server: FakeImap = {
    socket,
    commands,
    received: () => Buffer.concat(seen),
    hangUp: () => {
      const end = () => {
        outbox.push(null)
        pump()
      }
      if (opts.delayMs) setTimeout(end, opts.delayMs)
      else end()
    },
  }
  const greeting = opts.greeting === undefined ? '* OK [CAPABILITY IMAP4rev1 ID] FakeImap ready' : opts.greeting
  if (greeting !== null) reply(`${greeting}\r\n`)
  return server
}

export interface FakeMessage {
  header: string | Buffer
  text: string | Buffer
}

export interface MailboxScript {
  /** CAPABILITY answer (without "* CAPABILITY ") */
  caps?: string
  /** LOGIN: 'OK', or the text after "NO " */
  login?: 'OK' | string
  /** EXAMINE: 'OK', or the text after "NO " */
  examine?: 'OK' | string
  exists?: number
  search?: number[]
  messages?: Record<number, FakeMessage>
}

/** Expands "3:5,9" into [3, 4, 5, 9]. */
function seqNumbers(set: string): number[] {
  const out: number[] = []
  for (const part of set.split(',')) {
    const [a, b] = part.split(':').map(Number)
    for (let n = a; n <= (b ?? a); n++) out.push(n)
  }
  return out
}

const bytes = (v: string | Buffer): Buffer => (Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'))

/** A well-behaved server for one mailbox: answers each read-only command the way real servers do. */
export function mailboxServer(script: MailboxScript = {}): FakeImapOptions['onCommand'] {
  return (cmd, reply, server) => {
    const word = cmd.text.split(' ')[0].toUpperCase()
    const { tag } = cmd
    if (word === 'CAPABILITY') return reply(`* CAPABILITY ${script.caps ?? 'IMAP4rev1 ID'}\r\n${tag} OK CAPABILITY completed\r\n`)
    if (word === 'LOGIN') {
      if ((script.login ?? 'OK') !== 'OK') return reply(`${tag} NO ${script.login}\r\n`)
      return reply(`${tag} OK [CAPABILITY ${script.caps ?? 'IMAP4rev1 ID'}] Logged in\r\n`)
    }
    if (word === 'ID') return reply(`* ID ("name" "FakeImap")\r\n${tag} OK ID completed\r\n`)
    if (word === 'EXAMINE') {
      if ((script.examine ?? 'OK') !== 'OK') return reply(`${tag} NO ${script.examine}\r\n`)
      return reply(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n* ${script.exists ?? 0} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] UIDs valid\r\n${tag} OK [READ-ONLY] EXAMINE completed\r\n`)
    }
    if (word === 'SEARCH') return reply(`* SEARCH${(script.search ?? []).map((n) => ` ${n}`).join('')}\r\n${tag} OK SEARCH completed\r\n`)
    if (word === 'FETCH') {
      const parts: Buffer[] = []
      for (const n of seqNumbers(cmd.text.split(' ')[1])) {
        const m = script.messages?.[n]
        if (!m) continue
        const header = bytes(m.header)
        const text = bytes(m.text)
        parts.push(
          Buffer.from(`* ${n} FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING AUTHENTICATION-RESULTS)] {${header.length}}\r\n`),
          header,
          Buffer.from(` BODY[TEXT]<0> {${text.length}}\r\n`),
          text,
          Buffer.from(')\r\n'),
        )
      }
      parts.push(Buffer.from(`${tag} OK FETCH completed\r\n`))
      return reply(Buffer.concat(parts))
    }
    if (word === 'LOGOUT') {
      reply(`* BYE FakeImap logging out\r\n${tag} OK LOGOUT completed\r\n`)
      return server.hangUp()
    }
    return reply(`${tag} BAD Unknown command\r\n`)
  }
}
