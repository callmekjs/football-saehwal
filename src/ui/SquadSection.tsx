/**
 * 01 · 우리 팀.
 *
 * 사용자가 정했다 — *"01 제목은 만들어주고 = 현재 우리팀 선수들 스텟과
 * 상태"*.
 *
 * **명단이 아니라 이 판의 상태를 읽는다.** 능력과 컨디션은 판마다 주인이
 * 바뀌므로(`shuffleAbility` · `shuffleCondition`) 여기 보이는 값은 곧
 * 시작할 그 경기의 값이다. 홈에서 43으로 보인 선수가 경기장에 들어가
 * 70이 되는 일이 없어야 한다.
 *
 * 계산은 하나도 하지 않는다. `playerDataOf` 가 이미 만든 읽기 모델을
 * 그대로 그린다.
 *
 * ## 배치
 *
 * 사용자가 정했다 — *"선발 벤치 선택하는 게 너무 불편하다"*.
 *
 * 전에는 스물여섯 명이 포지션별 네 덩어리로 **한 줄씩 세로로** 늘어섰고
 * 선발과 벤치가 같은 목록에 섞여 꼬리표로만 갈렸다. 1600×1000 실측으로
 * 목록 높이가 1606px여서 805px를 스크롤해야 했고, **지금 뛰는 열한 명을
 * 한 화면에서 볼 수 없었다.**
 *
 * 그래서 **선발과 교체 후보를 두 열로 갈랐다.** 왼쪽은 언제나 지금 뛰는
 * 사람들이고 오른쪽은 바꿔 넣을 수 있는 사람들이다. 한쪽을 고르면 반대
 * 열에서 **바꿀 수 있는 사람만 살아남고** 나머지는 눌리지 않는다. 짝을
 * 찾으러 목록을 훑을 일이 없다.
 */
import { useState } from 'react'
import { getPlayer } from '../sim/squad'
import type { MatchState, PlayerState, Position } from '../sim/types'
import { attributeTone, playerDataOf, summaryRowsOf, type PlayerData } from './playerData'

const POSITION_LABEL: Record<Position, string> = {
  GK: '골키퍼',
  DF: '수비',
  MF: '중원',
  FW: '공격',
}

const ORDER: readonly Position[] = ['GK', 'DF', 'MF', 'FW']

function conditionTone(stamina: number): 'safe' | 'warn' | 'danger' {
  if (stamina < 45) return 'danger'
  if (stamina < 60) return 'warn'
  return 'safe'
}

/** 이 선수가 무엇으로 팀에 기여하는지 한 줄. 능력치에서 뽑는다 */
function strengthOf(data: PlayerData): string {
  const rows = data.attributeGroups.flatMap((group) => group.rows)
  const best = [...rows].sort((a, b) => b.value - a.value)[0]
  const worst = [...rows].sort((a, b) => a.value - b.value)[0]
  return `${best.label} ${best.value} · 약점 ${worst.label} ${worst.value}`
}

/**
 * 카드가 지금 어떤 상태인가.
 *
 * 전에는 버튼 글자가 `바꾸기`·`여기로`·`선발로`·`선택 취소` 넷 사이를
 * 오갔다. 무엇을 누르는지 예측이 안 됐다. 이제 **눈에 보이는 상태 하나에
 * 글자 하나**가 붙는다.
 */
type CardState = 'IDLE' | 'PICKED' | 'TARGET' | 'MUTED' | 'OUT'

const CARD_CUE: Record<CardState, string> = {
  IDLE: '',
  PICKED: '선택됨',
  TARGET: '맞바꾸기',
  MUTED: '',
  OUT: '이탈',
}

