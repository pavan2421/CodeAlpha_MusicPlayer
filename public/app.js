// Frontend for Full-Stack Music Player
// Uses backend APIs for tracks & playlists. Keeps theme in localStorage.

const API = {
  music: {
    list: () => fetch('/api/music').then(r=>r.json()),
    upload: (formData) => fetch('/api/music/upload', { method:'POST', body: formData }).then(r=>r.json()),
    addUrl: (payload) => fetch('/api/music/url', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
    del: (id) => fetch(`/api/music/${id}`, { method:'DELETE' }).then(r=>r.json()),
    streamUrl: (id) => `/api/music/stream/${id}`
  },
  playlists: {
    list: () => fetch('/api/playlists').then(r=>r.json()),
    create: (name) => fetch('/api/playlists', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name })}).then(r=>r.json()),
    rename: (id, name) => fetch(`/api/playlists/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name })}).then(r=>r.json()),
    del: (id) => fetch(`/api/playlists/${id}`, { method:'DELETE' }).then(r=>r.json()),
    addTrack: (id, trackId) => fetch(`/api/playlists/${id}/tracks`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ trackId })}).then(r=>r.json()),
    removeTrack: (id, trackId) => fetch(`/api/playlists/${id}/tracks/${trackId}`, { method:'DELETE' }).then(r=>r.json()),
  }
};

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// Elements
const audio = $("#audio");
const uploadForm = $("#uploadForm");
const fileInput = $("#fileInput");
const streamUrl = $("#streamUrl");
const addUrlBtn = $("#addUrlBtn");
const searchInput = $("#searchInput");
const genreFilter = $("#genreFilter");
const artistFilter = $("#artistFilter");
const trackList = $("#trackList");
const playlistList = $("#playlistList");
const newPlaylistBtn = $("#newPlaylistBtn");

const npTitle = $("#npTitle");
const npSubtitle = $("#npSubtitle");
const currentTimeEl = $("#currentTime");
const durationEl = $("#duration");
const seekBar = $("#seekBar");
const volumeBar = $("#volumeBar");
const playPauseBtn = $("#playPauseBtn");
const prevBtn = $("#prevBtn");
const nextBtn = $("#nextBtn");

const queueList = $("#queueList");
const clearQueueBtn = $("#clearQueueBtn");
const themeToggle = $("#themeToggle");

const tTrack = $("#trackItemTemplate");
const tPlaylist = $("#playlistItemTemplate");

const THEME_KEY = 'fullstack-player-theme';

// State
const state = {
  tracks: [],      // {id, type, src/path, title, artist, album, genre, duration}
  queue: [],       // array of track ids
  currentIndex: -1,
  playlists: {},   // {id:{id,name,trackIds:[]}}
};

// -------- Theme --------
function loadTheme() {
  const t = localStorage.getItem(THEME_KEY) || 'light';
  document.body.classList.toggle('light', t === 'light');
}
function saveTheme() {
  const t = document.body.classList.contains('light') ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, t);
}

// -------- Utilities --------
const uid = () => Math.random().toString(36).slice(2,9);
const fmtTime = (sec=0) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2,'0')}`;
};

function getTrackById(id){ return state.tracks.find(t => t.id === id); }

function rebuildFacetOptions() {
  const genres = new Set();
  const artists = new Set();
  state.tracks.forEach(t => { if (t.genre) genres.add(t.genre); if (t.artist) artists.add(t.artist); });
  const addOptions = (sel, values) => {
    const existing = new Set(Array.from(sel.options).map(o=>o.value));
    values.forEach(v => {
      if (!existing.has(v)) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      }
    });
  };
  addOptions(genreFilter, genres);
  addOptions(artistFilter, artists);
}

function filterTracks() {
  const q = searchInput.value.toLowerCase();
  const g = genreFilter.value;
  const a = artistFilter.value;
  return state.tracks.filter(t => {
    const textOk = !q || [t.title, t.artist, t.album].join(' ').toLowerCase().includes(q);
    const gOk = !g || t.genre === g;
    const aOk = !a || t.artist === a;
    return textOk && gOk && aOk;
  });
}

