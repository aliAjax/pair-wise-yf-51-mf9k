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
  /** 关联的原字幕片段标识 */
  sourceCueId?: string;
  /** 待复核原因：原文变更、快照恢复或锁定术语对不上 */
  invalidReason?: string;
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
  action: "提交审校" | "审校通过" | "退回修改" | "术语锁定";
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

export interface RearrangeFailure {
  anchor: { start: number; end: number };
  sourceText: string;
  cueId: string;
  reason: string;
}

export interface RearrangeReport {
  kept: number;
  invalidated: number;
  added: number;
  orphaned: number;
}

export interface RearrangeState {
  status: "idle" | "failed" | "done";
  failure?: RearrangeFailure;
  snapshotId?: string;
  report?: RearrangeReport;
}

const KEY = "pair-wise-yf-51/subtitles-v1";
const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿" }
];
const seedCues: Cue[] = [
  { id: "c1", trackId: "zh", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮汐退去后，码头重新露出水面。", status: "已通过", translator: "系统", reviewerNote: "" },
  { id: "c2", trackId: "en", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "As the tide recedes, the pier emerges again.", status: "待审", translator: "林岚", reviewerNote: "", sourceCueId: "c1" },
  { id: "c3", trackId: "en", start: 3.2, end: 6.5, source: "修复组必须在下一场潮水到来前完成加固。", translated: "The repair team must reinforce it before the next tide.", status: "翻译中", translator: "林岚", reviewerNote: "" },
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
export const conflicts = writable<TimelineConflict[]>([{ id: "x1", cueId: "c2", message: "协作者将结束时间调整为3.0秒，与本机存在0.2秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewer = writable("审校-顾宁");
export const rearrangeState = writable<RearrangeState>({ status: "idle" });

function persist() {
  if (!browser) return;
  localStorage.setItem(KEY, JSON.stringify({ tracks: get(tracks), cues: get(cues), terms: get(terms), events: get(reviewEvents), snapshots: get(snapshots) }));
}
[tracks, cues, terms, reviewEvents, snapshots].forEach((store) => store.subscribe(persist));

function event(cue: Cue | undefined, action: ReviewEvent["action"], detail: string) {
  reviewEvents.update((items) => [{ id: crypto.randomUUID(), cueId: cue?.id ?? "", action, detail, actor: get(reviewer), time: new Date().toISOString() }, ...items]);
}

function formatAnchor(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** 按时间锚点找重叠度最高的片段（IoU ≥ 0.3） */
function bestOverlap(cue: Cue, candidates: Cue[]): Cue | undefined {
  let best: Cue | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    const overlap = Math.min(candidate.end, cue.end) - Math.max(candidate.start, cue.start);
    if (overlap <= 0) continue;
    const score = overlap / (Math.max(candidate.end, cue.end) - Math.min(candidate.start, cue.start));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.3 ? best : undefined;
}

/** 快照恢复后或重排时，按片段标识、时间锚点、原文内容找对应原文字幕 */
function findSourceCue(cue: Cue, sourceCues: Cue[]): Cue | undefined {
  return sourceCues.find((item) => item.id === cue.sourceCueId)
    ?? sourceCues.find((item) => item.source === cue.source)
    ?? bestOverlap(cue, sourceCues);
}

export function updateCue(id: string, patch: Partial<Cue>, log = false) {
  const before = get(cues).find((cue) => cue.id === id);
  cues.update((items) => items.map((cue) => {
    if (cue.id !== id) return cue;
    const next = { ...cue, ...patch };
    // 已通过/待审译文被改到锁定术语对不上 → 审校结论失效
    if (patch.translated !== undefined && (cue.status === "已通过" || cue.status === "待审")) {
      const locked = get(terms).filter((term) => term.status === "已锁定" && next.source.includes(term.source));
      const missing = locked.filter((term) => !next.translated.includes(term.target));
      if (missing.length) {
        next.status = "待复核";
        next.invalidReason = `锁定术语对不上（${missing.map((term) => `${term.source}→${term.target}`).join("、")}），审校结论失效`;
      }
    }
    return next;
  }));
  // 原文字幕轨的原文一变，关联译文与审校结论立即失效
  if (patch.source !== undefined && before && before.source !== patch.source) {
    const track = get(tracks).find((item) => item.id === before.trackId);
    if (track?.locale === "zh") {
      let invalidated = 0;
      cues.update((items) => items.map((cue) => {
        if (cue.trackId === before.trackId) return cue;
        const linked = cue.sourceCueId === id || (!cue.sourceCueId && cue.source === before.source);
        if (!linked) return cue;
        if (cue.status === "已通过" || cue.status === "待审" || cue.status === "翻译中") {
          invalidated++;
          return { ...cue, status: "待复核", invalidReason: "原文已变更，译文与审校结论失效" };
        }
        // 待译片段没有结论可失效，同步原文即可
        if (cue.status === "待译") return { ...cue, source: patch.source };
        return cue;
      }));
      if (invalidated) event(undefined, "退回修改", `原文「${String(before.source).slice(0, 10)}…」已变更，${invalidated} 条关联译文进入待复核`);
    }
  }
  if (log) event(get(cues).find((cue) => cue.id === id), "退回修改", "编辑字幕内容或时间码");
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
}

export function mergeNext(id: string) {
  const list = [...get(cues)].sort((a, b) => a.start - b.start).filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return;
  cues.update((items) => items.filter((item) => item.id !== next.id).map((item) => item.id === id ? { ...item, end: next.end, translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" } : item));
}

export function setCueStatus(id: string, status: CueStatus) {
  updateCue(id, { status });
  const cue = get(cues).find((item) => item.id === id);
  event(cue, status === "待审" ? "提交审校" : status === "已通过" ? "审校通过" : "退回修改", cue?.translated ?? "");
}

/** 审校通过前校验：锁定术语对不上的译文不能直接通过 */
export function reviewCue(id: string, approved: boolean, note = ""): boolean {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return false;
  if (approved) {
    const locked = get(terms).filter((term) => term.status === "已锁定" && cue.source.includes(term.source));
    const missing = locked.filter((term) => !cue.translated.includes(term.target));
    if (missing.length) {
      event(cue, "退回修改", `锁定术语对不上，不能直接通过：${missing.map((term) => `${term.source}→${term.target}`).join("、")}`);
      return false;
    }
  }
  updateCue(id, { status: approved ? "已通过" : "退回", reviewerNote: note });
  event(cue, approved ? "审校通过" : "退回修改", note || cue.translated);
  return true;
}

export function lockTerm(id: string) {
  terms.update((items) => items.map((term) => term.id === id ? { ...term, status: "已锁定", owner: "术语管理员" } : term));
  const term = get(terms).find((item) => item.id === id);
  const cue = get(cues).find((item) => item.id === get(selectedCueId));
  event(cue, "术语锁定", `${term?.source} → ${term?.target}`);
}

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`): string {
  const id = crypto.randomUUID();
  snapshots.update((items) => [{ id, name, time: new Date().toISOString(), cues: structuredClone(get(cues)) }, ...items].slice(0, 12));
  return id;
}

/** 快照恢复后逐段核对：原文变更、片段缺失或锁定术语对不上的结论一律失效进入待复核 */
export function restoreSnapshot(id: string): number {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (!snapshot) return 0;
  const restored = structuredClone(snapshot.cues);
  const sourceTrack = get(tracks).find((track) => track.locale === "zh") ?? get(tracks)[0];
  const sourceCues = restored.filter((cue) => cue.trackId === sourceTrack.id);
  const locked = get(terms).filter((term) => term.status === "已锁定");
  let invalidated = 0;
  for (const cue of restored) {
    if (cue.trackId === sourceTrack.id) continue;
    const source = sourceCues.find((item) => item.id === cue.sourceCueId)
      ?? sourceCues.find((item) => item.source === cue.source)
      ?? bestOverlap(cue, sourceCues);
    let reason: string | null = null;
    if (!source) reason = "快照恢复后原片段已删除，审校结论失效";
    else if (source.source !== cue.source) reason = "快照恢复后原文已变更，审校结论失效";
    else if (cue.status === "已通过") {
      const missing = locked.filter((term) => cue.source.includes(term.source) && !cue.translated.includes(term.target));
      if (missing.length) reason = `锁定术语对不上（${missing.map((term) => `${term.source}→${term.target}`).join("、")}），审校结论失效`;
    }
    if (reason) {
      cue.status = "待复核";
      cue.invalidReason = reason;
      invalidated++;
      event(cue, "退回修改", reason);
    }
  }
  cues.set(restored);
  return invalidated;
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => item.id === id ? { ...item, status: resolution } : item));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

/**
 * 继承重排：原字幕轨拆分、合并或挪时间后，按片段标识、时间锚点、原文内容
 * 为每条原文字幕找对应译文。只挪边界不换原文的译文原样留下；原文一变，
 * 关联译文与审校结论失效进入待复核；找不到对应片段的译文记为失败锚点。
 */
function computeRearrangement(keepOrphans: boolean): { newCues: Cue[]; report: RearrangeReport; orphan: RearrangeFailure | null } {
  const all = get(cues);
  const sourceTrack = get(tracks).find((track) => track.locale === "zh") ?? get(tracks)[0];
  const sourceCues = all.filter((cue) => cue.trackId === sourceTrack.id).sort((a, b) => a.start - b.start);
  const translationTracks = get(tracks).filter((track) => track.id !== sourceTrack.id);
  const newCues: Cue[] = sourceCues.map((cue) => ({ ...cue }));
  const report: RearrangeReport = { kept: 0, invalidated: 0, added: 0, orphaned: 0 };
  let orphan: RearrangeFailure | null = null;

  for (const translationTrack of translationTracks) {
    const old = all.filter((cue) => cue.trackId === translationTrack.id);
    const used = new Set<string>();
    for (const source of sourceCues) {
      let match = old.find((cue) => !used.has(cue.id) && cue.sourceCueId === source.id);
      if (!match) {
        const candidate = bestOverlap(source, old.filter((cue) => !used.has(cue.id)));
        if (candidate) match = candidate;
      }
      if (!match) match = old.find((cue) => !used.has(cue.id) && cue.source === source.source);
      if (match) {
        used.add(match.id);
        if (match.source === source.source) {
          // 只挪边界不换原文：译文与审校结论原样留下
          newCues.push({ ...match, start: source.start, end: source.end, source: source.source, sourceCueId: source.id, invalidReason: undefined });
          report.kept++;
        } else {
          // 原文一变：译文与审校结论失效，进入待复核
          newCues.push({ ...match, start: source.start, end: source.end, source: source.source, sourceCueId: source.id, status: "待复核", invalidReason: "原文已变更，译文与审校结论失效" });
          report.invalidated++;
        }
      } else {
        // 原字幕轨新增片段：补一条待译译文
        newCues.push({ id: crypto.randomUUID(), trackId: translationTrack.id, start: source.start, end: source.end, source: source.source, translated: "", status: "待译", translator: "", reviewerNote: "", sourceCueId: source.id });
        report.added++;
      }
    }
    const unmatched = old.filter((cue) => !used.has(cue.id));
    if (unmatched.length) {
      report.orphaned += unmatched.length;
      if (!orphan) {
        const first = unmatched[0];
        orphan = {
          anchor: { start: first.start, end: first.end },
          sourceText: first.source,
          cueId: first.id,
          reason: `译文片段「${first.source.slice(0, 12)}…」在原字幕轨找不到对应片段（时间锚点 ${formatAnchor(first.start)}–${formatAnchor(first.end)}）`,
        };
      }
      if (keepOrphans) {
        for (const cue of unmatched) {
          newCues.push({ ...cue, status: "待复核", invalidReason: "原字幕轨找不到对应片段，暂保留原片段待重新对应" });
        }
      }
    }
  }
  newCues.sort((a, b) => a.start - b.start);
  return { newCues, report, orphan };
}

export function rearrangeTranslations() {
  const snapshotId = createSnapshot("重排前自动快照");
  const { newCues, report, orphan } = computeRearrangement(false);
  if (orphan) {
    // 重排失败：不应用任何改动，时间轴仍是上一版；恢复操作会跑快照核对
    rearrangeState.set({ status: "failed", failure: orphan, snapshotId, report });
    event(undefined, "退回修改", `继承重排失败，已恢复上一版时间轴：${orphan.reason}`);
    return;
  }
  cues.set(newCues);
  rearrangeState.set({ status: "done", snapshotId, report });
  event(undefined, "提交审校", `继承重排完成：保留 ${report.kept} 条 · 失效 ${report.invalidated} 条 · 新增 ${report.added} 条`);
}

/** 重排失败后恢复上一版时间轴 */
export function restoreRearrangement() {
  const state = get(rearrangeState);
  if (state.snapshotId) restoreSnapshot(state.snapshotId);
  rearrangeState.set({ status: "idle" });
}

/** 从失败点继续：找不到对应的译文片段暂以待复核保留，其余正常继承 */
export function continueRearrangement() {
  const snapshotId = get(rearrangeState).snapshotId ?? createSnapshot("重排前自动快照");
  const { newCues, report } = computeRearrangement(true);
  cues.set(newCues);
  rearrangeState.set({ status: "done", snapshotId, report });
  event(undefined, "提交审校", `从失败点继续重排完成：保留 ${report.kept} 条 · 失效 ${report.invalidated} 条 · 新增 ${report.added} 条 · 孤立保留 ${report.orphaned} 条`);
}

export const activeCues = derived([cues, activeTrackId, selectedCueId], ([$cues, $activeTrackId, $selectedCueId]) => $cues.filter((cue) => cue.trackId === $activeTrackId).sort((a, b) => a.start - b.start).map((cue) => ({ ...cue, selected: cue.id === $selectedCueId })));
