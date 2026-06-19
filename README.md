# NovaTalk

Minimal messenger inspired by Discord flows and Apple-style UI.

## Stack

- React + TypeScript + Vite
- Express + Socket.IO
- SQLite for local storage
- Local file uploads for avatars and attachments
- WebRTC signaling for direct voice/video calls

## Features

- registration and login
- unique `@username` with reusable display names
- friend requests with accept/decline flow
- automatic direct messages after friendship
- group chats with optional group avatar
- file uploads, image messages, and voice messages
- profile avatars and minimal profile settings
- light and dark theme
- direct-call UI with mute and camera toggles

## Run

```bash
cmd /c npm install
cmd /c npm run db:generate
cmd /c npm run db:push
cmd /c npm run dev
```

Open: `http://localhost:5173`

API health: `http://localhost:3001/health`

## Notes

- Data is stored locally in `server/data/messenger.db`.
- Uploaded avatars and attachments are stored in `server/uploads`.
- `db:generate` and `db:push` are safe no-op helpers now because the SQLite schema initializes automatically when the server starts.
- Direct calls currently use browser WebRTC signaling and are best suited for 1-to-1 chats in this MVP.
