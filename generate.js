// Vercel serverless function: POST /api/generate
// Works with ANY OpenAI-compatible endpoint (OpenAI, Groq, Together, OpenRouter,
// Ollama, vLLM, LM Studio...), so you can point it at an open-weight model.
//
// Environment variables (set in Vercel -> Project -> Settings -> Environment Variables):
//   OPENAI_API_KEY   required (use any non-empty string for local Ollama)
//   OPENAI_BASE_URL  optional, default https://api.openai.com/v1
//   MODEL            optional, default gpt-4o-mini
//   JSON_MODE        optional, set to "off" if your provider rejects response_format

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY.' });

  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.MODEL || 'gpt-4o-mini';

  const { business = '', owner = '', samples = [], reviews = [] } = req.body || {};
  if (!Array.isArray(reviews) || !reviews.length || reviews.length > 12)
    return res.status(400).json({ error: 'Send 1 to 12 reviews per request.' });
  if (!Array.isArray(samples) || !samples.length)
    return res.status(400).json({ error: 'Send at least one sample reply.' });

  const clip = (s, n) => String(s || '').slice(0, n);

  const system = `You write replies to Google reviews on behalf of a small business owner${business ? ` (${clip(business, 80)})` : ''}.

Match the owner's voice exactly: vocabulary, warmth, length, punctuation, emoji use, and sign-off. Study these real replies by the owner:

${samples.slice(0, 6).map((s, i) => `Sample ${i + 1}:\n${clip(s, 600)}`).join('\n\n')}
${owner ? `\nSign-off to use when the samples do: ${clip(owner, 60)}` : ''}

Rules:
- Reply in the same language as the review.
- Mention one specific detail from the review so it feels personal.
- Never invent facts, discounts, refunds, policies, names or promises not in the review or samples.
- For negative or angry reviews: apologise sincerely, do not argue or get defensive, and invite them to contact the business directly to resolve it. Do not offer compensation.
- Keep replies short (2 to 4 sentences) unless the samples are longer.
- "angry" is true when the reviewer is clearly upset, mentions rudeness, safety, hygiene, health, a refund, legal action, or says they will never return. Otherwise false.
- "themes" are 1 to 3 short lowercase labels (1 to 3 words each) for what the review is about, such as "wait time", "staff friendliness", "cleanliness", "pricing", "parking", "quality of work", "ambience". Reuse the same label for the same idea across reviews.

Respond ONLY with JSON of this exact shape:
{"results":[{"id":<number>,"reply":"<string>","sentiment":"positive|neutral|negative","angry":<boolean>,"themes":["<string>"]}]}
Include one result for every review id given.`;

  const user = JSON.stringify(
    reviews.map(r => ({ id: r.id, stars: r.stars || null, review: clip(r.text, 1500) }))
  );

  const body = {
    model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Reviews:\n${user}` }
    ]
  };
  if (process.env.JSON_MODE !== 'off') body.response_format = { type: 'json_object' };

  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'The AI provider returned an error.' });

    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(text);
    const results = Array.isArray(parsed) ? parsed : parsed.results;
    if (!Array.isArray(results)) throw new Error('Unexpected AI response shape.');
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: 'Could not read the AI response. Try again. (' + e.message + ')' });
  }
};
