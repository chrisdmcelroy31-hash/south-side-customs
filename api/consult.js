// Vercel Function: receives the consult form and emails it to the shop via Resend.
// Env vars:
//   RESEND_API_KEY      provisioned by the Resend integration
//   CONSULT_TO_EMAIL    inbox that receives consult requests
//   CONSULT_FROM_EMAIL  optional; a sender on a domain verified in Resend

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (body, status = 200) => Response.json(body, { status });

export async function POST(request) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Send the form as JSON.' }, 400);
  }

  // honeypot: real people never see or fill this field
  if (data.company) return json({ ok: true });

  const name = String(data.name ?? '').trim().slice(0, 120);
  const email = String(data.email ?? '').trim().slice(0, 200);
  const idea = String(data.idea ?? '').trim().slice(0, 4000);
  const build = String(data.build ?? '').trim().slice(0, 600);

  if (!name) return json({ error: 'Add your name so we know who to call.', field: 'name' }, 422);
  if (!EMAIL_RE.test(email)) return json({ error: 'Add an email address we can reply to.', field: 'email' }, 422);

  const { RESEND_API_KEY, CONSULT_TO_EMAIL, CONSULT_FROM_EMAIL } = process.env;
  if (!RESEND_API_KEY || !CONSULT_TO_EMAIL) {
    console.error('consult: RESEND_API_KEY or CONSULT_TO_EMAIL is not set');
    return json({ error: 'The consult form is not set up yet. Call the shop instead.' }, 503);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: CONSULT_FROM_EMAIL || 'South Side Customs site <onboarding@resend.dev>',
      to: CONSULT_TO_EMAIL.split(',').map((s) => s.trim()),
      reply_to: email,
      subject: `Build consult request from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nWhat they want built:\n${idea || '(left blank)'}${build ? `\n\nBuild from the spec sheet:\n${build}` : ''}`,
      html: `<p><strong>Name:</strong> ${esc(name)}<br><strong>Email:</strong> ${esc(email)}</p>
<p><strong>What they want built:</strong></p><p style="white-space:pre-wrap">${esc(idea) || '<em>left blank</em>'}</p>${build ? `<p><strong>Build from the spec sheet:</strong><br>${esc(build)}</p>` : ''}`,
    }),
  });

  if (!res.ok) {
    console.error('consult: Resend responded', res.status, await res.text());
    return json({ error: "The request didn't go through. Try again in a minute." }, 502);
  }
  return json({ ok: true });
}
