/**
 * Browser-side read-only state consumer installed into OpenIndustries by Vite.
 * Exposes accepted committed snapshots through a native window CustomEvent.
 *
 * No task mutation, physical animation or fabricated telemetry occurs here.
 */
import { configureFoundryKinematics, receiveFoundryKinematics } from './foundry-kinematics-browser.mjs';
import { configureFoundryMaterial, receiveFoundryMaterial, setMaterialConnection } from './foundry-material-browser.mjs';
import { configureFoundryInspection, receiveFoundryInspection, setInspectionFreshness } from './foundry-inspection-store.mjs';

export const PROTOCOL = "nasa.foundry.snapshot.v1";
export const SNAPSHOT_EVENT = "nasa-foundry:snapshot";

export function acceptFrame(previous, frame, expectedSceneId = "lunar-foundry-mvp") {
  /** Reject mismatched, regressed, corrupt or unauthoritative state. */
  if (!frame || frame.protocol !== PROTOCOL ||
      frame.scene_id !== expectedSceneId ||
      frame.origin !== "simulated" || frame.validity !== "modeled" ||
      !frame.snapshot || frame.snapshot.scene_id !== frame.scene_id ||
      frame.snapshot.instance_id !== frame.instance_id ||
      frame.snapshot.revision !== frame.revision ||
      frame.snapshot.simulation_time_ms !== frame.simulation_time_ms ||
      frame.snapshot.mass_conserved !== true ||
      frame.snapshot.energy_conserved !== true ||
      !Number.isSafeInteger(frame.revision) || frame.revision < 1 ||
      !Number.isSafeInteger(frame.simulation_time_ms) || frame.simulation_time_ms < 0) {
    return null;
  }
  if (previous && (frame.instance_id !== previous.instance_id ||
      frame.revision <= previous.revision ||
      frame.simulation_time_ms < previous.simulation_time_ms)) {
    return null;
  }
  return frame;
}

function stateText(frame) {
  /** Display only fields present in an authoritative controller projection. */
  const snapshot = frame.snapshot;
  const job = snapshot.machines.map((machine) =>
    machine.machine_id.replace("foundry-machine-", "") + ":" + machine.status
  ).join(" · ");
  return [
    "Foundry · live simulation state",
    "Revision " + frame.revision + " · t=" + (frame.simulation_time_ms / 1000) + "s",
    "Site " + snapshot.inventory_g.site + "g · hopper " +
      snapshot.inventory_g.hopper + "g · preheater " + snapshot.inventory_g.preheater + "g",
    "Preheater " + (snapshot.thermal.temperature_mK / 1000).toFixed(3) +
      " K · spent " + (snapshot.energy_mJ.spent / 1000000).toFixed(3) + " kJ",
    job,
    "SIMULATED · model only · joint poses derived from committed work",
  ].join("\n");
}