function PlayerCard({
  state,
  cardState,
  open,
  onToggleOpen,
  onPick,
  onDragBegin,
  onDropPlayer,
}: {
  state: PlayerState
  cardState: CardState
  open: boolean
  onToggleOpen: () => void
  onPick: () => void
  /** 끌기 시작. 이 선수를 고른 것으로 쳐서 놓을 자리를 밝힌다 */
  onDragBegin: () => void
  /** 끌어다 놓은 선수의 id. 맞바꿀 수 없으면 부르는 쪽이 무시한다 */
  onDropPlayer: (fromId: string) => void
}) {
  const data = playerDataOf(state)
  const player = getPlayer(state.id)
  const moved = data.basePosition !== data.currentPosition
  const summary = summaryRowsOf(data)
  const locked = cardState === 'OUT' || cardState === 'MUTED'
  const [over, setOver] = useState(false)

  return (
    <li
      className="squad-pick"
      data-state={cardState}
      data-star={data.star ? 'on' : undefined}
      data-over={over ? 'on' : undefined}
      onDragOver={(event) => {
        if (cardState !== 'TARGET') return
        // 기본 동작을 막아야 드롭이 허용된다
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false)
        if (cardState !== 'TARGET') return
        event.preventDefault()
        const from = event.dataTransfer.getData('text/plain')
        if (from) onDropPlayer(from)
      }}
    >
      {/*
        카드 전체가 표적이다. 전에는 줄 오른쪽 끝의 30px 버튼 하나만
        눌렸는데, 이 저장소는 조작 요소 최소 높이를 44px로 정해뒀다.

        드래그는 **빠른 길**이지 유일한 길이 아니다. 같은 일이 두 번 탭으로
        똑같이 된다.
      */}
      <button
        type="button"
        className="squad-pick-main"
        onClick={onPick}
        disabled={locked}
        aria-pressed={cardState === 'PICKED'}
        draggable={!locked}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', state.id)
          event.dataTransfer.effectAllowed = 'move'
          // 끌기도 선택이다. 이걸 빼면 먼저 탭하지 않은 채 끈 카드는
          // 놓을 자리가 하나도 밝지 않아 드롭이 통째로 거부된다
          onDragBegin()
        }}
      >
        <span className="squad-pick-id">
          <b>{player.num}</b>
          <small>{POSITION_LABEL[data.basePosition]}</small>
        </span>

        <span className="squad-pick-tags">
          {data.star && <em data-star="on">스타</em>}
          {moved && <em>현재 {POSITION_LABEL[data.currentPosition]}</em>}
          {data.booked && <em data-alert="on">경고</em>}
          {data.hasOrder && <em>지시</em>}
        </span>

        <span className="squad-pick-cond">
          <i aria-hidden>
            <b
              style={{ width: `${Math.round(data.stamina)}%` }}
              data-tone={conditionTone(data.stamina)}
            />
          </i>
          <strong aria-label={`체력 ${Math.round(data.stamina)}`}>
            {Math.round(data.stamina)}
          </strong>
        </span>

        {/*
          포지션마다 다른 세 칸을 세운다. 어느 셋인지는 `summaryRowsOf` 가
          정하고, 경기 계산에 실제로 쓰이는 칸에는 점이 붙는다.
        */}
        <span className="squad-pick-attrs">
          {summary.map((row) => (
            <span key={row.key} data-used={row.used ? 'on' : undefined}>
              <small>{row.label}</small>
              <b data-tone={attributeTone(row.value)}>{row.value}</b>
            </span>
          ))}
        </span>

        <span className="squad-pick-cue">{CARD_CUE[cardState]}</span>
      </button>

      <button
        type="button"
        className="squad-pick-more"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={`${player.num}번 능력치 ${open ? '접기' : '펼치기'}`}
      >
        능력치
      </button>

      {open && (
        <div className="squad-pick-detail">
          <p className="squad-pick-strength">{strengthOf(data)}</p>
          <dl className="squad-pick-profile">
            <div>
              <dt>주발</dt>
              <dd>{data.profile.foot}</dd>
            </div>
            <div>
              <dt>신장</dt>
              <dd>{data.profile.height}cm</dd>
            </div>
            <div>
              <dt>체중</dt>
              <dd>{data.profile.weight}kg</dd>
            </div>
            <div>
              <dt>체력 기준</dt>
              <dd>{data.rosterStamina}</dd>
            </div>
          </dl>
          <div className="squad-pick-groups">
            {data.attributeGroups.map((group) => (
              <div key={group.title}>
                <h5>{group.title}</h5>
                <ul>
                  {group.rows.map((row) => (
                    <li key={row.key} data-used={row.used ? 'on' : undefined}>
                      <small>{row.label}</small>
                      <b data-tone={attributeTone(row.value)}>{row.value}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * 이번 판에 뛸 열한 명. 같은 포지션끼리만 맞바꾼다.
 *
 * 누가 선발인지는 **받지 않는다.** `state.players` 의 `onPitch` 가 이미
 * 그 답이고, 부모가 따로 넘긴 목록과 어긋나면 화면이 두 가지 진실을
 * 갖게 된다.
 */
export interface LineupControl {
  onSwap: (starterId: string, benchId: string) => void
  onReset: () => void
  changed: boolean
}

export function SquadSection({
  state,
  lineup,
  rosterSeed = 0,
  onRefresh,
}: {
  state: MatchState
  lineup?: LineupControl
  /** 0 이면 손으로 적어둔 기본 명단이다 */
  rosterSeed?: number
  onRefresh?: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const starters = new Set(
    state.players.filter((s) => s.onPitch && !s.out).map((s) => s.id),
  )

  const pickedPos = picked ? getPlayer(picked).pos : null

  /** 이 둘을 맞바꿀 수 있는가. 같은 포지션이고 한쪽만 선발이어야 한다 */
  const canSwap = (a: string, b: string) =>
    a !== b &&
    getPlayer(a).pos === getPlayer(b).pos &&
    starters.has(a) !== starters.has(b)

  const swap = (a: string, b: string) => {
    if (!lineup || !canSwap(a, b)) return
    const starterId = starters.has(a) ? a : b
    const benchId = starters.has(a) ? b : a
    lineup.onSwap(starterId, benchId)
    setPicked(null)
  }

  const handlePick = (id: string) => {
    if (!lineup) return
    if (picked === id) {
      setPicked(null)
      return
    }
    if (picked !== null && canSwap(picked, id)) {
      swap(picked, id)
      return
    }
    setPicked(id)
  }

  const cardStateOf = (s: PlayerState): CardState => {
    if (s.out) return 'OUT'
    if (!lineup) return 'IDLE'
    if (picked === s.id) return 'PICKED'
    if (picked === null) return 'IDLE'
    return canSwap(picked, s.id) ? 'TARGET' : 'MUTED'
  }

  const rank = (s: PlayerState) => ORDER.indexOf(getPlayer(s.id).pos)
  const byPositionThenNumber = (a: PlayerState, b: PlayerState) =>
    rank(a) - rank(b) || getPlayer(a.id).num - getPlayer(b.id).num

  const onPitch = state.players
    .filter((s) => s.onPitch && !s.out)
    .sort(byPositionThenNumber)
  const reserves = state.players.filter((s) => !s.onPitch || s.out)
  const benchCount = reserves.filter((s) => !s.out).length

  const meanStamina =
    onPitch.length === 0
      ? 0
      : onPitch.reduce((sum, s) => sum + s.stamina, 0) / onPitch.length
  const tired = onPitch.filter((s) => s.stamina < 45).length
  const stars = state.players.filter((s) => playerDataOf(s).star).length

  const reserveGroups = ORDER.map((pos) => ({
    pos,
    players: reserves
      .filter((s) => getPlayer(s.id).pos === pos)
      .sort((a, b) => Number(a.out) - Number(b.out) || getPlayer(a.id).num - getPlayer(b.id).num),
  })).filter((group) => group.players.length > 0)

  const renderCard = (s: PlayerState) => (
    <PlayerCard
      key={s.id}
      state={s}
      cardState={cardStateOf(s)}
      open={open === s.id}
      onToggleOpen={() => setOpen((id) => (id === s.id ? null : s.id))}
      onPick={() => handlePick(s.id)}
      onDragBegin={() => setPicked(s.id)}
      onDropPlayer={(fromId) => swap(fromId, s.id)}
    />
  )

  return (
    <section id="squad" className="squad-section" aria-labelledby="squad-title">
      <div className="kickoff-section-head squad-head">
        <div className="kickoff-section-label">
          <i aria-hidden>01</i>
          <div>
            <small>우리 팀</small>
            <h2 id="squad-title">선수 {state.players.length}명</h2>
          </div>
        </div>
        <p>능력과 컨디션은 판마다 다시 정해집니다. 아래 값이 곧 시작할 경기의 값입니다.</p>
        <div className="squad-head-actions">
          {lineup?.changed && (
            <button type="button" className="squad-reset" onClick={lineup.onReset}>
              기본 선발로
            </button>
          )}
          {onRefresh && (
            <button type="button" className="squad-refresh" onClick={onRefresh}>
              <b>명단 다시 뽑기</b>
              <small>
                {rosterSeed === 0
                  ? '능력치를 새로 뽑습니다 · 낮은 확률로 스타가 나옵니다'
                  : `${rosterSeed}번째 명단 · 다시 누르면 또 바뀝니다`}
              </small>
            </button>
          )}
        </div>
      </div>

      <dl className="squad-summary">
        <div>
          <dt>대형</dt>
          <dd>{state.formation}</dd>
        </div>
        <div>
          <dt>피치 위</dt>
          <dd>{onPitch.length}명</dd>
        </div>
        <div>
          <dt>평균 컨디션</dt>
          <dd data-tone={conditionTone(meanStamina)}>{Math.round(meanStamina)}</dd>
        </div>
        <div>
          <dt>45 아래</dt>
          <dd data-tone={tired > 0 ? 'warn' : 'safe'}>{tired}명</dd>
        </div>
        <div data-star={stars > 0 ? 'on' : undefined}>
          <dt>스타</dt>
          <dd data-tone={stars > 0 ? 'star' : undefined}>{stars}명</dd>
        </div>
      </dl>

      {lineup && (
        <div className="squad-lineup-bar" aria-live="polite">
          <span>
            {picked === null
              ? '선수를 고른 뒤 같은 포지션의 다른 선수를 고르면 선발과 벤치가 바뀝니다. 카드를 끌어다 놓아도 됩니다.'
              : `${getPlayer(picked).num}번을 골랐습니다. 바꿀 ${POSITION_LABEL[pickedPos ?? 'MF']} 선수를 고르세요.`}
          </span>
          {picked !== null && (
            <button type="button" className="chip" onClick={() => setPicked(null)}>
              선택 취소
            </button>
          )}
        </div>
      )}

      {/*
        왼쪽은 지금 뛰는 사람, 오른쪽은 바꿔 넣을 사람. 한쪽을 고르면 반대
        열에서 맞바꿀 수 있는 카드만 살아난다.
      */}
      <div className="squad-columns">
        <div className="squad-col" data-side="start">
          <h3>
            선발
            <small>{onPitch.length}명</small>
          </h3>
          <ul className="squad-list">{onPitch.map(renderCard)}</ul>
        </div>

        <div className="squad-col" data-side="bench">
          <h3>
            교체 후보
            <small>{benchCount}명</small>
          </h3>
          {reserveGroups.map((group) => (
            <div className="squad-bench-group" key={group.pos}>
              <h4>
                {POSITION_LABEL[group.pos]}
                <small>{group.players.length}명</small>
              </h4>
              <ul className="squad-list">{group.players.map(renderCard)}</ul>
            </div>
          ))}
        </div>
      </div>

      <p className="squad-section-note">
        선수는 전부 창작이며 이름 없이 등번호로만 식별합니다. 위치를 옮긴 선수는
        현재 역할이 함께 표시되고, 실점·득점 계산은 그 현재 역할을 봅니다. 줄에
        세운 세 칸은 그 포지션을 설명하는 값이고, <b data-legend="used">점이 붙은 칸</b>은
        경기 계산에 실제로 들어갑니다. 나머지 능력치는 <b>능력치</b>를 눌러 봅니다.
      </p>
    </section>
  )
}
