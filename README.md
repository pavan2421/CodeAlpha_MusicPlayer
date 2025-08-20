#  Music Player

A modern, responsive **music player** with **Node.js/Express backend** and **HTML/CSS/JS frontend**.

## Features
- **Audio Handling:** HTML5 `<audio>` + JavaScript controls (play/pause/seek/volume, next/prev, queue).
- **Backend (Node.js/Express):**
  - Upload audio files with `multer` and store on server.
  - Extract metadata (title/artist/album/genre/duration) via `music-metadata` (best-effort).
  - Stream audio with **Range** support: `GET /api/music/stream/:id`.
  - Manage tracks (list, delete) and **URL-based tracks**.
  - **Playlists CRUD** stored in a simple JSON DB.
- **Frontend:**
  - Library with search + genre/artist filters.
  - Queue management and now playing panel.
  - Playlist creation/rename/delete and add tracks to playlists.
  - Light/Dark theme (persists in localStorage).
- **State Management:** Frontend maintains `tracks`, `queue`, `currentIndex`, and `playlists` (fetched from backend).
- **DOM Manipulation & Media APIs:** Vanilla JS updates UI and uses `<audio>` Media API.

> Optional: You can later switch to **MongoDB** or **Firebase** for storage, and/or **React** for the UI. The API layer is already separated.

## Project Structure
```
fullstack-music-player/
│── backend/
│   ├── server.js          # Express server + APIs
│   ├── routes/            # (reserved for modularization)
│   ├── uploads/           # Uploaded audio files
│   └── db.json            # JSON database (auto-created)
│── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
│── package.json
```

## Run Locally
```bash
# 1) Install dependencies
npm install

# 2) Start server
npm start
# Server runs at http://localhost:3000 and serves the frontend too
```

Then open **http://localhost:3000** in your browser.

## API Summary
- `POST /api/music/upload` — multipart form data: `files[]`
- `POST /api/music/url` — JSON `{ url, title?, artist?, album?, genre? }`
- `GET /api/music` — list tracks
- `DELETE /api/music/:id` — delete a track (removes file and unlinks from playlists)
- `GET /api/music/stream/:id` — stream local uploaded track
- `GET /api/playlists` — list playlists
- `POST /api/playlists` — `{ name }`
- `PUT /api/playlists/:id` — `{ name }`
- `DELETE /api/playlists/:id`
- `POST /api/playlists/:id/tracks` — `{ trackId }`
- `DELETE /api/playlists/:id/tracks/:trackId`

## Notes
- **Metadata** extraction is best-effort; if tags are missing, filename pattern `Artist - Title [Genre].mp3` is used as a hint.
- **Security**: This sample app allows uploads without auth; *don’t deploy publicly as-is.* Add auth, file size/type checks, and rate limiting.
- **CORS**: Not needed when frontend is served by the same Express app. If you host separately, enable CORS appropriately.

## Upgrade Ideas
- Drag-and-drop reorder of queue and playlists.
- Waveform/visualizer with Web Audio API.
- Switch to **MongoDB**/**Firebase**.
- Convert UI to **React** while reusing the same API.