// -------- Rendering --------
function renderTrackList() {
  trackList.innerHTML = '';
  const items = filterTracks();
  items.forEach(t => {
    const node = tTrack.content.firstElementChild.cloneNode(true);
    node.dataset.id = t.id;
    node.querySelector('.item-title').textContent = t.title || 'Untitled';
    node.querySelector('.item-subtitle').textContent = [t.artist, t.album, t.genre].filter(Boolean).join(' • ');
    node.querySelector("[data-action='queue']").addEventListener('click', () => enqueueTrack(t.id));
    node.querySelector("[data-action='addToPlaylist']").addEventListener('click', () => addTrackToPlaylistFlow(t.id));
    node.querySelector("[data-action='delete']").addEventListener('click', async () => {
      if (!confirm('Delete this track?')) return;
      await API.music.del(t.id);
      await refreshAll();
    });
    node.querySelector('.item-main').addEventListener('click', () => enqueueTrack(t.id, { playNow: true }));
    trackList.appendChild(node);
  });
}

function renderQueue() {
  queueList.innerHTML = '';
  state.queue.forEach((id, idx) => {
    const t = getTrackById(id);
    if (!t) return;
    const li = document.createElement('li');
    li.className = 'item';
    const main = document.createElement('div'); main.className = 'item-main';
    const title = document.createElement('div'); title.className = 'item-title'; title.textContent = t.title || 'Untitled';
    const sub = document.createElement('div'); sub.className = 'item-subtitle'; sub.textContent = [t.artist, t.album].filter(Boolean).join(' • ');
    main.appendChild(title); main.appendChild(sub);
    const actions = document.createElement('div'); actions.className = 'item-actions';
    const playBtn = document.createElement('button'); playBtn.className = 'btn small'; playBtn.textContent = 'Play ▶️';
    playBtn.addEventListener('click', () => { state.currentIndex = idx; playCurrent(); });
    const remBtn = document.createElement('button'); remBtn.className = 'btn small danger'; remBtn.textContent = 'Remove';
    remBtn.addEventListener('click', () => {
      state.queue.splice(idx,1);
      if (idx === state.currentIndex) { audio.pause(); audio.currentTime = 0; state.currentIndex = -1; updateNowPlaying(null); }
      else if (idx < state.currentIndex) { state.currentIndex -= 1; }
      renderQueue();
    });
    actions.appendChild(playBtn); actions.appendChild(remBtn);
    li.appendChild(main); li.appendChild(actions); queueList.appendChild(li);
  });
}

function renderPlaylists() {
  playlistList.innerHTML = '';
  Object.values(state.playlists).forEach(pl => {
    const node = tPlaylist.content.firstElementChild.cloneNode(true);
    node.dataset.id = pl.id;
    node.querySelector('.item-title').textContent = pl.name;
    node.querySelector('.item-subtitle').textContent = `${pl.trackIds.length} tracks`;
    node.querySelector("[data-action='play']").addEventListener('click', () => {
      state.queue = pl.trackIds.slice();
      state.currentIndex = 0;
      renderQueue();
      playCurrent();
    });
    node.querySelector("[data-action='rename']").addEventListener('click', async () => {
      const name = prompt('Rename playlist', pl.name);
      if (name && name.trim()) {
        await API.playlists.rename(pl.id, name.trim());
        await refreshPlaylists();
      }
    });
    node.querySelector("[data-action='delete']").addEventListener('click', async () => {
      if (!confirm(`Delete playlist "${pl.name}"?`)) return;
      await API.playlists.del(pl.id);
      await refreshPlaylists();
    });
    playlistList.appendChild(node);
  });
}

// -------- Queue & Playback --------
function trackToSrc(t) {
  if (t.type === 'file') return API.music.streamUrl(t.id);
  if (t.type === 'url') return t.src;
  return '';
}

function enqueueTrack(id, opts={}) {
  const { playNow=false } = opts;
  if (playNow) {
    if (state.currentIndex === -1) { state.queue = [id]; state.currentIndex = 0; renderQueue(); playCurrent(); }
    else { state.queue.splice(state.currentIndex+1, 0, id); state.currentIndex += 1; renderQueue(); playCurrent(); }
  } else {
    state.queue.push(id); renderQueue();
    if (state.currentIndex === -1) { state.currentIndex = 0; playCurrent(); }
  }
}

