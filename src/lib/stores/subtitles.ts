import { browser } from "$app/environment";
import { derived, get, writable } from "svelte/store";

export type TrackStatus = "草稿" | "审校中" | "已通过" | "需修改";
export type CueStatus = "待译" | "翻译中" | "待审" | "已通过" | "退回" | "待复核";
export type TermStatus = "建议" | "已锁定";

export interface Track {
  id: string;
  name: string;
  locale: "zh" | "en" | "ja";
  status: TrackStatus;
}

export interface Cue {
  id: string;
  trackId: string;
  start: number;
  end: number;
  source: string;
  translated: string;
  status: CueStatus;
  translator: string;
  reviewerNote: string;
  /** 片段标识：译文锚定的原字幕片段 */
  sourceCueId?: string;
  /** 审校结论失效原因（进入待复核时记录） */
  invalidatedReason?: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  status: TermStatus;
  owner: string;
}

export interface ReviewEvent {
  id: string;
  cueId: string;
  action: "提交审校" | "审校通过" | "退回修改" | "术语锁定" | "继承重排" | "重排失败" | "快照恢复";
  detail: string;
  actor: string;
  time: string;
}

export interface Snapshot {
  id: string;
  name: string;
  time: string;
  cues: Cue[];
}

export interface TimelineConflict {
  id: string;
  cueId: string;
  message: string;
  remoteStart: number;
  remoteEnd: number;
  status: "待处理" | "采用本地" | "采用协作版本";
}

export interface Invalidation {
  id: string;
  cueId: string;
  reason: string;
  origin: "继承重排" | "快照恢复";
  time: string;
}

export interface RealignFailure {
  cueId: string;
  reason: string;
  at: string;
  /** 本次已成功处理的译文 */
  done: string[];
  /** 从失败点开始尚未处理的译文 */
  remaining: string[];
}

export interface RestoreReport {
  snapshotId: string;
  name: string;
  invalidated: { cueId: string; reason: string }[];
}

