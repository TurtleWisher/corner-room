/*
 * Offline library and player for /offline.html (D-AUDIO-18). Plain script so it runs with no
 * connection and no app bundle. Reads the songs the app saved (apps/web/lib/offline-store.ts: keep
 * DB_NAME, DB_VERSION, STORE and OWNER_KEY in step) for the account marked as signed in here.
 */
(function () {
  "use strict";

  var DB_NAME = "cornerroom-offline";
  var DB_VERSION = 1;
  var STORE = "songs";
  var OWNER_KEY = "cr-offline-owner";

  var list = document.getElementById("songs");
  var empty = document.getElementById("empty");
  var connection = document.getElementById("connection");
  var bar = document.getElementById("bar");
  var nowTitle = document.getElementById("now-title");
  var toggle = document.getElementById("toggle");
  var seek = document.getElementById("seek");
  var elapsed = document.getElementById("elapsed");
  var duration = document.getElementById("duration");
  var audio = document.getElementById("audio");

  var songs = [];
  var current = -1;
  var currentUrl = null;
  var coverUrls = [];

  function owner() {
    try {
      return localStorage.getItem(OWNER_KEY);
    } catch {
      return null;
    }
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no indexedDB"));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "trackId" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function withStore(mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = work(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(req.result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function clock(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function showConnection() {
    // Shown at another address = the service worker's fallback: Corner Room couldn't be reached,
    // even if this device has some connection.
    var fallback = location.pathname !== "/offline.html";
    connection.textContent = !navigator.onLine
      ? "Offline. Playing from this device."
      : fallback
        ? "Corner Room can't be reached right now. Playing from this device."
        : "Online. Saved songs still play from this device.";
  }

  function render() {
    coverUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    coverUrls = [];
    list.textContent = "";
    empty.hidden = songs.length > 0;
    songs.forEach(function (song, index) {
      var li = document.createElement("li");
      var art;
      if (song.cover) {
        art = document.createElement("img");
        var cu = URL.createObjectURL(song.cover);
        coverUrls.push(cu);
        art.src = cu;
        art.alt = "";
      } else {
        art = document.createElement("span");
        art.className = "art";
        art.setAttribute("aria-hidden", "true");
      }
      var title = document.createElement("span");
      title.className = "title";
      title.textContent = song.title;
      var play = document.createElement("button");
      play.type = "button";
      play.className = "play";
      play.textContent = index === current && !audio.paused ? "Playing" : "Play";
      play.setAttribute("aria-label", "Play " + song.title);
      play.addEventListener("click", function () { start(index); });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + song.title + " from this device");
      remove.addEventListener("click", function () { forget(index); });
      li.appendChild(art);
      li.appendChild(title);
      li.appendChild(play);
      li.appendChild(remove);
      list.appendChild(li);
    });
  }

  function start(index) {
    var song = songs[index];
    if (!song) return;
    current = index;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(song.audio);
    audio.src = currentUrl;
    audio.play().catch(function () { /* the user can press play again */ });
    nowTitle.textContent = song.title;
    bar.hidden = false;
    if ("mediaSession" in navigator) {
      var artwork = [];
      try {
        if (song.cover) artwork.push({ src: URL.createObjectURL(song.cover), sizes: "480x480", type: song.cover.type || "image/jpeg" });
      } catch { /* no artwork */ }
      navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: "Corner Room", artwork: artwork });
    }
    render();
  }

  function step(delta) {
    if (!songs.length) return;
    start((current + delta + songs.length) % songs.length);
  }

  function forget(index) {
    var song = songs[index];
    if (!song) return;
    withStore("readwrite", function (s) { return s.delete(song.trackId); }).then(function () {
      if (index === current) {
        audio.pause();
        bar.hidden = true;
        current = -1;
      } else if (index < current) {
        current -= 1;
      }
      songs.splice(index, 1);
      render();
    });
  }

  toggle.addEventListener("click", function () {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  });
  document.getElementById("prev").addEventListener("click", function () {
    if (audio.currentTime > 3) audio.currentTime = 0;
    else step(-1);
  });
  document.getElementById("next").addEventListener("click", function () { step(1); });
  seek.addEventListener("input", function () { audio.currentTime = Number(seek.value); });
  audio.addEventListener("play", function () { toggle.textContent = "Pause"; toggle.setAttribute("aria-label", "Pause"); render(); });
  audio.addEventListener("pause", function () { toggle.textContent = "Play"; toggle.setAttribute("aria-label", "Play"); render(); });
  audio.addEventListener("loadedmetadata", function () { seek.max = String(Math.floor(audio.duration || 0)); duration.textContent = clock(audio.duration); });
  audio.addEventListener("timeupdate", function () { seek.value = String(Math.floor(audio.currentTime)); elapsed.textContent = clock(audio.currentTime); });
  audio.addEventListener("ended", function () { if (current < songs.length - 1) step(1); });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
    navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
    navigator.mediaSession.setActionHandler("previoustrack", function () { step(-1); });
    navigator.mediaSession.setActionHandler("nexttrack", function () { step(1); });
  }
  window.addEventListener("online", showConnection);
  window.addEventListener("offline", showConnection);
  showConnection();

  var who = owner();
  withStore("readonly", function (s) { return s.getAll(); })
    .then(function (all) {
      songs = (all || [])
        .filter(function (song) { return who && song.userId === who; })
        .sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
      render();
    })
    .catch(function () {
      songs = [];
      render();
    });
})();
