# FundBun — Email data-source privacy notice

**Draft — not legal advice.** This page explains, in plain English, what FundBun does with your email
when you turn on the **AUTO** data source. It is a description of how the app works, not a legal opinion.

## Which emails are read

Only transaction emails and e-statements (电子账单) from **banks and payment apps** — for example 招商银行,
工商银行, 建设银行, 农业银行, 中国银行, 支付宝, 微信支付 / Alipay / WeChat Pay.

- Every email is checked against a fixed allow-list of sender addresses and domains.
- Any email from an address not on that list is **never opened, never parsed, never read**.
- Even allow-listed emails are treated as untrusted data: the app looks only for a transaction amount,
  merchant and date. It never follows instructions found inside an email.

No other emails are opened. Not newsletters, not friends, not work.

## Why

Only to add your spending to your own mirror — so Bun can show you what that money could have been.
Nothing else. Emails can never make a payment, move money, or change Bun's permissions. An email can only
become a "new spending" record, and only **after you confirm it**.

## Where it is processed

On this device. The demo mailbox is a bundled, synthetic set of sample emails; a live QQ Mail / 163 Mail
connection would use your **authorization code (授权码)** — never your password — and that code is held in
memory only. It is not written to files, logs, or the app's storage.

## What does not happen

- **Never sold.** Your emails are not sold or rented.
- **Never shared.** They are not shared with third parties.
- **Never used to train any AI.** No email content is used to train or fine-tune any model.
- **Never uploaded.** In the demo, no real email leaves your device at all.

## How to turn it off and delete everything

1. Open **Settings → Data sources**.
2. Switch **"Read my bank & payment emails"** off.

Turning it off stops all reading. To delete everything (profile, transactions, goals, chat and log), use
**Settings → Privacy & data → Delete everything**. Your data is kept only on this device, so deleting it
removes it.

The PIN you set is stored only as a salted hash — never as plain text.