const KEY = "pair-wise-yf-51/subtitles-v2";
const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿" }
];
const seedCues: Cue[] = [
  { id: "c1", trackId: "zh", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮汐退去后，码头重新露出水面。", status: "已通过", translator: "系统", reviewerNote: "" },
  { id: "c5", trackId: "zh", start: 3.2, end: 6.5, source: "修复组必须在下一场潮水到来前完成加固。", translated: "修复组必须在下一场潮水到来前完成加固。", status: "已通过", translator: "系统", reviewerNote: "" },
  { id: "c2", trackId: "en", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "As the tide recedes, the pier emerges again.", status: "待审", translator: "林岚", reviewerNote: "", sourceCueId: "c1" },
  { id: "c3", trackId: "en", start: 3.2, end: 6.5, source: "修复组必须在下一场潮水到来前完成加固。", translated: "The repair team must reinforce it before the next tide.", status: "翻译中", translator: "林岚", reviewerNote: "", sourceCueId: "c5" },
  { id: "c4", trackId: "ja", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮が引くと、桟橋が再び姿を現す。", status: "待译", translator: "周野", reviewerNote: "", sourceCueId: "c1" }
];
const seedTerms: GlossaryTerm[] = [
  { id: "g1", source: "潮汐", target: "tide", status: "已锁定", owner: "术语管理员" },
  { id: "g2", source: "码头", target: "pier", status: "已锁定", owner: "术语管理员" },
  { id: "g3", source: "加固", target: "reinforce", status: "建议", owner: "林岚" }
];
const initial = browser && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;
export const tracks = writable<Track[]>(initial?.tracks ?? seedTracks);
export const cues = writable<Cue[]>(initial?.cues ?? seedCues);
export const terms = writable<GlossaryTerm[]>(initial?.terms ?? seedTerms);
export const reviewEvents = writable<ReviewEvent[]>(initial?.events ?? []);
export const snapshots = writable<Snapshot[]>(initial?.snapshots ?? []);
export const invalidations = writable<Invalidation[]>(initial?.invalidations ?? []);
export const realignFailure = writable<RealignFailure | null>(initial?.realignFailure ?? null);
export const lastRestoreReport = writable<RestoreReport | null>(null);
export const conflicts = writable<TimelineConflict[]>([{ id: "x1", cueId: "c2", message: "协作者将结束时间调整为3.0秒，与本机存在0.2秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewer = writable("审校-顾宁");

function persist() {
  if (!browser) return;
  localStorage.setItem(KEY, JSON.stringify({ tracks: get(tracks), cues: get(cues), terms: get(terms), events: get(reviewEvents), snapshots: get(snapshots), invalidations: get(invalidations), realignFailure: get(realignFailure) }));
}
[tracks, cues, terms, reviewEvents, snapshots, invalidations, realignFailure].forEach((store) => store.subscribe(persist));

function event(cue: Cue | undefined, action: ReviewEvent["action"], detail: string) {
  reviewEvents.update((items) => [{ id: crypto.randomUUID(), cueId: cue?.id ?? "", action, detail, actor: get(reviewer), time: new Date().toISOString() }, ...items]);
}

function sourceTrackId() {
  return get(tracks).find((track) => track.locale === "zh")?.id ?? "zh";
}

function overlap(a: Cue, b: Cue) {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

/** 先按片段标识找原文，找不到再按时间锚点取重叠最大的原文片段 */
function matchSourceCue(target: Cue, sources: Cue[]): Cue | undefined {
  const linked = sources.find((cue) => cue.id === target.sourceCueId);
  if (linked) return linked;
  let best: Cue | undefined;
  let bestScore = 0;
  const mid = (target.start + target.end) / 2;
  for (const cue of sources) {
    const ov = overlap(target, cue);
    if (ov <= 0) continue;
    const score = ov - Math.abs((cue.start + cue.end) / 2 - mid) / 1000;
    if (score > bestScore) {
      bestScore = score;
      best = cue;
    }
  }
  return best;
}

/** 锁定术语检查：原文包含已锁定术语时，译文必须包含对应译法 */
export function lockedTermIssues(cue: Cue): string[] {
  if (cue.trackId === sourceTrackId()) return [];
  return get(terms)
    .filter((term) => term.status === "已锁定" && cue.source.includes(term.source) && !cue.translated.includes(term.target))
    .map((term) => `${term.source} → ${term.target}`);
}

/**
 * 继承重排：原字幕轨改动后，按片段标识和时间锚点重新对应译文。
 * 只挪边界不换原文的译文原样继承；原文一变，关联译文与审校结论失效并转入待复核。
 * 任一条译文无法锚定时整体回滚到上一版时间轴，并记录失败点供断点续排。
 */
export function realignTranslations(origin: string) {
  const all = get(cues);
  const backup = structuredClone(all);
  const srcId = sourceTrackId();
  const sources = all.filter((cue) => cue.trackId === srcId).sort((a, b) => a.start - b.start);
  const queue = all.filter((cue) => cue.trackId !== srcId).sort((a, b) => a.trackId.localeCompare(b.trackId) || a.start - b.start);
  const next = new Map(all.map((cue) => [cue.id, { ...cue }]));
  const moved: string[] = [];
  const invalidated: { cueId: string; reason: string }[] = [];
  const done: string[] = [];
  for (const target of queue) {
    const match = matchSourceCue(target, sources);
    if (!match) {
      cues.set(backup);
      realignFailure.set({ cueId: target.id, reason: "按片段标识与时间锚点都找不到对应原文", at: new Date().toISOString(), done, remaining: queue.slice(done.length).map((cue) => cue.id) });
      event(undefined, "重排失败", `${origin}：译文 ${target.id} 无法锚定，已恢复上一版时间轴`);
      return false;
    }
    const current = next.get(target.id)!;
    const untouched = current.translated.trim().length === 0 && (current.status === "待译" || current.status === "翻译中");
    if (match.source !== current.source) {
      const alreadyStale = current.status === "待复核";
      next.set(target.id, {
        ...current,
        source: match.source,
        sourceCueId: match.id,
        start: match.start,
        end: match.end,
        ...(untouched ? {} : { status: "待复核" as CueStatus, invalidatedReason: "原文已变更，关联译文与审校结论失效" })
      });
      if (!untouched && !alreadyStale) invalidated.push({ cueId: target.id, reason: "原文已变更" });
    } else if (match.start !== current.start || match.end !== current.end) {
      next.set(target.id, { ...current, sourceCueId: match.id, start: match.start, end: match.end });
      moved.push(target.id);
    } else if (current.sourceCueId !== match.id) {
      next.set(target.id, { ...current, sourceCueId: match.id });
    }
    done.push(target.id);
  }
  cues.set([...next.values()]);
  if (invalidated.length) {
    invalidations.update((items) => [...invalidated.map((item) => ({ id: crypto.randomUUID(), cueId: item.cueId, reason: item.reason, origin: "继承重排" as const, time: new Date().toISOString() })), ...items].slice(0, 50));
  }
  realignFailure.set(null);
  if (moved.length || invalidated.length) event(undefined, "继承重排", `${origin}：${moved.length} 条译文继承新边界，${invalidated.length} 条结论失效转待复核`);
  return true;
}

/** 从失败点继续：重排是幂等的，已正确的片段会自动跳过，处理推进到原失败点之后 */
export function resumeRealign() {
  if (!get(realignFailure)) return true;
  return realignTranslations("断点续排");
}

export function updateCue(id: string, patch: Partial<Cue>, log = false) {
  const before = get(cues).find((cue) => cue.id === id);
  cues.update((items) => items.map((cue) => {
    if (cue.id !== id) return cue;
    const next = { ...cue, ...patch };
    if (patch.translated !== undefined && cue.status === "待复核") {
      next.status = "翻译中";
      next.invalidatedReason = undefined;
    }
    return next;
  }));
  if (log) event(get(cues).find((cue) => cue.id === id), "退回修改", "编辑字幕内容或时间码");
  if (before && before.trackId === sourceTrackId() && ((patch.source !== undefined && patch.source !== before.source) || (patch.start !== undefined && patch.start !== before.start) || (patch.end !== undefined && patch.end !== before.end))) {
    realignTranslations("原文编辑");
  }
}

export function nudgeCue(id: string, delta: number) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, { start: Math.max(0, Number((cue.start + delta).toFixed(1))), end: Math.max(cue.start + 0.5, Number((cue.end + delta).toFixed(1))) });
}

export function splitCue(id: string) {
  const list = get(cues);
  const cue = list.find((item) => item.id === id);
  if (!cue || cue.end - cue.start < 1) return;
  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  const first = { ...cue, end: middle, translated: `${cue.translated}`, status: "翻译中" as CueStatus };
  const second = { ...cue, id: crypto.randomUUID(), start: middle, translated: "", status: "待译" as CueStatus };
  cues.set(list.flatMap((item) => item.id === id ? [first, second] : [item]));
  selectedCueId.set(second.id);
  if (cue.trackId === sourceTrackId()) realignTranslations("原文拆分");
}

export function mergeNext(id: string) {
  const list = [...get(cues)].sort((a, b) => a.start - b.start).filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return;
  cues.update((items) => items.filter((item) => item.id !== next.id).map((item) => item.id === id ? { ...item, end: next.end, source: item.source === next.source ? item.source : `${item.source} ${next.source}`.trim(), translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" } : item));
  if (current.trackId === sourceTrackId()) realignTranslations("原文合并");
}

export function setCueStatus(id: string, status: CueStatus) {
  updateCue(id, { status });
  const cue = get(cues).find((item) => item.id === id);
  event(cue, status === "待审" ? "提交审校" : status === "已通过" ? "审校通过" : "退回修改", cue?.translated ?? "");
}

export function reviewCue(id: string, approved: boolean, note = "") {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  if (approved) {
    const issues = lockedTermIssues(cue);
    if (issues.length) {
      updateCue(id, { status: "退回", reviewerNote: `锁定术语未落实：${issues.join("；")}` });
      event(cue, "退回修改", `锁定术语对不上，不能直接通过：${issues.join("；")}`);
      return;
    }
  }
  updateCue(id, { status: approved ? "已通过" : "退回", reviewerNote: note });
  event(cue, approved ? "审校通过" : "退回修改", note || cue.translated);
}

export function lockTerm(id: string) {
  terms.update((items) => items.map((term) => term.id === id ? { ...term, status: "已锁定", owner: "术语管理员" } : term));
  const term = get(terms).find((item) => item.id === id);
  const cue = get(cues).find((item) => item.id === get(selectedCueId));
  event(cue, "术语锁定", `${term?.source} → ${term?.target}`);
}

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`) {
  snapshots.update((items) => [{ id: crypto.randomUUID(), name, time: new Date().toISOString(), cues: structuredClone(get(cues)) }, ...items].slice(0, 12));
}

export function restoreSnapshot(id: string) {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (!snapshot) return;
  cues.set(structuredClone(snapshot.cues));
  // 恢复后重新判定：哪些译文的审校结论因原文对不上或锁定术语缺失而失效
  const srcId = sourceTrackId();
  const sources = get(cues).filter((cue) => cue.trackId === srcId);
  const invalidated: { cueId: string; reason: string }[] = [];
  cues.update((items) => items.map((cue) => {
    if (cue.trackId === srcId || (cue.status !== "已通过" && cue.status !== "待审")) return cue;
    const match = matchSourceCue(cue, sources);
    if (!match) {
      invalidated.push({ cueId: cue.id, reason: "快照中找不到对应原文片段" });
      return { ...cue, status: "待复核" as CueStatus, invalidatedReason: "快照恢复后无法锚定原文" };
    }
    if (match.source !== cue.source) {
      invalidated.push({ cueId: cue.id, reason: "原文与审校结论不一致" });
      return { ...cue, status: "待复核" as CueStatus, invalidatedReason: "快照恢复后原文与结论不一致" };
    }
    const issues = lockedTermIssues(cue);
    if (issues.length && cue.status === "已通过") {
      invalidated.push({ cueId: cue.id, reason: `锁定术语未落实：${issues.join("；")}` });
      return { ...cue, status: "待复核" as CueStatus, invalidatedReason: "锁定术语未落实" };
    }
    return cue;
  }));
  if (invalidated.length) {
    invalidations.update((items) => [...invalidated.map((item) => ({ id: crypto.randomUUID(), cueId: item.cueId, reason: item.reason, origin: "快照恢复" as const, time: new Date().toISOString() })), ...items].slice(0, 50));
  }
  lastRestoreReport.set({ snapshotId: snapshot.id, name: snapshot.name, invalidated });
  event(undefined, "快照恢复", `${snapshot.name}：${invalidated.length} 条审校结论失效`);
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => item.id === id ? { ...item, status: resolution } : item));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

export const activeCues = derived([cues, activeTrackId, selectedCueId], ([$cues, $activeTrackId, $selectedCueId]) => $cues.filter((cue) => cue.trackId === $activeTrackId).sort((a, b) => a.start - b.start).map((cue) => ({ ...cue, selected: cue.id === $selectedCueId })));
