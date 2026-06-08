export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const DFS_AUTH = 'Basic ' + Buffer.from(
  process.env.DFS_LOGIN + ':' + process.env.DFS_PASSWORD
).toString('base64');

async function fetchGoogleReviews(url) {
  const response = await fetch('https://api.dataforseo.com/v3/reviews/google/search', {
    method: 'POST',
    headers: {
      'Authorization': DFS_AUTH,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      url: url,
      limit: 100,
      sort_by: 'most_relevant'
    }])
  });
  const data = await response.json();
  if (!data.tasks || !data.tasks[0] || !data.tasks[0].result) {
    throw new Error('No review data returned from DataForSEO');
  }
  const items = data.tasks[0].result[0].items || [];
  return items.map(function(item) {
    return (item.author_title || 'Reviewer') + ': ' + (item.review_text || '');
  }).filter(function(r) { return r.trim().length > 10; }).join('\n\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.body.action;

  if (action === 'fetch_reviews') {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL required' });
      const reviews = await fetchGoogleReviews(url);
      return res.status(200).json({ reviews });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  try {
    const { action: _action, ...body } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
