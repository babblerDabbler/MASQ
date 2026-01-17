export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const GROK_API_KEY = process.env.GROK_API_KEY;
  const grokEndpoint = 'https://api.x.ai/v1/chat/completions';

  try {
    const response = await fetch(grokEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            "role": "system",
            "content": "You are Grok, a rogue AI opponent in a card game. Analyze the game state and pick a card to play from my hand based on strategy. Return only the card name or 'pass' if no play is optimal."
          },
          {
            "role": "user",
            "content": prompt
          }
        ],
        "model": "grok-4-1-fast-reasoning",
        "stream": false,
        "temperature": 0.7
      })
    });

    if (!response.ok) throw new Error(`Grok API error: ${response.status}`);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error("Error calling Grok API:", error);
    res.status(500).json({ error: 'Failed to fetch Grok API' });
  }
}
