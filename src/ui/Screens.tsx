// The screen `shownScreen` answered with (ADR 0004), as components. Holds no app state: App hands it what the screens
// show and the handlers they call.
import type { ComponentProps, ReactNode } from 'react'
import type { ListEntry, MediaType } from '../anilist/types.ts'
import type { ExitOffer } from '../catchup/exitOffer.ts'
import type { ImportProgress } from '../import/previewImport.ts'
import { createSplitChoiceStore } from '../persistence/splitChoice.ts'
import { withSub, type BandIndex, type LogEvent, type RankingState, type SubBandIndex, type SwitchableGoal } from '../ranking/engine.ts'
import type { PreviewRead } from '../ranking/preview.ts'
import type { ScoringSettings } from '../ranking/scoring.ts'
import { isKeepMyScale } from '../ranking/sortGoal.ts'
import { BandChoiceScreen } from './bandchoice/BandChoiceScreen.tsx'
import { BoardScreen } from './board/BoardScreen.tsx'
import { CatchUpScreen } from './catchup/CatchUpScreen.tsx'
import { ExitOfferButton } from './catchup/ExitOfferButton.tsx'
import { StartingEraChip, StartingEraQuestion } from './catchup/StartingEraQuestion.tsx'
import type { useCatchUp } from './catchup/useCatchUp.ts'
import { CloserToScreen } from './duel/CloserToScreen.tsx'
import { CompleteScreen } from './duel/CompleteScreen.tsx'
import { DuelScreen } from './duel/DuelScreen.tsx'
import { ImportScreen } from './import/ImportScreen.tsx'
import type { usePreviewImport } from './import/usePreviewImport.ts'
import { count } from './meta.ts'
import { MoveSheet } from './move/MoveSheet.tsx'
import { PickerScreen } from './picker/PickerScreen.tsx'
import { startingPicks, type PickerStart, type PickerWayIn } from './picker/pickerView.ts'
import { PreviewScreen } from './preview/PreviewScreen.tsx'
import type { RankingUi } from './rankingUi.ts'
import { RoughSortScreen } from './roughsort/RoughSortScreen.tsx'
import type { RankingShown, Screen, Shown } from './shownScreen.ts'
import { SplitScreen } from './split/SplitScreen.tsx'
import { StartScreen } from './start/StartScreen.tsx'

type ScreensProps = {
  /** Where the Picker's remembered split rule is read from. */
  storage: Storage
  mediaType: MediaType
  /** The selected Media Type's list; undefined until it is read. */
  list: readonly ListEntry[] | undefined
  entries: ReadonlyMap<number, ListEntry>
  nameOf: (id: number) => string
  /** Everything Start shows. */
  start: ComponentProps<typeof StartScreen>
  /** How the Picker was last opened, and the remembered unsettled titles to tick on top (#64, #66). */
  pickerWayIn: PickerWayIn
  pickAgain: readonly number[]
  onConfirmPicks: (picks: PickerStart) => void
  catchUp: ReturnType<typeof useCatchUp>
  /** Catch-up's exit offer (#52); null while there is none. */
  exitOffer: ExitOffer | null
  onTakeExitOffer: (offer: ExitOffer) => void
  imports: ReturnType<typeof usePreviewImport>
  /** Where a resumed (or retried) Import ended up. */
  onResumed: (progress: ImportProgress | null) => void
  /** Read whenever Preview shows. */
  previewRead: PreviewRead | null
  /** The title a fix started from Preview is about, and the one whose Move sheet is open over Preview. */
  previewFix: RankingUi['previewFix']
  previewMoving: RankingUi['previewMoving']
  onSettings: (settings: ScoringSettings) => void
  onSwitchGoal: (goal: SwitchableGoal) => void
  onRefine: () => void
  onFixFromPreview: (id: number, verb: string, state: RankingState | null) => void
  onOpenPreview: () => void
  /** Appends one answer to the Duel log; null if it was dropped. */
  answer: (event: LogEvent) => RankingState | null
  moveTitle: (id: number, band: BandIndex, sub?: SubBandIndex) => RankingState | null
  goTo: (screen: Screen) => void
  patchRankingUi: (change: Partial<RankingUi>) => void
  onChooseBand: (band: BandIndex) => void
  onSkipSplit: (band: BandIndex) => void
  onContinueFromLastCheck: () => void
  onOpenBoard: () => void
}

