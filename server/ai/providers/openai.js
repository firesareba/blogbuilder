"use strict";

async function chat({ apiKey, systemPrompt, userPrompt, model, baseUrl }) {
  const url = `${baseUrl || "https://api.openai.com/v1"}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || res.statusText;
    throw new Error(`OpenAI-compatible API error: ${msg}`);
  }
  return data.choices?.[0]?.message?.content || "";
}

module.exports = { chat };
