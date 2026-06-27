// PhysioAI · Therapist frontend — minimal static server with a WASM-friendly CSP.
//
// Why this exists: Railway's built-in static server sends a CSP whose script-src
// lacks 'wasm-unsafe-eval', which makes the browser BLOCK WebAssembly compilation →
// MediaPipe pose model fails to load ("Model failed") → no pose detection.
// Serving through Node lets us set the CSP ourselves (with 'wasm-unsafe-eval') so the
// vendored MediaPipe WASM can compile. Same files, just correct headers.
const express = require('express');
const path = require('path');

const app = express();

app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob: https: *; " +
    "style-src 'self' 'unsafe-inline' https: *; " +
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https: *; " +
    "font-src 'self' data: https: *; " +
    "connect-src 'self' https: *; " +
    "media-src 'self' blob: https: *; " +
    "worker-src 'self' blob:; " +
    "object-src 'none'; frame-src 'self' https: *;"
  );
  next();
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('PhysioAI Therapist frontend on :' + port));