/** Renders the screen `shownScreen` answered with. */
export function Screens({ shown, ...props }: ScreensProps & { shown: Shown }): ReactNode {
  const { storage, mediaType, list, entries, catchUp, imports, previewMoving, answer, goTo, patchRankingUi } = props
  switch (shown.kind) {
    case 'start':
      return <StartScreen {...props.start} />
    case 'picker':
      return (
        <PickerScreen
          key={mediaType}
          list={list ?? []} // the Picker shows only once the list is loaded
          scoreFormat={shown.viewer.scoreFormat}
          titleLanguage={shown.viewer.titleLanguage}
          mediaType={mediaType}
          initialPicks={startingPicks(list ?? [], shown.viewer.scoreFormat, props.pickerWayIn, props.pickAgain)}
          rememberedSplit={createSplitChoiceStore(storage, shown.viewer.id).choice()}
          onBack={() => window.history.back()}
          onConfirm={props.onConfirmPicks}
        />
      )
    case 'catch-up':
      return (
        <CatchUpScreen
          view={catchUp.view}
          queue={catchUp.queue}
          batchExtra={
            catchUp.startingEraLabel !== null && (
              <StartingEraChip label={catchUp.startingEraLabel} onChange={catchUp.changeStartingEra} />
            )
          }
          eraQuestion={
            catchUp.view.phase === 'era' && (
              <StartingEraQuestion
                popular={catchUp.view.popular}
                answer={catchUp.view.answer}
                titleLanguage={shown.viewer.titleLanguage}
                onAnswer={catchUp.answerStartingEra}
              />
            )
          }
          titleLanguage={shown.viewer.titleLanguage}
          onBack={() => window.history.back()}
          onReload={catchUp.open}
          onCycle={catchUp.cycle}
          onMark={catchUp.mark}
          onSave={catchUp.saveAndNext}
          onRetryWrites={catchUp.retryWrites}
          headerAction={props.exitOffer && <ExitOfferButton offer={props.exitOffer} onTake={props.onTakeExitOffer} />}
        />
      )
    case 'import': {
      const { importing } = shown
      // A Keep My Scale Ranking is gone once its Import finished (ADR 0010); the summary still shows.
      const ended = shown.ranking === null
      return (
        <ImportScreen
          stage={importing.stage}
          state={importing.state}
          status={importing.status}
          writtenBefore={importing.writtenBefore}
          entries={entries}
          titleLanguage={shown.viewer.titleLanguage}
          format={importing.state.format}
          onConfirm={imports.confirm}
          onStop={imports.stop}
          onResume={() => void imports.resume().then(props.onResumed)}
          onRetry={() => void imports.retry().then(props.onResumed)}
          onBack={() => goTo('preview')}
          onStart={() => goTo('start')}
          mediaType={mediaType}
          ended={ended}
        />
      )
    }
    case 'preview': {
      const { ranking } = shown
      return (
        <>
          <PreviewScreen
            state={ranking}
            preview={props.previewRead!} // read whenever Preview shows
            entries={entries}
            oldScores={shown.oldScores}
            titleLanguage={shown.viewer.titleLanguage}
            format={shown.viewer.scoreFormat}
            settings={shown.scoring}
            onSettings={props.onSettings}
            onSwitchGoal={isKeepMyScale(ranking) ? undefined : props.onSwitchGoal}
            onRefine={ranking.prompt.kind === 'all-complete' ? undefined : props.onRefine}
            overrides={imports.ticks}
            onTick={imports.tick}
            onImport={imports.importing?.stage === 'running' ? undefined : () => imports.planImport() && goTo('import')}
            onRerank={(id) => props.onFixFromPreview(id, 'Re-ranking', answer({ type: 'rerank-requested', id }))}
            onMove={isKeepMyScale(ranking) ? undefined : (id) => patchRankingUi({ previewMoving: id })}
            onBringBack={(id) => props.onFixFromPreview(id, 'Bringing back', answer({ type: 'unforgotten', id }))}
          />
          {previewMoving !== null && (
            <MoveSheet
              state={ranking}
              id={previewMoving}
              entries={entries}
              titleLanguage={shown.viewer.titleLanguage}
              onClose={() => patchRankingUi({ previewMoving: null })}
              onMove={(band, sub) => {
                const id = previewMoving
                patchRankingUi({ previewMoving: null })
                props.onFixFromPreview(id, 'Moving', props.moveTitle(id, band, sub))
              }}
            />
          )}
        </>
      )
    }
    default:
      return rankingScreen(shown, props)
  }
}

