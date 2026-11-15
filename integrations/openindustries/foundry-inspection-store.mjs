/** Read-only bridge from F1's accepted snapshots to the native inspector. */
let state = { map: null, sceneId: null, frame: null, freshness: 'waiting' };
const listeners = new Set();
const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const inspectionState = () => state;
export const subscribeInspection = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function configureFoundryInspection(map, sceneId) {
  if (map.version !== 1 || !Array.isArray(map.machines)) throw Error('INVALID_INSPECTION_MAP');
  publish({ map, sceneId });
  if (typeof document !== 'undefined') document.documentElement.dataset.nasaFoundry = 'true';
}
// Called only by F1 after its monotonic acceptFrame gate, never by a render clock.
export function receiveFoundryInspection(frame) { publish({ frame, freshness: 'fresh' }); }
export function setInspectionFreshness(freshness) { publish({ freshness }); }
