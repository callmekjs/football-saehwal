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
 */
import { useState } from 'react'
import { getPlayer } from '../sim/squad'
import type { MatchState, PlayerState, Position } from '../sim/types'
import { attributeTone, playerDataOf, type PlayerData } from './playerData'

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

function PlayerRow({
  state,
  starting,
  picked,
  swappable,
  onPick,
}: {
  state: PlayerState
  starting: boolean
  picked: boolean
  swappable: boolean
  onPick: () => void
}) {
  const data = playerDataOf(state)
  const player = getPlayer(state.id)
  const moved = data.basePosition !== data.currentPosition
  const rows = data.attributeGroups.flatMap((group) => group.rows)
  const used = rows.filter((row) => row.used)
  const out = data.availability === 'OUT'

  return (
    <li
      className="squad-row"
      data-out={out ? 'on' : undefined}
      data-picked={picked ? 'on' : undefined}
      data-swappable={swappable ? 'on' : undefined}
    >
      <span className="squad-row-id">
        <b>{player.num}</b>
        <small>{POSITION_LABEL[data.basePosition]}</small>
      </span>

      <span className="squad-row-tags">
        {data.star && <em data-star="on">스타</em>}
        {starting ? <em data-role="start">선발</em> : <em>벤치</em>}
        {moved && <em>현재 {POSITION_LABEL[data.currentPosition]}</em>}
        {data.booked && <em data-alert="on">경고</em>}
        {data.availability === 'OUT' && <em data-alert="on">이탈</em>}
      </span>

      <span className="squad-row-condition">
        <small>컨디션</small>
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

      {/* 경기 계산에 실제로 들어가는 값만 줄에 세운다. 나머지는 카드에서 본다 */}
      <span className="squad-row-key">
        {used.map((row) => (
          <span key={row.key}>
            <small>{row.label}</small>
            <b data-tone={attributeTone(row.value)}>{row.value}</b>
          </span>
        ))}
      </span>

      <span className="squad-row-note">{strengthOf(data)}</span>

      {/*
        선발과 벤치를 감독이 정한다. 같은 포지션끼리만 바꾼다 — 4-4-2 에
        수비수를 다섯 세우면 대형이 뜻을 잃고 화면 자리도 어긋난다.
      */}
      <button
        type="button"
        className="squad-row-pick"
        onClick={onPick}
        disabled={out}
        aria-pressed={picked}
      >
        {out ? '이탈' : picked ? '선택 취소' : starting ? '바꾸기' : swappable ? '여기로' : '선발로'}
      </button>
    </li>
  )
}

/** 이번 판에 뛸 열한 명. 같은 포지션끼리만 맞바꾼다 */
export interface LineupControl {
  starters: ReadonlySet<string>
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
  const starters = new Set(
    state.players.filter((s) => s.onPitch && !s.out).map((s) => s.id),
  )

  const pickedPos = picked ? getPlayer(picked).pos : null
  const pickedStarting = picked !== null && starters.has(picked)

  const handlePick = (id: string) => {
    if (!lineup) return
    if (picked === id) {
      setPicked(null)
      return
    }
    if (picked === null) {
      setPicked(id)
      return
    }
    // 같은 포지션이고 한쪽이 선발, 한쪽이 벤치일 때만 맞바꾼다
    const sameGroup = getPlayer(picked).pos === getPlayer(id).pos
    const opposite = starters.has(picked) !== starters.has(id)
    if (sameGroup && opposite) {
      const starterId = starters.has(picked) ? picked : id
      const benchId = starters.has(picked) ? id : picked
      lineup.onSwap(starterId, benchId)
      setPicked(null)
      return
    }
    setPicked(id)
  }
  const groups = ORDER.map((pos) => ({
    pos,
    players: state.players.filter((s) => getPlayer(s.id).pos === pos),
  })).filter((group) => group.players.length > 0)

  const onPitch = state.players.filter((s) => s.onPitch && !s.out)
  const meanStamina =
    onPitch.length === 0
      ? 0
      : onPitch.reduce((sum, s) => sum + s.stamina, 0) / onPitch.length
  const tired = onPitch.filter((s) => s.stamina < 45).length

  return (
    <section id="squad" className="squad-section" aria-labelledby="squad-title">
      <div className="kickoff-section-head">
        <div className="kickoff-section-label">
          <i aria-hidden>01</i>
          <div>
            <small>우리 팀</small>
            <h2 id="squad-title">선수 {state.players.length}명</h2>
          </div>
        </div>
        <p>능력과 컨디션은 판마다 다시 정해집니다. 아래 값이 곧 시작할 경기의 값입니다.</p>
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

      {lineup && (
        <div className="squad-lineup-bar">
          <span>
            {picked === null
              ? '선수를 고른 뒤 같은 포지션의 다른 선수를 고르면 선발과 벤치가 바뀝니다.'
              : `${getPlayer(picked).num}번을 골랐습니다. 바꿀 ${POSITION_LABEL[pickedPos ?? 'MF']} 선수를 고르세요.`}
          </span>
          {lineup.changed && (
            <button type="button" className="chip" onClick={lineup.onReset}>
              기본 선발로
            </button>
          )}
        </div>
      )}

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
      </dl>

      {groups.map((group) => (
        <div className="squad-group" key={group.pos}>
          <h3>
            {POSITION_LABEL[group.pos]}
            <small>{group.players.length}명</small>
          </h3>
          <ul className="squad-list">
            {group.players
              .slice()
              .sort((a, b) => {
                const startDiff = Number(starters.has(b.id)) - Number(starters.has(a.id))
                if (startDiff !== 0) return startDiff
                return getPlayer(a.id).num - getPlayer(b.id).num
              })
              .map((s) => (
                <PlayerRow
                  key={s.id}
                  state={s}
                  starting={starters.has(s.id)}
                  picked={picked === s.id}
                  swappable={
                    picked !== null &&
                    picked !== s.id &&
                    pickedPos === getPlayer(s.id).pos &&
                    pickedStarting !== starters.has(s.id)
                  }
                  onPick={() => handlePick(s.id)}
                />
              ))}
          </ul>
        </div>
      ))}

      <p className="squad-section-note">
        선수는 전부 창작이며 이름 없이 등번호로만 식별합니다. 위치를 옮긴 선수는
        현재 역할이 함께 표시되고, 실점·득점 계산은 그 현재 역할을 봅니다.
      </p>
    </section>
  )
}
