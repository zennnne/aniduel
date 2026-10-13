// How the open Ranking comes into being and ends: opened from what is saved, started, replaced by a Keep My Scale
// one, ended by its Import (ADR 0010), thrown away by Start over. One function per event, and no state of its own:
// every call carries the user and Media Type it is about. It is the only caller of the Duel log store's `show`,
// `save` and `close`; answers go on being appended through the store itself. The Pool's statuses saved beside the
// Ranking are read here, so they are saved here too. It knows storage and the store only,
// and hands every outcome back as a value: nothing here throws because the browser refused to save, a saved log
// can't be read, or the engine refused a log.
import type { ListStatus, ScoreFormat } from '../anilist/types.ts'
import { DEFAULT_STATUSES } from '../pool/pool.ts'
import {
  appendEvent,
  replay,
  startKeepMyScaleLog,
  startLog,
  type AnchorScore,
  type DuelLog,
  type NamedSplitRule,
  type SwitchableGoal,
} from '../ranking/engine.ts'
import type { ScoresPlan } from '../ranking/fromScores.ts'
import { isKeepMyScale, switchGoalEvents } from '../ranking/sortGoal.ts'
import type { DuelLogStore, ReplayedLog } from './duelLogStore.ts'
import { deleteDuelLog, loadDuelLog, loadPoolSettings, SaveError, savePoolSettings, type RankingKey } from './progress.ts'
import { createSplitChoiceStore } from './splitChoice.ts'
import { createUnsettledStore } from './unsettledTitles.ts'

export type RankingLifecycleDeps = {
  storage: Storage
  /** The Duel log store of the open Ranking. Only this module opens and closes it. */
  duelLog: Pick<DuelLogStore, 'latest' | 'show' | 'save' | 'close'>
  /** The seed of a new Duel log. */
  seed: () => number
  /**
   * Throws away the Import state saved for a Ranking (its unfinished Import and its ticks). Called whenever a Ranking
   * is replaced, ended or thrown away, after the step that can be refused has landed. If it throws, that propagates.
   */
  discardImport: (key: RankingKey) => void
}

/**
 * What is saved for a user and Media Type: the Pool's statuses (the defaults when none are saved), and the Ranking.
 * An unusable one is left as it is: only Start over removes it.
 */
export type SavedRanking = { statuses: readonly ListStatus[] } & (
  | { kind: 'none' }
  | ({ kind: 'usable' } & ReplayedLog)
  /**
   * `unreadable`: the saved log can't be parsed, or is not this user's and Media Type's. `does-not-replay`: the
   * engine refuses it. `message` says which, in the loader's or the engine's own words.
   */
  | { kind: 'unusable'; reason: 'unreadable' | 'does-not-replay'; message: string }
)

/** A new Ranking under Scores or Full Ranking. */
export type NewRanking = {
  /** The Pool, in Rough Sort order. */
  order: readonly number[]
  goal: SwitchableGoal
  /**
   * The Rough Sort from Scores plan (ADR 0008) when the user turned it on, null when they did not. Its Bands are
   * filled only if the plan is offerable.
   */
  fromScores: Pick<ScoresPlan, 'bands' | 'offerable'> | null
}

/**
 * What the Picker's Confirm starts a Keep My Scale Ranking on: the picked titles in the order its Duels meet them,
 * the Anchor snapshot, which never holds a picked title, and the split rule selected in the Picker (ADR 0013).
 * `ownSplit` is that rule when the user chose it themselves, to be remembered; null when the selection only followed
 * the recommendation.
 */
export type KeepMyScalePicks = { order: number[]; anchors: AnchorScore[]; split: NamedSplitRule; ownSplit: NamedSplitRule | null }

/** Why a Ranking was not started, or not replaced. Nothing changed: not what is saved, not what is open. */
export type StartFailure =
  /** The browser refused to save (its storage is full or blocked). */
  | { reason: 'save-refused' }
  /** The engine can't replay the new log; `message` is the engine's own. */
  | { reason: 'does-not-replay'; message: string }
  /** Starting: something is already saved for this user and Media Type, usable or not. */
  | { reason: 'in-the-way' }
  /** Replacing: no Scores / Full Ranking Ranking of this user and Media Type is open. */
  | { reason: 'nothing-to-replace' }

