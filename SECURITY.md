# Security policy

## Reporting a vulnerability

If you find a security issue in Pnyxy — anything that could expose user data,
bypass authentication, or abuse the hosted AI proxy — please **do not open a
public GitHub issue**. Email the maintainer instead:

**fokilenard@gmail.com**

Include enough detail to reproduce the issue (affected URL / endpoint, steps,
expected vs. actual behaviour). If you'd like an encrypted channel, say so in
your first mail and I'll share a key.

I aim to reply within 72 hours and to ship a fix (or have a clear plan) within
two weeks for anything high-severity. If you haven't heard back after a week,
assume the mail was eaten and ping me again.

## Scope

In-scope:

- The hosted Pnyxy web app (once a public URL exists)
- The open-source code in this repository
- Supabase migrations, Edge Functions, and storage policies shipped here

Out of scope:

- Third-party AI providers (Anthropic, OpenAI) — report to them directly
- Self-hosted deployments you run yourself
- Denial of service via spam / automation (rate limits are best-effort)

## Safe harbour

Good-faith security research on the hosted app is welcome. Please avoid data
exfiltration beyond what's needed to prove the issue, and don't touch other
users' accounts or content. I won't pursue legal action against researchers
who follow these rules.