export async function startFoundryBrowserStream({
  documentObject = document,
  windowObject = window,
  fetcher = fetch,
  EventSourceClass = EventSource,
} = {}) {
  /** Mount a transport diagnostic into the real OI workbench without modifying its renderer. */
  const configResponse = await fetcher("/api/foundry/config", { cache: "no-store" });
  if (!configResponse.ok) throw Error("Foundry stream config unavailable");
  const config = await configResponse.json();
  if (config.protocol !== PROTOCOL || !config.read_only ||
      config.scene_id !== "lunar-foundry-mvp") throw Error("Invalid stream config");
  const selectedScene = new URL(windowObject.location.href).searchParams.get("localSceneId");
  if (selectedScene !== config.oi_scene_id) return null;

  const panel = documentObject.createElement("aside");
  panel.id = "nasa-foundry-transport";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("data-stream-status", "connecting");
  panel.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:20000",
    "max-width:310px", "white-space:pre-line", "font:12px/1.5 monospace",
    "background:rgba(18,22,32,.93)", "color:#e6e9ef",
    "border:1px solid #566070", "border-radius:8px",
    "padding:10px 12px", "pointer-events:none",
  ].join(";");
  panel.textContent = "Foundry stream: connecting to local authoritative controller";
  documentObject.body.appendChild(panel);

  const mapResponse = await fetcher('/api/foundry/kinematics', { cache: 'no-store' });
  if (!mapResponse.ok) throw Error('Kinematic CAD mapping unavailable');
  configureFoundryKinematics(await mapResponse.json(), config.oi_scene_id);
  const materialResponse = await fetcher('/api/foundry/material-map', { cache: 'no-store' });
  if (!materialResponse.ok) throw Error('Material port mapping unavailable');
  configureFoundryMaterial(await materialResponse.json(), config.oi_scene_id);
  const inspectionResponse = await fetcher('/api/foundry/inspection-map', { cache: 'no-store' });
  if (!inspectionResponse.ok) throw Error('Engineering inspection mapping unavailable');
  configureFoundryInspection(await inspectionResponse.json(), config.oi_scene_id);
  const operator = await fetcher('/api/foundry/control-session', { cache: 'no-store' });
  if (!operator.ok) throw Error('Local operator session unavailable');

  let accepted = null;
  let eventSource;
  let staleTimer;
  let healthy = false;
  const stale = () => {
    healthy = false;
    clearTimeout(staleTimer);
    setInspectionFreshness('stale');
    setMaterialConnection(false);
  };
  const fresh = () => {
    healthy = true;
    clearTimeout(staleTimer);
    setInspectionFreshness('fresh');
    setMaterialConnection(true);
    staleTimer = setTimeout(() => {
      stale();
      panel.setAttribute('data-stream-status', 'offline');
      panel.textContent = 'Foundry stream stale · authority heartbeat overdue';
    }, 35000);
  };
  const connect = () => {
    eventSource = new EventSourceClass("/api/foundry/events");
    eventSource.addEventListener("open", () => {
      panel.setAttribute("data-stream-status", "connecting");
      panel.textContent = 'Foundry stream connected · awaiting verified authority';
      stale();
    });
    eventSource.addEventListener("snapshot", (event) => {
      let proposed;
      try { proposed = JSON.parse(event.data); } catch { return; }
      const next = acceptFrame(accepted, proposed, config.scene_id);
      if (!next || next.instance_id !== config.instance_id) return;
      accepted = next;
      panel.setAttribute("data-stream-status", "connected");
      panel.setAttribute("data-runtime-revision", String(next.revision));
      panel.textContent = stateText(next);
      receiveFoundryKinematics(next);
      receiveFoundryMaterial(next);
      receiveFoundryInspection(next);
      fresh();
      windowObject.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, { detail: next }));
    });
    eventSource.addEventListener('authority-health', event => {
      let health;
      try { health = JSON.parse(event.data); } catch { return; }
      if (!accepted || health.instance_id !== accepted.instance_id || health.revision !== accepted.revision) return;
      fresh();
      panel.setAttribute('data-stream-status', 'connected');
      panel.textContent = stateText(accepted);
    });
    eventSource.addEventListener('run-changed', () => { stale(); windowObject.location.reload(); });
    eventSource.addEventListener("stream-error", () => {
      panel.setAttribute("data-stream-status", "offline");
      panel.textContent = "Foundry controller unavailable · last snapshot is stale";
      stale();
    });
    eventSource.addEventListener("error", () => {
      panel.setAttribute("data-stream-status", "offline");
      panel.textContent = "Foundry stream disconnected · reconnecting without advancing simulation";
      stale();
    });
  };
  const offline = () => {
    eventSource?.close();
    panel.setAttribute('data-stream-status', 'offline');
    panel.textContent = 'Foundry stream offline · retaining last committed state and pose';
    stale();
  };
  const online = () => { eventSource?.close(); connect(); };
  windowObject.addEventListener('offline', offline);
  windowObject.addEventListener('online', online);
  connect();
  const leaseTimer = setInterval(() => {
    if (!healthy || !accepted?.snapshot.controls?.running) return;
    void fetcher('/api/foundry/control-lease', { method: 'POST', headers: { 'X-Foundry-Command': '1' } })
      .then(response => { if (!response.ok) stale(); }).catch(stale);
  }, 1000);
  return {
    getSnapshot: () => accepted,
    close: () => {
      eventSource.close(); panel.remove();
      stale();
      clearInterval(leaseTimer);
      windowObject.removeEventListener('offline', offline);
      windowObject.removeEventListener('online', online);
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined" &&
    !window.__NASA_FOUNDRY_STREAM_STARTED) {
  window.__NASA_FOUNDRY_STREAM_STARTED = true;
  startFoundryBrowserStream().catch((error) => {
    console.error("NASA-APP read-only stream setup failed:", error);
    const panel = document.getElementById('nasa-foundry-transport');
    if (panel) {
      panel.setAttribute('data-stream-status', 'error');
      panel.textContent = 'Foundry setup failed: ' + error.message;
    }
  });
}
