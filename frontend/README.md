Frontend (React + Vite)

Quick start inside the `frontend` folder:

1) Install dependencies (requires Node.js >=16):

```bash
cd frontend
npm install
```

2) Start dev server:

```bash
npm run dev
```

3) Open the page at the address shown by Vite (usually http://localhost:5173).

Notes for beginners:
- The frontend expects the backend to be proxied or served at the same origin. For local testing, run the backend (`./venv/bin/python app.py`) and then use a browser extension or a reverse proxy to forward `/generate` to `http://127.0.0.1:8000/generate`, or run the frontend with `vite` and configure a `proxy` in `vite.config.js` if desired.