function playCurrent() {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
    audio.pause(); updateNowPlaying(null); return;
  }
  const id = state.queue[state.currentIndex];
  const track = getTrackById(id);
  if (!track) { next(); return; }
  audio.src = trackToSrc(track);
  audio.play().catch(()=>{});
  updateNowPlaying(track);
}

function updateNowPlaying(track) {
  if (!track) {
    npTitle.textContent = 'Nothing playing';
    npSubtitle.textContent = '';
    durationEl.textContent = '0:00';
    currentTimeEl.textContent = '0:00';
    seekBar.value = 0;
    return;
  }
  npTitle.textContent = track.title || 'Untitled';
  npSubtitle.textContent = [track.artist, track.album, track.genre].filter(Boolean).join(' • ');
}

function next() {
  if (state.currentIndex < state.queue.length - 1) { state.currentIndex += 1; playCurrent(); }
  else { audio.pause(); }
}
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.currentIndex > 0) { state.currentIndex -= 1; playCurrent(); }
}

// -------- Playlists --------
async function ensurePlaylist(name) {
  const res = await API.playlists.create(name.trim());
  return res.playlist;
}

async function addTrackToPlaylistFlow(trackId) {
  const names = Object.values(state.playlists).map(p => p.name).join(', ');
  const choice = prompt(`Add to playlist.\nExisting: ${names || '(none)'}\nEnter playlist name (new or existing):`);
  if (!choice || !choice.trim()) return;
  let pl = Object.values(state.playlists).find(p => p.name.toLowerCase() === choice.trim().toLowerCase());
  if (!pl) pl = await ensurePlaylist(choice);
  await API.playlists.addTrack(pl.id, trackId);
  await refreshPlaylists();
  alert(`Added to "${pl.name}"`);
}

// -------- Events --------
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  await API.music.upload(fd);
  await refreshTracks();
  uploadForm.reset();
});

addUrlBtn.addEventListener('click', async () => {
  const url = streamUrl.value.trim();
  if (!url) return;
  await API.music.addUrl({ url });
  streamUrl.value = '';
  await refreshTracks();
});

searchInput.addEventListener('input', renderTrackList);
genreFilter.addEventListener('change', renderTrackList);
artistFilter.addEventListener('change', renderTrackList);

newPlaylistBtn.addEventListener('click', async () => {
  const name = prompt('New playlist name:');
  if (name && name.trim()) {
    await API.playlists.create(name.trim());
    await refreshPlaylists();
  }
});

clearQueueBtn.addEventListener('click', () => {
  state.queue = []; state.currentIndex = -1;
  renderQueue(); audio.pause(); updateNowPlaying(null);
});

playPauseBtn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

audio.addEventListener('loadedmetadata', () => { seekBar.max = audio.duration || 0; durationEl.textContent = fmtTime(audio.duration || 0); });
audio.addEventListener('timeupdate', () => {
  currentTimeEl.textContent = fmtTime(audio.currentTime || 0);
  if (!seekBar.dragging) seekBar.value = audio.currentTime || 0;
});
audio.addEventListener('ended', next);

seekBar.addEventListener('input', () => { seekBar.dragging = true; });
seekBar.addEventListener('change', () => { audio.currentTime = Number(seekBar.value || 0); seekBar.dragging = false; });

volumeBar.addEventListener('input', () => { audio.volume = Number(volumeBar.value); });

themeToggle.addEventListener('click', () => { document.body.classList.toggle('light'); saveTheme(); });

// -------- Refresh helpers --------
async function refreshTracks() {
  const res = await API.music.list();
  state.tracks = res.tracks || [];
  rebuildFacetOptions();
  renderTrackList();
  renderQueue();
}
async function refreshPlaylists() {
  const res = await API.playlists.list();
  state.playlists = res.playlists || {};
  renderPlaylists();
}

async function refreshAll() {
  await Promise.all([refreshTracks(), refreshPlaylists()]);
}

// -------- Init --------
loadTheme();
refreshAll();
