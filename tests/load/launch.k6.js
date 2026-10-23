// Launch load test (deploy readiness, 2026-10-23): 200 people browsing, signing in and listening at
// once. Run it against the private STAGING copy, never the live site (it signs up accounts).
//
//   k6 run -e BASE_URL=<staging address> tests/load/launch.k6.js
//
// Listening needs accounts that may play the song (a plan or a purchase). On staging, create
// listeners load1@example.com ... load200@example.com with one password (LISTEN_PASSWORD) and give
// them access, then pass TRACK_ID. Without TRACK_ID only browsing and sign-ups run.
//   -e TRACK_ID=<released track id> -e LISTEN_PASSWORD=... -e LISTENERS=200 -e SIGNUPS=1
//
// Pass mark used here (adjust after the first run, it is a measurement, not a business rule):
// fewer than 1% failed requests, and 95% of API calls under 1.5 s.

import http from "k6/http";
import { check, sleep } from "k6";

const BASE = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const API = `${BASE}/api/v1`;
const LISTENERS = Number(__ENV.LISTENERS || 200);
const JSON_HEADERS = { "Content-Type": "application/json", Origin: BASE };

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      exec: "browse",
      stages: [
        { duration: "1m", target: 100 },
        { duration: "3m", target: 200 },
        { duration: "1m", target: 0 },
      ],
    },
    ...(__ENV.TRACK_ID
      ? { listen: { executor: "per-vu-iterations", exec: "listen", vus: LISTENERS, iterations: 1, maxDuration: "10m" } }
      : {}),
    ...(__ENV.SIGNUPS === "1"
      ? { signup: { executor: "shared-iterations", exec: "signup", vus: 20, iterations: 200, maxDuration: "5m" } }
      : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:api}": ["p(95)<1500"],
  },
};

const api = { tags: { kind: "api" } };

export function browse() {
  const pages = ["/", "/events", "/releases", "/tracks", "/store"];
  check(http.get(`${BASE}${pages[Math.floor(Math.random() * pages.length)]}`), { "page 200": (r) => r.status === 200 });
  check(http.get(`${API}/events`, api), { "events 200": (r) => r.status === 200 });
  check(http.get(`${API}/offers`, api), { "offers 200": (r) => r.status === 200 });
  check(http.get(`${API}/playback/catalog`, api), { "catalog 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 3);
}

export function signup() {
  const id = `${Date.now()}-${__VU}-${__ITER}`;
  const res = http.post(
    `${API}/auth/register`,
    JSON.stringify({ email: `load-${id}@example.com`, password: "load-test-password-1", display_name: "Load test" }),
    { headers: JSON_HEADERS, ...api },
  );
  check(res, { "register 201": (r) => r.status === 201 });
}

export function listen() {
  const email = `load${__VU}@example.com`;
  const login = http.post(`${API}/auth/login`, JSON.stringify({ email, password: __ENV.LISTEN_PASSWORD }), { headers: JSON_HEADERS, ...api });
  if (!check(login, { "login 200": (r) => r.status === 200 })) return;
  const auth = { headers: { Authorization: `Bearer ${login.json("access_token")}` }, ...api };
  const audio = http.get(`${API}/playback/tracks/${__ENV.TRACK_ID}/audio?accept=opus,mp3`, auth);
  if (!check(audio, { "audio link 200": (r) => r.status === 200 })) return;
  const url = audio.json("url");
  const media = url.startsWith("http") ? url : `${BASE}${url}`;
  // Fetch the song in 256 KiB ranges, about as a player would while it plays.
  for (let start = 0; start < 8 * 262144; start += 262144) {
    const part = http.get(media, { headers: { Range: `bytes=${start}-${start + 262143}` }, tags: { kind: "media" } });
    if (!check(part, { "media 206/200": (r) => r.status === 206 || r.status === 200 })) return;
    if (part.status === 200) break;
    sleep(2);
  }
}
