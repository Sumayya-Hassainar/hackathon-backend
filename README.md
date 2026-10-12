# GoodTurn Backend

A small Node.js HTTP API for the GoodTurn React frontend. It uses only Node.js built-in modules and stores posts in `data/opportunities.json`.

## Requirements
- Node.js 20 or newer recommended

## Run
```bash
npm run dev
```

The API runs at `http://localhost:3001`.

## Endpoints
- `GET /api/health`
- `GET /api/opportunities`
- `GET /api/opportunities?category=Repairs`
- `GET /api/opportunities?kind=Offer`
- `POST /api/opportunities` with JSON body:
```json
{
  "title": "Help with a garden",
  "description": "I can help weed your garden this weekend.",
  "category": "Garden",
  "neighborhood": "Maplewood North",
  "contact": "neighbor@example.com",
  "kind": "Offer"
}
```

The JSON data file and sample records are created automatically on first request.

## Frontend Vite proxy
In the frontend's `vite.config.js`, configure:
```js
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true
    }
  }
}
```

This is a local-development starter, not production-ready. For deployment, add authentication, abuse/rate limiting, privacy controls, and a database.
