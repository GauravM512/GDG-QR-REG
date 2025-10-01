/* global ZXing */

const video = document.getElementById('preview');
const cameraSelect = document.getElementById('cameraSelect');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statsBox = document.getElementById('stats');
const modal = document.getElementById('modal');
const attendeeInfo = document.getElementById('attendeeInfo');
const statusBox = document.getElementById('statusBox');
const closeModalBtn = document.getElementById('closeModalBtn');
const manualCheckBtn = document.getElementById('manualCheckBtn');
const exportBtn = document.getElementById('exportBtn'); // Added

// Add configurable backend base URL (adjust host/port as needed)
const API_BASE = window.API_BASE_URL || (window.location.hostname === 'localhost' ? 'http://localhost:8000' : '');
function apiFetch(path, opts) { return fetch(`${API_BASE}${path}`, opts); }

// Camera error helper UI (injects a small red message above video)
const cameraErrorBox = document.getElementById('cameraError') || (() => {
  if (!video) return null;
  const d = document.createElement('div');
  d.id = 'cameraError';
  d.style.cssText = 'color:#b00020;font-size:0.9em;margin:4px 0;';
  video.parentNode.insertBefore(d, video);
  return d;
})();
function showCameraError(msg) { if (cameraErrorBox) cameraErrorBox.textContent = msg; console.error(msg); }

// Expect ZXing to be loaded via a script tag placed BEFORE this app.js:
// <script src="https://unpkg.com/@zxing/browser@latest"></script>
async function ensureZXingLoaded() {
  if (window.ZXing && (window.ZXing.BrowserMultiFormatReader || window.ZXing.MultiFormatReader)) return;
  showCameraError('ZXing library not loaded (expected @zxing/library).');
  throw new Error('ZXing not loaded');
}

async function ensureCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError('Camera API not supported in this browser.');
    return false;
  }
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    showCameraError('Unable to access camera: ' + e.name);
    return false;
  }
}

let codeReader;
let currentDeviceId = null;
let lastResult = null;
let scanning = false;
let lastModalTicket = null;
let lastStatus = null;
// Added: timestamp for last result and configurable interval to allow re-scan of same QR
let lastResultTime = 0;
const RESCAN_SAME_INTERVAL_MS = 3000; // adjust (ms) before allowing same code again

// Poll stats occasionally
async function loadStats() {
  try {
    const res = await apiFetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    statsBox.textContent = `Present: ${data.present_count}`;
  } catch (e) { /* ignore */ }
}
setInterval(loadStats, 8000);
loadStats();