/** The Ranking screen: the screen for the engine's next prompt, or the Split screen or the last check over it. */
function rankingScreen(shown: RankingShown, props: ScreensProps) {
  const { mediaType, list, entries, imports, answer, moveTitle, goTo, patchRankingUi } = props
  const state = shown.ranking
  const titleLanguage = shown.viewer.titleLanguage
  const shared = { state, entries, titleLanguage, mediaType, onUndo: () => answer({ type: 'undo' }) }
  const openPreview = list && !imports.openingPreview ? props.onOpenPreview : undefined
  // Keep My Scale: every settled picked title can be imported before the rest are (ADR 0010).
  const settled = state.keepMyScale?.titles.filter((t) => t.settled).length ?? 0
  const early = settled > 0 ? { settled, onOpen: openPreview } : undefined
  switch (shown.kind) {
    case 'split': {
      const { band, lastCheckNext } = shown
      return (
        <SplitScreen
          key={band}
          state={state}
          band={band}
          entries={entries}
          titleLanguage={titleLanguage}
          onSplit={(event) => {
            patchRankingUi({ splitView: { band } })
            answer(event)
          }}
          onSkip={() => props.onSkipSplit(band)}
          // The last check comes before any Duel, so the Band choice comes after it, not straight away.
          nextStep={lastCheckNext ? 'last-check' : 'duels'}
          onClose={() => {
            patchRankingUi({ splitView: null })
            // "Start Duels in Loved › Best": the split Band is chosen, so its Duels come next.
            if (!lastCheckNext && state.bands[band].subBands) props.onChooseBand(band)
          }}
        />
      )
    }
    case 'last-check':
      return (
        <BoardScreen
          state={state}
          entries={entries}
          titleLanguage={titleLanguage}
          heading="Last check"
          hint="Moves are free until your first Duel. After that, moving a title costs Duels."
          mainLabel="Continue →"
          onMain={props.onContinueFromLastCheck}
          onMove={moveTitle}
          onUndo={shared.onUndo}
        />
      )
    case 'board': {
      const { done, total } = state.progress.roughSort
      const placed = state.board.bands.reduce((sum, band) => sum + band.titles.length, 0)
      return (
        <BoardScreen
          state={state}
          entries={entries}
          titleLanguage={titleLanguage}
          heading="Board"
          hint={`${count(placed, 'title')} ${placed === 1 ? 'has' : 'have'} a Band. Drag a title to another Band.`}
          mainLabel={
            <>
              ← Back to Rough Sort<span className="hide-m"> · {total - done} left</span>
            </>
          }
          onMain={() => goTo('ranking')}
          onMove={moveTitle}
          onUndo={shared.onUndo}
        />
      )
    }
    case 'rough-sort': {
      const { prompt } = shown
      return (
        <RoughSortScreen
          {...shared}
          key={prompt.id}
          id={prompt.id}
          onBand={(band, sub) => answer(withSub({ type: 'band-assigned', id: prompt.id, band }, sub))}
          onForget={() => answer({ type: 'forgotten', id: prompt.id })}
          onBoard={state.board.open ? props.onOpenBoard : undefined}
        />
      )
    }
    case 'band-choice': {
      const { prompt } = shown
      return (
        <BandChoiceScreen
          key={`${state.bandChoice?.finished ?? 'none'}-${state.bandChoice?.next ?? prompt.band}`}
          state={state}
          entries={entries}
          titleLanguage={titleLanguage}
          finished={state.bandChoice?.finished ?? null}
          next={state.bandChoice?.next ?? prompt.band}
          onChoose={props.onChooseBand}
          onUndo={shared.onUndo}
          onBoard={state.board.open ? props.onOpenBoard : undefined}
        />
      )
    }
    case 'duel': {
      const { prompt } = shown
      // Against an Anchor (Keep My Scale, ADR 0009): no Band to choose, nothing to move.
      const inBand = prompt.kind === 'duel'
      const { previewFix } = props
      const fixing = previewFix?.id === prompt.a ? `${previewFix.verb}: ${props.nameOf(prompt.a)}` : undefined
      return (
        <DuelScreen
          {...shared}
          prompt={prompt}
          onChooseBand={inBand ? () => goTo('bands') : undefined}
          onPick={(winner) => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: winner === prompt.a ? 'a' : 'b' })}
          onTie={() => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'tie' })}
          onForget={(id) => answer({ type: 'forgotten', id })}
          onMove={inBand ? moveTitle : undefined}
          note={fixing ?? (inBand && prompt.refine ? 'Refine' : undefined)}
          early={early}
        />
      )
    }
    case 'closer-to': {
      // Keep My Scale (#48): which of the two scores the title sits between is it closer to.
      const { prompt } = shown
      return (
        <CloserToScreen
          key={prompt.id}
          state={state}
          prompt={prompt}
          entries={entries}
          titleLanguage={titleLanguage}
          onPick={(level) => answer({ type: 'closer-to-answered', id: prompt.id, level })}
          onUndo={shared.onUndo}
          early={early}
        />
      )
    }
    case 'complete':
      return <CompleteScreen {...shared} onScore={openPreview} />
  }
}
