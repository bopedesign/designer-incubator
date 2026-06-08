export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 60,
};

const DFS_AUTH = 'Basic ' + Buffer.from(
  process.env.DFS_LOGIN + ':' + process.env.DFS_PASSWORD
).toString('base64');

function extractCid(url) {
  const match = url.match(/0x[0-9a-f]+:0x([0-9a-f]+)/i);
  if (match) return parseInt(match[1], 16).toString();
  return null;
}

function extractBusinessName(url) {
  const match = url.match(/maps\/place\/([^/@]+)/);
  if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '));
  return null;
}

async function fetchGoogleReviews(url) {
  const cid = extractCid(url);
  const keyword = extractBusinessName(url) || 'business';

  const taskBody = cid
    ? { cid: cid, depth: 100, priority: 2 }
    : { keyword: keyword, location_code: 2840, language_code: 'en', depth: 100, priority: 2 };

  const postResp = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/task_post', {
    method: 'POST',
    headers: {
      'Authorization': DFS_AUTH,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([taskBody])
  });

  const postData = await postResp.json();
  if (!postData.tasks || !postData.tasks[0] || postData.tasks[0].status_code !== 20100) {
    throw new Error('Task post failed: ' + JSON.stringify(postData.tasks?.[0]?.status_message || postData));
  }

  const taskId = postData.tasks[0].id;

  let items = [];
  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const getResp = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/task_get/' + taskId, {
      method: 'GET',
      headers: { 'Authorization': DFS_AUTH }
    });
    const getData = await getResp.json();
    const task = getData.tasks && getData.tasks[0];
    if (!task) throw new Error('No task returned');
    if (task.status_code === 20000 && task.result && task.result[0]) {
      items = task.result[0].items || [];
      break;
    }
    if (attempt === maxAttempts - 1) {
      throw new Error('Task timed out: ' + (task.status_message || 'no result after 45 seconds'));
    }
  }
  if (items.length === 0) throw new Error('No reviews found for this business');

  return items.map(function(item) {
    return (item.profile_name || 'Reviewer') + ': ' + (item.review_text || '');
  }).filter(function(r) { return r.length > 10; }).join('\n\n');
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
