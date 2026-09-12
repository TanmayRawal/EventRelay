# EventRelay Deployment Guide (100% Free Tier)

You can deploy EventRelay to the cloud in under 3 minutes using **Render** or **Railway**. Having a live deployed link on your resume and GitHub README (e.g., `https://eventrelay.onrender.com/health` and `https://eventrelay.onrender.com/metrics`) proves to Google recruiters that you ship real, production software.

---

## Method 1: Deploy with Render (1-Click Blueprint)

1. **Push your repository to GitHub** (`https://github.com/TanmayRawal/EventRelay`).
2. Go to [dashboard.render.com](https://dashboard.render.com) and log in with GitHub.
3. Click **New +** $\rightarrow$ **Blueprint**.
4. Connect your `EventRelay` repository.
5. Render will automatically read the `render.yaml` file in the root directory and create:
   * A **PostgreSQL Database** (`eventrelay-db`)
   * A **Redis Instance** (`eventrelay-redis`)
   * A **Web Service** (`eventrelay-api`)
6. Click **Apply**.
7. In ~2 minutes, Render will output your live URL:
   * API: `https://eventrelay-api.onrender.com`
   * Healthcheck: `https://eventrelay-api.onrender.com/health`
   * Prometheus Metrics: `https://eventrelay-api.onrender.com/metrics`

---

## Method 2: Deploy Frontend to Vercel (Optional)

If you want the interactive React dashboard hosted independently:
1. Go to [vercel.com](https://vercel.com) and import `TanmayRawal/EventRelay`.
2. Set **Root Directory** to `frontend`.
3. Framework Preset: **Vite**.
4. Set Environment Variable:
   * `VITE_API_URL`: Your deployed backend URL (e.g. `https://eventrelay-api.onrender.com`)
5. Click **Deploy**. Vercel gives you an instant live URL like `https://eventrelay.vercel.app`.

---

## Method 3: Deploy using Railway

1. Go to [railway.app](https://railway.app).
2. Click **New Project** $\rightarrow$ **Deploy from GitHub repo**.
3. Add a **PostgreSQL** database and a **Redis** database with 1 click.
4. Railway automatically links the connection environment variables (`DATABASE_URL` and `REDIS_URL`).
5. Click **Deploy**.
