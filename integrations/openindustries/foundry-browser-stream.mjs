/**
 * Browser-side read-only state consumer installed into OpenIndustries by Vite.
 * Exposes accepted committed snapshots through a native window CustomEvent.
 *
 * No task mutation, physical animation or fabricated telemetry occurs here.
 */
import { configureFoundryKinematics, receiveFoundryKinematics } from './foundry-kinematics-browser.mjs';

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

  let accepted = null;
  let eventSource;
  const connect = () => {
    eventSource = new EventSourceClass("/api/foundry/events");
    eventSource.addEventListener("open", () => {
      panel.setAttribute("data-stream-status", "connected");
      panel.textContent = accepted ? stateText(accepted) : "Foundry stream connected · awaiting committed state";
    });
    eventSource.addEventListener("snapshot", (event) => {
      let proposed;
      try { proposed = JSON.parse(event.data); } catch { return; }
      const next = acceptFrame(accepted, proposed, config.scene_id);
      if (!next) return;
      accepted = next;
      panel.setAttribute("data-stream-status", "connected");
      panel.setAttribute("data-runtime-revision", String(next.revision));
      panel.textContent = stateText(next);
      receiveFoundryKinematics(next);
      windowObject.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, { detail: next }));
    });
    eventSource.addEventListener("stream-error", () => {
      panel.setAttribute("data-stream-status", "offline");
      panel.textContent = "Foundry controller unavailable · last snapshot is stale";
    });
    eventSource.addEventListener("error", () => {
      panel.setAttribute("data-stream-status", "offline");
      panel.textContent = "Foundry stream disconnected · reconnecting without advancing simulation";
    });
  };
  const offline = () => {
    eventSource?.close();
    panel.setAttribute('data-stream-status', 'offline');
    panel.textContent = 'Foundry stream offline · retaining last committed state and pose';
  };
  const online = () => { eventSource?.close(); connect(); };
  windowObject.addEventListener('offline', offline);
  windowObject.addEventListener('online', online);
  connect();
  return {
    getSnapshot: () => accepted,
    close: () => {
      eventSource.close(); panel.remove();
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
