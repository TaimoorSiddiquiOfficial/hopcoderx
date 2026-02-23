// SMTP email service using cloudflare:sockets (STARTTLS / SMTPS)
// Works with any SMTP relay: SendGrid, Mailgun, SES, etc.
// Falls back silently when SMTP is not configured.

// @ts-ignore — available via nodejs_compat flag
import { connect as cfConnect } from 'cloudflare:sockets'

export type MailMsg = {
  to: string | string[]
  subject: string
  text: string
  html?: string
}

type SmtpCfg = {
  smtp_host?: string
  smtp_port?: string
  smtp_user?: string
  smtp_pass?: string
  smtp_from?: string
}

// Returns end-of-reply offset in buf, or -1 if reply not yet complete.
// SMTP replies: continuation lines start with "ddd-", last line with "ddd ".
function replyEnd(buf: string): number {
  let pos = 0
  while (true) {
    const eol = buf.indexOf('\r\n', pos)
    if (eol === -1) return -1
    const line = buf.substring(pos, eol)
    pos = eol + 2
    if (!/^\d{3}-/.test(line)) return pos
  }
}

export async function sendEmail(
  cfg: SmtpCfg,
  msg: MailMsg,
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass || !cfg.smtp_from) {
    return { ok: false, error: 'SMTP not configured' }
  }

  const port = parseInt(cfg.smtp_port || '587')
  const ssl = port === 465
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const to = Array.isArray(msg.to) ? msg.to : [msg.to]

  try {
    // Initial connection
    let socket = cfConnect(
      { hostname: cfg.smtp_host, port },
      { secureTransport: ssl ? 'on' : 'starttls' } as any,
    )
    let reader = socket.readable.getReader()
    let writer = socket.writable.getWriter()
    let buf = ''

    async function read(): Promise<string> {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const end = replyEnd(buf)
        if (end !== -1) {
          const reply = buf.slice(0, end)
          buf = buf.slice(end)
          return reply
        }
        const { done, value } = await reader.read()
        if (done) throw new Error('Connection closed unexpectedly')
        buf += dec.decode(value, { stream: true })
      }
      throw new Error('SMTP read timeout')
    }

    async function send(line: string): Promise<void> {
      await writer.write(enc.encode(line + '\r\n'))
    }

    async function cmd(line: string, expect: number): Promise<string> {
      if (line) await send(line)
      const reply = await read()
      const code = parseInt(reply.slice(0, 3))
      if (code !== expect) throw new Error(`Expected ${expect}, got: ${reply.trim()}`)
      return reply
    }

    // Greeting
    await read()  // 220 …

    await cmd(`EHLO gateway`, 250)

    if (!ssl) {
      await cmd('STARTTLS', 220)
      // Upgrade to TLS
      const tls = socket.startTls()
      reader = tls.readable.getReader()
      writer = tls.writable.getWriter()
      buf = ''
      await cmd(`EHLO gateway`, 250)
    }

    // AUTH LOGIN
    await cmd('AUTH LOGIN', 334)
    await cmd(btoa(cfg.smtp_user), 334)
    await cmd(btoa(cfg.smtp_pass), 235)

    await cmd(`MAIL FROM:<${cfg.smtp_from}>`, 250)
    for (const addr of to) await cmd(`RCPT TO:<${addr}>`, 250)

    // Build MIME body
    const date = new Date().toUTCString()
    const msgId = `<${crypto.randomUUID()}@${cfg.smtp_host}>`
    const headers = [
      `From: ${cfg.smtp_from}`,
      `To: ${to.join(', ')}`,
      `Subject: ${msg.subject}`,
      `Date: ${date}`,
      `Message-ID: ${msgId}`,
      `MIME-Version: 1.0`,
    ]

    let body: string
    if (msg.html) {
      const boundary = crypto.randomUUID().replace(/-/g, '')
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
      body = [
        '',
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        '',
        msg.text,
        '',
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8`,
        '',
        msg.html,
        '',
        `--${boundary}--`,
      ].join('\r\n')
    } else {
      headers.push(`Content-Type: text/plain; charset=UTF-8`)
      body = '\r\n' + msg.text
    }

    // Escape lines starting with a dot (SMTP dot-stuffing)
    const payload = (headers.join('\r\n') + body)
      .split('\r\n')
      .map(l => l.startsWith('.') ? '.' + l : l)
      .join('\r\n')

    await cmd('DATA', 354)
    await writer.write(enc.encode(payload + '\r\n.\r\n'))
    const accepted = await read()
    const acceptCode = parseInt(accepted.slice(0, 3))
    if (acceptCode !== 250) throw new Error(`DATA rejected: ${accepted.trim()}`)

    await send('QUIT')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}