/** The Ranking now saved and open, or why nothing changed. */
export type StartResult = ({ ok: true } & ReplayedLog) | ({ ok: false } & StartFailure)

/**
 * Whether an Import ended the Ranking, and what became of its titles not yet Settled: there were `none`, the list
 * was `kept` for the next Picker, or it was `lost` because the browser refused to save it (the Ranking ended anyway).
 */
export type EndResult = { ended: false } | { ended: true; unsettled: 'none' | 'kept' | 'lost' }

export type RankingLifecycle = {
  /** What is saved for a user and Media Type, without opening it: the Duel log store is not touched. */
  saved(key: RankingKey): SavedRanking
  /**
   * The same answer, and the store now agrees with it: the Ranking is open when it is usable, and no Ranking is open
   * otherwise. Nothing is written.
   */
  open(key: RankingKey): SavedRanking
  /**
   * Saves the Pool's statuses the user chose on Start, beside the Ranking. `saved` is false when the browser refused:
   * the ones saved before are still there.
   */
  saveStatuses(key: RankingKey, statuses: readonly ListStatus[]): { saved: boolean }
  /** Saves a new Ranking under Scores or Full Ranking, then opens it. Refused when anything is saved under the key. */
  start(key: RankingKey, scoreFormat: ScoreFormat, ranking: NewRanking): StartResult
  /**
   * Saves a new Keep My Scale Ranking on the Picker's result (ADR 0009, ADR 0011), then opens it. Refused when
   * anything is saved under the key. Once it is saved, the remembered titles not yet Settled are forgotten, and the
   * user's own split choice is remembered (ADR 0013).
   */
  startKeepMyScale(key: RankingKey, scoreFormat: ScoreFormat, picks: KeepMyScalePicks): StartResult
  /**
   * The same, saved over the Scores / Full Ranking Ranking that is open under the key, whose Import state goes with
   * it. Refused when no such Ranking is open. If the save is refused, the old Ranking is still saved and open.
   */
  replaceWithKeepMyScale(key: RankingKey, scoreFormat: ScoreFormat, picks: KeepMyScalePicks): StartResult
  /**
   * An Import wrote every score it planned: a Keep My Scale Ranking ends (ADR 0010). Of it only the list of titles
   * not yet Settled is kept (ADR 0011). Does nothing unless the open Ranking is this key's and on Keep My Scale, so
   * it can be called for every finished Import.
   */
  endKeepMyScale(key: RankingKey): EndResult
  /** Start over: throws away what is saved under the key, usable or not, with its Import state, and closes it if it was open. */
  startOver(key: RankingKey): void
  /** No Ranking is open any more (logout). Nothing saved is touched. */
  close(): void
}

