# Just Us — private Tom & Jerry chat

No database. Messages and online/offline status are stored in two plain
text (JSON) files on the server: `data/messages.txt` and `data/presence.txt`.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000 — pick "I'm Tom" in one browser tab and
"I'm Jerry" in another to try both sides.

## Deploy it for free (so Tom and Jerry can use it from anywhere)

This is a normal Node.js app, so GitHub Pages alone won't run it (GitHub
Pages only serves static files). Use a free host that runs Node instead,
e.g. **Render**:

1. Push this folder to a GitHub repo.
2. Go to render.com → New → Web Service → connect that repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy. Render gives you a URL like `https://just-us-xxxx.onrender.com`.
6. Share that URL with your friend — that's the whole app, frontend and
   backend together, at one link.

(Railway and Glitch work the same way if you'd rather use one of those.)

## A note on "temporary" storage

Free hosts like Render's free tier can wipe the filesystem on redeploys or
after long idle periods — which actually fits what you asked for: messages
aren't meant to be permanent, just held until both people clear them, or
until the server itself resets.
