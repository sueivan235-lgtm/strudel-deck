// Time-aware values for the deck: set now, land on a beat or bar, or ramp between two cycle positions.

/**
 * Values that change now, land later, or ramp. Each key has a final value plus an
 * optional lane of scheduled segments {t0, t1, v0, v1} in cycles.
 * `defaults(key)` supplies the value of keys that were never set (so a ramp on a
 * fresh key starts from a real number, never from undefined).
 */
export class ValueStore {
  constructor(defaults = () => undefined) {
    this.values = new Map();
    this.lanes = new Map();
    this.defaults = defaults;
  }
  has(key) {
    return this.values.has(key);
  }
  /** The value the key is heading to (after any scheduled changes). */
  get(key, fallback = this.defaults(key)) {
    return this.values.has(key) ? this.values.get(key) : fallback;
  }
  set(key, value) {
    this.values.set(key, value);
    this.lanes.delete(key);
  }
  /** Step to `value` at t0 (t1 === t0) or ramp linearly from t0 to t1. Later plans on this key are replaced. */
  schedule(key, t0, t1, value, from) {
    const v0 = from !== undefined ? from : this.valueAt(key, t0);
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { base: this.get(key), segs: [] };
      this.lanes.set(key, lane);
    }
    lane.segs = lane.segs.filter((s) => s.t0 < t0);
    for (const s of lane.segs) {
      if (s.t1 > t0) {
        // cut a ramp that is still running where the new plan starts
        s.v1 = interp(s, t0);
        s.t1 = t0;
      }
    }
    lane.segs.push({ t0, t1: Math.max(t0, t1), v0, v1: value });
    this.values.set(key, value);
  }
  valueAt(key, t, fallback = this.defaults(key)) {
    const lane = this.lanes.get(key);
    if (!lane) return this.values.has(key) ? this.values.get(key) : fallback;
    let v = lane.base !== undefined ? lane.base : fallback;
    for (const s of lane.segs) {
      if (t < s.t0) break;
      v = t >= s.t1 ? s.v1 : interp(s, t);
    }
    return v;
  }
  /** True while a scheduled change on this key has not finished at time t. */
  pending(key, t) {
    const lane = this.lanes.get(key);
    return !!lane && lane.segs.some((s) => t < s.t1 || t < s.t0);
  }
  /** Keys with a change still pending at time t. */
  pendingKeys(t) {
    const out = [];
    for (const [k, lane] of this.lanes) if (lane.segs.some((s) => t < s.t1 || t < s.t0)) out.push(k);
    return out;
  }
  /** Drop lanes that have finished (their final value is in `values`). */
  prune(t) {
    for (const [k, lane] of this.lanes) if (lane.segs.every((s) => t > s.t1 + 1)) this.lanes.delete(k);
  }
  /** Jump every key to its final value (used when the clock restarts from zero). */
  settle() {
    this.lanes.clear();
  }
  /** Move values and lanes from old keys to new keys in one step (pairs: [[old, new], ...]). */
  renameKeys(pairs) {
    const moved = pairs.map(([o, n]) => [n, this.values.has(o), this.values.get(o), this.lanes.get(o)]);
    for (const [o, n] of pairs) {
      this.values.delete(o);
      this.lanes.delete(o);
      this.values.delete(n);
      this.lanes.delete(n);
    }
    for (const [n, has, v, lane] of moved) {
      if (has) this.values.set(n, v);
      if (lane) this.lanes.set(n, lane);
    }
  }
}

function interp(s, t) {
  if (typeof s.v0 !== 'number' || typeof s.v1 !== 'number' || s.t1 <= s.t0) return t >= s.t1 || s.v0 === undefined ? s.v1 : s.v0;
  return s.v0 + ((s.v1 - s.v0) * (t - s.t0)) / (s.t1 - s.t0);
}
