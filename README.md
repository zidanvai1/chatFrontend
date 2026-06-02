# Hush Frontend (static)

Pure HTML/CSS/JS. No build step. Deploy to Netlify, Vercel (static), Cloudflare Pages, GitHub Pages, or any static host.

## Configure

Edit **`config.json`** and set `wsUrl` to your backend WebSocket URL:

```json
{
  "wsUrl": "wss://your-backend.onrender.com/ws"
}
```

For local dev with the backend on `localhost:3000`, leave it as `ws://localhost:3000/ws`.

## Deploy

Just upload the folder. Examples:

- **Netlify**: drag-and-drop the `frontend/` folder.
- **Cloudflare Pages**: create a project, upload the folder.
- **GitHub Pages**: push folder contents to a repo, enable Pages.
- **Any cPanel / shared hosting**: upload all files to `public_html/`.

## Usage

- `https://yourdomain.com/` — landing page (enter name + room).
- `https://yourdomain.com/?roomname` — directly opens that room.
- First user becomes **admin**. Admins can change message retention, empty-room reset, transfer admin, and clear history.
- If the room is empty for the configured time, it resets (history wiped).

## Notes

- Voice / file / call data goes peer-to-peer over WebRTC (audio + video calls + large files).
- Text + voice notes + small files (≤200KB) flow through the signaling server so late joiners get history.
