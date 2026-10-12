import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'data');
const dataFile = path.join(dataDir, 'opportunities.json');
const port = Number(process.env.PORT || 3001);

const allowedCategories = new Set([
  'Repairs',
  'Food',
  'Learning',
  'Rides',
  'Garden',
]);

const allowedKinds = new Set(['Ask', 'Offer']);

const sampleItems = [
  {
    title: 'Can someone help tune up my bike?',
    description:
      'The gears have started slipping ahead of my commute. Happy to bring it by and lend a hand too.',
    category: 'Repairs',
    neighborhood: 'Maplewood North',
    contact: 'maya@example.com',
    kind: 'Ask',
  },
  {
    title: 'Fresh herbs for your kitchen',
    description:
      'My garden is overflowing with basil and mint. Take a bunch, and I can share a few easy recipes.',
    category: 'Garden',
    neighborhood: 'Oak Street',
    contact: 'jo@example.com',
    kind: 'Offer',
  },
  {
    title: 'Practice conversational Spanish',
    description:
      'Looking for a friendly weekly practice buddy. I can help with beginner guitar in return.',
    category: 'Learning',
    neighborhood: 'Maplewood South',
    contact: 'alex@example.com',
    kind: 'Ask',
  },
  {
    title: 'Extra seat to the farmers market',
    description:
      'Driving over Saturday morning and have room for one more. Let’s split the parking.',
    category: 'Rides',
    neighborhood: 'Cedar Court',
    contact: 'sam@example.com',
    kind: 'Offer',
  },
  {
    title: 'Soup for a busy week',
    description:
      'I made a big pot of lentil soup. I have two extra portions for anyone nearby who could use dinner.',
    category: 'Food',
    neighborhood: 'Maplewood North',
    contact: 'lee@example.com',
    kind: 'Offer',
  },
  {
    title: 'Borrow a drill for the afternoon?',
    description:
      'Putting up a shelf and only need a drill for an hour. I can return it this evening.',
    category: 'Repairs',
    neighborhood: 'Pine Lane',
    contact: 'nia@example.com',
    kind: 'Ask',
  },
].map((item, index) => ({
  ...item,
  id: randomUUID(),
  createdAt: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
}));

let writeQueue = Promise.resolve();

async function writeItems(items) {
  await mkdir(dataDir, { recursive: true });

  const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, dataFile);
}

async function readItems() {
  await mkdir(dataDir, { recursive: true });

  try {
    const raw = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error('The opportunities data file must contain a JSON array.');
    }

    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await writeItems(sampleItems);
    return sampleItems;
  }
}

// Serialize read-modify-write operations to avoid losing posts from overlapping
// requests while the app is running in a single Node process.
function updateItems(updater) {
  const operation = writeQueue.then(async () => {
    const items = await readItems();
    const result = await updater(items);
    return result;
  });

  writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk.toString('utf8');

    if (Buffer.byteLength(body, 'utf8') > 20_000) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('Invalid JSON request body.');
    error.status = 400;
    throw error;
  }
}

function validateOpportunity(body) {
  const item = {
    title: String(body.title ?? '').trim(),
    description: String(body.description ?? '').trim(),
    category: String(body.category ?? ''),
    neighborhood: String(body.neighborhood ?? '').trim(),
    contact: String(body.contact ?? '').trim(),
    kind: String(body.kind ?? ''),
  };

  const errors = {};

  if (item.title.length < 3 || item.title.length > 72) {
    errors.title = 'Headline must be between 3 and 72 characters.';
  }

  if (item.description.length < 3 || item.description.length > 500) {
    errors.description = 'Description must be between 3 and 500 characters.';
  }

  if (!allowedCategories.has(item.category)) {
    errors.category = 'Choose a valid category.';
  }

  if (!allowedKinds.has(item.kind)) {
    errors.kind = 'Choose Ask or Offer.';
  }

  if (item.neighborhood.length < 2 || item.neighborhood.length > 100) {
    errors.neighborhood = 'Neighborhood must be between 2 and 100 characters.';
  }

  if (
    item.contact.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.contact)
  ) {
    errors.contact = 'Enter a valid contact email address.';
  }

  return {
    item,
    errors,
    valid: Object.keys(errors).length === 0,
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return sendJson(response, 200, {
      status: 'ok',
      service: 'goodturn-api',
      timestamp: new Date().toISOString(),
    });
  }

  if (url.pathname !== '/api/opportunities') {
    return sendJson(response, 404, { error: 'API endpoint not found.' });
  }

  if (request.method === 'GET') {
    const category = url.searchParams.get('category');
    const kind = url.searchParams.get('kind');

    if (category && category !== 'All' && !allowedCategories.has(category)) {
      return sendJson(response, 400, { error: 'Invalid category filter.' });
    }

    if (kind && kind !== 'All' && !allowedKinds.has(kind)) {
      return sendJson(response, 400, { error: 'Invalid kind filter.' });
    }

    const items = await readItems();
    let filtered = items;

    if (category && category !== 'All') {
      filtered = filtered.filter((item) => item.category === category);
    }

    if (kind && kind !== 'All') {
      filtered = filtered.filter((item) => item.kind === kind);
    }

    filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return sendJson(response, 200, filtered);
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const validation = validateOpportunity(body);

    if (!validation.valid) {
      return sendJson(response, 400, {
        error: 'Please correct the submitted fields.',
        fields: validation.errors,
      });
    }

    const item = {
      ...validation.item,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await updateItems(async (items) => {
      items.unshift(item);
      await writeItems(items);
      return item;
    });

    return sendJson(response, 201, item);
  }

  response.setHeader('Allow', 'GET, POST');
  return sendJson(response, 405, { error: 'Method not allowed.' });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    sendJson(response, 404, {
      error: 'Not found. This server only provides the API.',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}]`, error);

    if (!response.headersSent) {
      sendJson(response, error.status || 500, {
        error: error.status ? error.message : 'Internal server error.',
      });
    } else {
      response.end();
    }
  }
});

server.listen(port, () => {
  console.log(`GoodTurn API running at http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});