async function listCameras() {
  try { await ensureZXingLoaded(); } catch (e) { console.error(e); return; }
  // Initialize reader only once
  if (!codeReader) {
    codeReader = new ZXing.BrowserMultiFormatReader();
  }
  const permitted = await ensureCameraPermission();
  if (!permitted) return;
  let devices = [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all.filter(d => d.kind === 'videoinput');
  } catch (e) {
    showCameraError('Cannot enumerate devices: ' + e.message);
    return;
  }
  console.debug('Devices found:', devices);
  if (!devices.length) { showCameraError('No video input devices found.'); return; }
  const env = devices.find(d => /back|rear|environment/i.test(d.label));
  if (env) devices = [env, ...devices.filter(d => d !== env)];
  cameraSelect.innerHTML = '';
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i+1}`;
    cameraSelect.appendChild(opt);
  });
  currentDeviceId = devices[0] && devices[0].deviceId;
  console.debug('Current device selected:', currentDeviceId);
}

cameraSelect.addEventListener('change', () => {
  currentDeviceId = cameraSelect.value;
  if (scanning) {
    stopScan();
    startScan();
  }
});

async function startScan() {
  // Added: ensure reader initialized even if listCameras not run yet
  if (!codeReader) {
    try {
      await ensureZXingLoaded();
      codeReader = new ZXing.BrowserMultiFormatReader();
    } catch (e) {
      showCameraError('ZXing not available: ' + e.message);
      return;
    }
  }
  if (!currentDeviceId) {
    console.debug('No currentDeviceId, attempting to refresh camera list');
    await listCameras();
    if (!currentDeviceId) {
      const firstOpt = cameraSelect.options[0];
      if (firstOpt) {
        currentDeviceId = firstOpt.value;
        console.debug('Fallback selected device', currentDeviceId);
      }
    }
    if (!currentDeviceId) { showCameraError('No camera devices available.'); return; }
  }
  scanning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  showCameraError('');
  try {
    await codeReader.decodeFromVideoDevice(currentDeviceId, video, (result, err) => {
      if (err && !(err instanceof ZXing.NotFoundException)) {
        showCameraError('Camera/Decode error: ' + err.message);
      }
      if (result) {
        const text = result.getText();
        const now = Date.now();
        // Changed: allow same QR after interval elapsed
        if (text !== lastResult || (now - lastResultTime) > RESCAN_SAME_INTERVAL_MS) {
          lastResult = text;
          lastResultTime = now;
          handleRawQR(text);
        }
      }
    });
  } catch (e) {
    showCameraError('Failed to start camera: ' + e.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function stopScan() {
  scanning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (codeReader) {
    codeReader.reset();
  }
}

async function handleRawQR(raw) {
  try {
    const res = await apiFetch('/api/scan', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ raw_qr: raw })
    });
    const data = await res.json();
    showModalForScan(data, raw);
    loadStats();
  } catch (e) {
    console.error('Scan error', e);
  }
}

function showModalForScan(data, raw) {
  attendeeInfo.innerHTML = '';
  statusBox.className = 'status-box';
  lastModalTicket = data.ticket_number || '';
  lastStatus = data.status;

  let html = `<p><b>Raw QR:</b> ${escapeHtml(raw)}</p>`;
  if (data.ticket_number) html += `<p><b>Ticket:</b> ${escapeHtml(data.ticket_number)}</p>`;
  if (data.attendee) {
    html += `<p><b>Name:</b> ${escapeHtml(data.attendee.name)}</p>`;
  }
  attendeeInfo.innerHTML = html;

  let msg = '';
  switch (data.status) {
    case 'OK':
      statusBox.classList.add('status-ok');
      msg = 'Checked in successfully.';
      manualCheckBtn.disabled = true;
      break;
    case 'DUPLICATE':
      statusBox.classList.add('status-duplicate');
      msg = 'Already checked!';
      manualCheckBtn.disabled = true;
      break;
    case 'NOT_FOUND':
      statusBox.classList.add('status-notfound');
      msg = 'Ticket not found.';
      manualCheckBtn.disabled = true;
      break;
    case 'INVALID_FORMAT':
      statusBox.classList.add('status-invalid');
      msg = 'Invalid QR format.';
      manualCheckBtn.disabled = true;
      break;
    case 'ERROR':
      statusBox.classList.add('status-invalid');
      msg = 'Server error';
      if (data.error) msg += `: ${escapeHtml(data.error)}`;
      manualCheckBtn.disabled = true;
      break;
    default:
      statusBox.classList.add('status-invalid');
      msg = 'Unknown status: ' + escapeHtml(String(data.status || 'NONE'));
      manualCheckBtn.disabled = true;
  }
  statusBox.textContent = msg;
  openModal();
}

closeModalBtn.addEventListener('click', () => {
  closeModal();
});

function closeModal() {
  modal.style.display = 'none';
  lastModalTicket = null;
  lastStatus = null;
  attendeeInfo.innerHTML = '';
  statusBox.className = 'status-box';
  statusBox.textContent = '';
  // Added: allow immediate re-scan of same QR after closing modal
  lastResult = null;
  lastResultTime = 0;
}

function openModal() {
  modal.style.display = 'block';
  setTimeout(() => {
    modal.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

// Manual check button (for admin use, bypasses QR code scan)
manualCheckBtn.addEventListener('click', async () => {
  const ticket = prompt('Enter ticket number:');
  if (!ticket) return;
  manualCheckBtn.disabled = true;
  try {
    const res = await apiFetch('/api/manual-check', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ticket_number: ticket })
    });
    const data = await res.json();
    showModalForScan(data, ticket);
    loadStats();
  } catch (e) {
    console.error('Manual check error', e);
    showCameraError('Manual check failed');
  }
  manualCheckBtn.disabled = false;
});

// Escape HTML helper (to prevent XSS in injected HTML)
function escapeHtml(html) {
  const text = document.createTextNode(html);
  const div = document.createElement('div');
  div.appendChild(text);
  return div.innerHTML;
}

// Added: export attendance CSV
exportBtn && exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';
  try {
    const res = await apiFetch('/api/attendance/export');
    if (!res.ok) throw new Error('Server responded ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:T]/g,'-').split('.')[0];
    a.download = `attendance_export_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  } catch (e) {
    showCameraError('Export failed: ' + e.message);
  }
  exportBtn.textContent = 'Export CSV';
  exportBtn.disabled = false;
});

// Attach missing event listeners & initial camera listing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { listCameras(); });
} else {
  listCameras();
}

startBtn && !startBtn._listenerAttached && (startBtn._listenerAttached = startBtn.addEventListener('click', () => { if (!scanning) startScan(); }));
stopBtn && !stopBtn._listenerAttached && (stopBtn._listenerAttached = stopBtn.addEventListener('click', () => { if (scanning) stopScan(); }));