/** What is saved as the Duel log, before any replay. */
type Loaded = { kind: 'none' } | { kind: 'log'; log: DuelLog } | { kind: 'unusable'; reason: 'unreadable'; message: string }

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function createRankingLifecycle({ storage, duelLog, seed, discardImport }: RankingLifecycleDeps): RankingLifecycle {
  function load(key: RankingKey): Loaded {
    try {
      const log = loadDuelLog(storage, key)
      return log ? { kind: 'log', log } : { kind: 'none' }
    } catch (e) {
      return { kind: 'unusable', reason: 'unreadable', message: message(e) }
    }
  }

  function statuses(key: RankingKey): readonly ListStatus[] {
    return loadPoolSettings(storage, key)?.statuses ?? DEFAULT_STATUSES
  }

  /** The open Ranking, when it is this user's and Media Type's. */
  function openUnder(key: RankingKey): ReplayedLog | null {
    const open = duelLog.latest()
    return open && open.log.header.userId === key.userId && open.log.header.mediaType === key.mediaType ? open : null
  }

  function keepMyScaleLog(key: RankingKey, format: ScoreFormat, { order, anchors, split }: KeepMyScalePicks): DuelLog {
    return startKeepMyScaleLog({ seed: seed(), ...key, format, anchors, ids: order, split })
  }

  /** A Keep My Scale Ranking is saved: what the start of one leaves beside its log. */
  function keepMyScaleStarted(key: RankingKey, { ownSplit }: KeepMyScalePicks) {
    // The titles left unsettled last time are offered no more, whether or not they were picked again (#66).
    createUnsettledStore(storage, key).clear()
    // Only a choice the user made themselves is remembered, never one that followed the recommendation (ADR 0013).
    if (ownSplit) createSplitChoiceStore(storage, key.userId).remember(ownSplit)
  }

  return {
    saved(key) {
      const loaded = load(key)
      if (loaded.kind !== 'log') return { statuses: statuses(key), ...loaded }
      try {
        return { statuses: statuses(key), kind: 'usable', log: loaded.log, ranking: replay(loaded.log) }
      } catch (e) {
        return { statuses: statuses(key), kind: 'unusable', reason: 'does-not-replay', message: message(e) }
      }
    },
    open(key) {
      const loaded = load(key)
      if (loaded.kind !== 'log') {
        duelLog.close()
        return { statuses: statuses(key), ...loaded }
      }
      // Replayed first: nothing shows from a log the engine can't replay.
      const shown = duelLog.show(loaded.log)
      if (shown.ok) return { statuses: statuses(key), kind: 'usable', log: shown.log, ranking: shown.ranking }
      duelLog.close()
      const why = shown.reason === 'does-not-replay' ? shown.message : 'unknown error'
      return { statuses: statuses(key), kind: 'unusable', reason: 'does-not-replay', message: why }
    },
    saveStatuses(key, chosen) {
      try {
        savePoolSettings(storage, key, { statuses: [...chosen] })
        return { saved: true }
      } catch (e) {
        if (!(e instanceof SaveError)) throw e
        return { saved: false }
      }
    },
    start(key, scoreFormat, { order, goal, fromScores }) {
      if (load(key).kind !== 'none') return { ok: false, reason: 'in-the-way' }
      let log: DuelLog
      try {
        // The new log carries its own Sort Goal and default scoring settings (ADR 0007).
        const started = startLog({ seed: seed(), ...key, ids: order, scoreFormat })
        // Full Ranking: the same switch as from the menu, before anything is sorted.
        log = switchGoalEvents(replay(started), null, scoreFormat, goal).reduce(appendEvent, started)
      } catch (e) {
        return { ok: false, reason: 'does-not-replay', message: message(e) }
      }
      return duelLog.save(fromScores?.offerable ? appendEvent(log, { type: 'bands-from-scores', bands: fromScores.bands }) : log)
    },
    startKeepMyScale(key, scoreFormat, picks) {
      if (load(key).kind !== 'none') return { ok: false, reason: 'in-the-way' }
      const saved = duelLog.save(keepMyScaleLog(key, scoreFormat, picks))
      if (saved.ok) keepMyScaleStarted(key, picks)
      return saved
    },
    replaceWithKeepMyScale(key, scoreFormat, picks) {
      const old = openUnder(key)
      if (!old || isKeepMyScale(old.ranking)) return { ok: false, reason: 'nothing-to-replace' }
      // Saved over the old log, not after deleting it: a refused save leaves the old Ranking saved and open.
      const saved = duelLog.save(keepMyScaleLog(key, scoreFormat, picks))
      if (!saved.ok) return saved
      discardImport(key)
      keepMyScaleStarted(key, picks)
      return saved
    },
    endKeepMyScale(key) {
      const ended = openUnder(key)?.ranking
      if (!ended || !isKeepMyScale(ended)) return { ended: false }
      // The log goes first, which frees space for the list; the list is worked out from the replay already in hand.
      deleteDuelLog(storage, key)
      let unsettled: 'none' | 'kept' | 'lost'
      try {
        unsettled = createUnsettledStore(storage, key).remember(ended) > 0 ? 'kept' : 'none'
      } catch (e) {
        if (!(e instanceof SaveError)) throw e
        unsettled = 'lost'
      }
      discardImport(key)
      duelLog.close()
      return { ended: true, unsettled }
    },
    startOver(key) {
      deleteDuelLog(storage, key)
      discardImport(key)
      if (openUnder(key)) duelLog.close()
    },
    close: () => duelLog.close(),
  }
}
