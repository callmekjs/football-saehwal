import { createRng, type Rng } from '../sim/rng'
import { getFormation, slotsForTenMen } from '../sim/formations'
import { getPlayer } from '../sim/squad'
import type { MatchState, Position } from '../sim/types'

/**
 * 관전용 경기 연출.
 *
 * 밸런스가 걸린 시뮬레이션(src/sim)은 확률로 결과만 정한다. 이 모듈은 그
 * 결과를 실제 축구 장면으로 옮긴다. 시뮬이 "슛이 나왔다"고 하면 여기서
 * 실제로 공이 골대로 날아가고, 시뮬이 "점유가 넘어갔다"고 하면 여기서
 * 가장 가까운 수비수가 달려들어 뺏는 장면이 나온다.
 *
 * 이 모듈은 경기 결과에 아무 영향을 주지 않는다. 반대 방향으로만 흐른다.
 */

export const PITCH_W = 105
export const PITCH_H = 68

/**
 * 우리는 오른쪽(x=105) 골대를 공격한다.
 *
 * 골대는 골라인 위에 있고 폭은 7.32미터다. 실제 규격을 써야 슛이 골대
 * 안으로 들어가는지 밖으로 빗나가는지가 화면에서 구분된다.
 */
export const GOAL_LINE_HOME = 105
export const GOAL_LINE_AWAY = 0
export const GOAL_HALF = 3.66
export const GOAL_MID = PITCH_H / 2

const WALK = 1.4
const ACCEL = 8.5
const ARRIVE = 1.1
/**
 * 패스와 슛 속도 (초당 미터).
 *
 * 느리게 잡으면 공이 경기 시간의 절반 이상을 공중에서 보낸다. 그러면
 * 공이 사람 발에 있는 시간이 20%도 안 되고, 압박도 패스 연결도 화면에
 * 나타나지 않는다. 실제 축구의 짧은 패스는 초속 20미터 안팎이다.
 */
const PASS_SPEED = 26
const SHOT_SPEED = 34
/** 아무리 멀어도 이 시간 안에 도착한다 */
const PASS_MAX_T = 0.7
const SHOT_MAX_T = 0.8
/** 공을 발밑에 두는 거리 */
const CONTROL_DIST = 1.3

export interface VPlayer {
  id: string
  num: number
  side: 'HOME' | 'AWAY'
  pos: Position
  x: number
  y: number
  vx: number
  vy: number
  tx: number
  ty: number
  /**
   * 부드럽게 따라가는 실제 목표.
   *
   * 역할이 바뀌는 순간 tx·ty 는 반대편으로 튈 수 있다. 몸이 그걸 그대로
   * 따라가면 홱홱 꺾이는 갈지자가 된다. 사람은 방향을 눌러서 바꾼다.
   */
  stx: number
  sty: number
  /** 이 자리가 원래 자기 자리 */
  homeX: number
  homeY: number
  top: number
  stamina: number
  booked: boolean
  /** 방금 태클을 시도해 몸이 무너진 상태. 잠깐 못 움직인다 */
  recover: number
}

export type BallMode = 'HELD' | 'PASS' | 'SHOT' | 'LOOSE'

export interface VBall {
  x: number
  y: number
  mode: BallMode
  /** HELD 일 때 공을 가진 선수 */
  holder: string | null
  /** 날아가는 중일 때 */
  fromX: number
  fromY: number
  toX: number
  toY: number
  t: number
  dur: number
  /** 도착하면 이 선수가 받는다 */
  targetId: string | null
  /** 날아가는 높이. 그림자와 크기에 쓰인다 */
  lift: number
  /** 이 슛은 골로 끝난다. 시뮬이 이미 득점으로 판정한 슛이다 */
  willScore: boolean
}

export interface Flash {
  kind: 'TACKLE' | 'GOAL' | 'SAVE' | 'SHOT'
  x: number
  y: number
  life: number
}

/** 골이 들어간 직후의 연출 상태. 이게 없으면 골이 사건으로 안 보인다 */
export interface Celebration {
  side: 'HOME' | 'AWAY'
  /** 남은 시간(초). 0이 되면 킥오프로 넘어간다 */
  life: number
  /** 공이 골망에 박힌 자리 */
  x: number
  y: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** 상대 기본 배치. 성향에 따라 통째로 앞뒤로 옮겨간다 */
const AWAY_SHAPE: Array<[Position, number, number]> = [
  ['GK', 103, 34],
  ['DF', 84, 12],
  ['DF', 86, 27],
  ['DF', 86, 41],
  ['DF', 84, 56],
  ['MF', 66, 14],
  ['MF', 64, 29],
  ['MF', 64, 39],
  ['MF', 66, 54],
  ['FW', 46, 27],
  ['FW', 46, 41],
]
const AWAY_NUMS = [1, 2, 5, 4, 3, 7, 8, 10, 6, 9, 11]

const TOP_SPEED: Record<Position, number> = { GK: 5.2, DF: 7.4, MF: 7.6, FW: 8.0 }

export class VisualMatch {
  players: VPlayer[] = []
  ball: VBall
  flashes: Flash[] = []
  /** 골이 들어간 뒤의 세리머니. 이 동안은 경기가 멈춰 있다 */
  celebration: Celebration | null = null
  private rng: Rng
  private decideIn = 0
  private lastStats = { homeShot: 0, awayShot: 0 }
  private lastScore: [number, number] = [0, 0]
  private lastOwner: 'HOME' | 'AWAY' = 'HOME'
  private lastFormation = ''
  private lastHomeCount = 11
  /** 관전 시계 (초). 추격조 유지 시간 계산에 쓴다 */
  private clock = 0
  /** 압박 게이지. 상대가 발밑에 붙어 있던 시간이 쌓인다 */
  private pressure = 0
  private chaseIds: Record<'HOME' | 'AWAY', string[]> = { HOME: [], AWAY: [] }
  private chaseAt: Record<'HOME' | 'AWAY', number> = { HOME: -9, AWAY: -9 }

  constructor(state: MatchState, seed: number) {
    this.rng = createRng((seed ^ 0x5bf03635) >>> 0)
    this.ball = {
      x: PITCH_W / 2,
      y: PITCH_H / 2,
      mode: 'HELD',
      holder: null,
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      t: 0,
      dur: 0,
      targetId: null,
      lift: 0,
      willScore: false,
    }
    this.rebuild(state)
    this.lastScore = [...state.score] as [number, number]
    this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
    this.lastOwner = state.ball.owner
    const centre = this.players.find((p) => p.side === 'HOME' && p.pos === 'MF')
    if (centre) this.giveTo(centre)
  }

  /** 포메이션·인원이 바뀌면 자리를 다시 만든다 */
  private rebuild(state: MatchState) {
    const tenMen = state.homeCount < 11
    const slots = tenMen
      ? slotsForTenMen(state.formation)
      : getFormation(state.formation).slots
    const onPitch = state.players.filter((s) => s.onPitch && !s.out)

    const keep = new Map(this.players.map((p) => [p.id, p]))
    const next: VPlayer[] = []

    slots.forEach((slot, i) => {
      const s = onPitch[i]
      const info = s ? getPlayer(s.id) : null
      const num = info?.num ?? 0
      const id = `H${num}`
      const prev = keep.get(id)
      next.push({
        id,
        num,
        side: 'HOME',
        pos: slot.pos,
        x: prev?.x ?? slot.x,
        y: prev?.y ?? slot.y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        tx: slot.x,
        ty: slot.y,
        stx: prev?.stx ?? slot.x,
        sty: prev?.sty ?? slot.y,
        homeX: slot.x,
        homeY: slot.y,
        top: TOP_SPEED[slot.pos],
        stamina: s?.stamina ?? 100,
        booked: s?.booked ?? false,
        recover: prev?.recover ?? 0,
      })
    })

    const awayLimit = state.awayCount === 11 ? 11 : 10
    AWAY_SHAPE.slice(0, awayLimit).forEach(([pos, x, y], i) => {
      const num = AWAY_NUMS[i]
      const id = `A${num}`
      const prev = keep.get(id)
      next.push({
        id,
        num,
        side: 'AWAY',
        pos,
        x: prev?.x ?? x,
        y: prev?.y ?? y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        tx: x,
        ty: y,
        stx: prev?.stx ?? x,
        sty: prev?.sty ?? y,
        homeX: x,
        homeY: y,
        top: TOP_SPEED[pos],
        stamina: 84,
        booked: false,
        recover: prev?.recover ?? 0,
      })
    })

    this.players = next
    this.lastFormation = state.formation
    this.lastHomeCount = state.homeCount
  }

  private byId(id: string | null): VPlayer | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined
  }

  private giveTo(p: VPlayer) {
    this.ball.mode = 'HELD'
    this.ball.holder = p.id
    this.ball.targetId = null
    this.ball.lift = 0
    // 주인이 바뀌었으니 압박은 처음부터 다시 쌓이고, 추격조도 새로 짠다
    this.pressure = 0
    this.chaseAt.HOME = -9
    this.chaseAt.AWAY = -9
    // 공을 잡는 순간 발밑으로 붙인다. 서서히 다가가게 두면 몇 프레임 동안
    // 공이 주인과 떨어져 있어 "누가 가진 건지" 알 수 없다
    const dir = p.side === 'HOME' ? 1 : -1
    this.ball.x = p.x + dir * CONTROL_DIST
    this.ball.y = p.y
    // 잡자마자 곧바로 내주지 않는다. 받아서 살피고 한두 번 터치한 뒤 준다.
    // 이 시간이 짧으면 공이 경기 내내 공중에 떠 있고, 수비수가 붙을
    // 틈도 없어 압박이 화면에 나타나지 않는다
    this.decideIn = 0.5 + this.rng.next() * 0.6
  }

  private flash(kind: Flash['kind'], x: number, y: number) {
    this.flashes.push({ kind, x, y, life: kind === 'GOAL' ? 1.4 : 0.55 })
  }

  /**
   * 시뮬레이션 상태를 읽어 연출을 맞춘다.
   *
   * 시뮬이 결정한 것: 누가 공을 가졌는지(팀 단위), 슛이 나왔는지, 골이
   * 들어갔는지. 그것을 실제 장면으로 옮기는 것이 여기 할 일이다.
   */
  sync(state: MatchState) {
    if (state.formation !== this.lastFormation || state.homeCount !== this.lastHomeCount) {
      this.rebuild(state)
    }

    // 체력·경고를 갱신한다. 지친 선수는 실제로 느려진다
    const onPitch = state.players.filter((s) => s.onPitch && !s.out)
    const slots = state.homeCount < 11
      ? slotsForTenMen(state.formation)
      : getFormation(state.formation).slots
    slots.forEach((_, i) => {
      const s = onPitch[i]
      if (!s) return
      const v = this.byId(`H${getPlayer(s.id).num}`)
      if (v) {
        v.stamina = s.stamina
        v.booked = s.booked
      }
    })

    // 수비라인·폭 설정을 자기 자리에 반영한다
    const lineShift = (state.tactics.line - 1) * 8
    const widthScale = 0.8 + state.tactics.width * 0.18
    slots.forEach((slot, i) => {
      const s = onPitch[i]
      if (!s) return
      const v = this.byId(`H${getPlayer(s.id).num}`)
      if (!v || slot.pos === 'GK') return
      v.homeX = slot.x + lineShift
      v.homeY = 34 + (slot.y - 34) * widthScale
    })
    const mood = state.opponent === 'ALL_OUT' ? -13 : state.opponent === 'PARK_BUS' ? 11 : 0
    AWAY_SHAPE.forEach(([pos, x, y], i) => {
      const v = this.byId(`A${AWAY_NUMS[i]}`)
      if (!v) return
      v.homeX = pos === 'GK' ? x : x + mood
      v.homeY = y
    })

    // 세리머니 중에는 새 사건을 받지 않는다
    if (this.celebration) {
      this.lastScore = [...state.score] as [number, number]
      this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
      this.lastOwner = state.ball.owner
      return
    }

    const scored = state.score[0] - this.lastScore[0]
    const conceded = state.score[1] - this.lastScore[1]
    const newHomeShot = state.stats.homeShot - this.lastStats.homeShot
    const newAwayShot = state.stats.awayShot - this.lastStats.awayShot
    this.lastScore = [...state.score] as [number, number]
    this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }

    // 골 — 시뮬이 점수를 올렸으면 실제로 골망에 꽂히는 슛을 만든다.
    // 여기서 바로 킥오프로 넘기면 골이 사건으로 보이지 않는다
    if (scored > 0 || conceded > 0) {
      const side = scored > 0 ? 'HOME' : 'AWAY'
      const shooter = this.pickShooter(side)
      if (shooter) this.shoot(shooter, true)
      this.lastOwner = state.ball.owner
      return
    }

    // 슛 — 시뮬이 슈팅 상황을 셌으면 골대로 차되 막히거나 빗나간다
    if (newHomeShot > 0 || newAwayShot > 0) {
      const side = newHomeShot > 0 ? 'HOME' : 'AWAY'
      const shooter = this.pickShooter(side)
      if (shooter) this.shoot(shooter, false)
    }

    // 점유 전환 — 가장 가까운 상대가 뺏는 장면으로 만든다
    if (state.ball.owner !== this.lastOwner) {
      this.lastOwner = state.ball.owner
      const holder = this.byId(this.ball.holder)
      if (this.ball.mode === 'HELD' && holder && holder.side !== state.ball.owner) {
        const taker = this.nearestOf(state.ball.owner, holder)
        if (taker) {
          this.flash('TACKLE', this.ball.x, this.ball.y)
          holder.recover = 0.5
          this.giveTo(taker)
        }
      }
    }
  }

  /**
   * 슛을 쏠 선수를 고른다.
   *
   * 공을 가지고 있으면 그 선수가 쏜다. 아니면 상대 골대에 가장 가까운
   * 공격 자원이 쏜다 — 자기 진영 수비수가 슛을 쏘면 축구로 안 보인다.
   */
  private pickShooter(side: 'HOME' | 'AWAY'): VPlayer | undefined {
    const holder = this.byId(this.ball.holder)
    if (holder?.side === side && holder.pos !== 'GK') return holder

    const gx = this.goalX(side)
    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      if (p.side !== side || p.pos === 'GK' || p.pos === 'DF') continue
      const d = Math.abs(p.x - gx)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best ?? this.nearestOf(side, { x: gx, y: GOAL_MID })
  }

  private nearestOf(side: 'HOME' | 'AWAY', to: { x: number; y: number }): VPlayer | undefined {
    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      if (p.side !== side || p.pos === 'GK') continue
      const d = dist(p, to)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  /**
   * 중앙 킥오프.
   *
   * 축구 규칙대로 **먹힌 팀이 센터서클에서 다시 시작한다.** 전원이 자기
   * 진영으로 돌아가고, 차는 선수만 센터서클에 선다.
   */
  private kickoff(side: 'HOME' | 'AWAY') {
    for (const p of this.players) {
      p.x = p.homeX
      p.y = p.homeY
      p.vx = 0
      p.vy = 0
      p.recover = 0
      // 킥오프 순간에는 양 팀이 하프라인을 넘지 않는다
      if (p.side === 'HOME' && p.x > PITCH_W / 2 - 2) p.x = PITCH_W / 2 - 2 - (p.x - PITCH_W / 2) * 0.3
      if (p.side === 'AWAY' && p.x < PITCH_W / 2 + 2) p.x = PITCH_W / 2 + 2 + (PITCH_W / 2 - p.x) * 0.3
      p.x = clamp(p.x, 2, PITCH_W - 2)
      p.tx = p.x
      p.ty = p.y
      p.stx = p.x
      p.sty = p.y
    }
    this.ball.x = PITCH_W / 2
    this.ball.y = PITCH_H / 2
    this.ball.mode = 'HELD'
    this.ball.lift = 0

    const taker = this.nearestOf(side, { x: PITCH_W / 2, y: PITCH_H / 2 })
    if (taker) {
      // 차는 선수만 센터서클 안으로 들어온다
      taker.x = PITCH_W / 2 - (side === 'HOME' ? 1.5 : -1.5)
      taker.y = PITCH_H / 2
      this.giveTo(taker)
    }
  }

  /** 이 팀이 공격하는 골라인 */
  private goalX(side: 'HOME' | 'AWAY') {
    return side === 'HOME' ? GOAL_LINE_HOME : GOAL_LINE_AWAY
  }

  /**
   * 슛.
   *
   * 골로 끝날 슛은 골대 안쪽을 노리고, 아닌 슛은 골키퍼 정면이나 골대
   * 옆으로 간다. 시뮬이 이미 득점 여부를 정해뒀으므로 여기서는 그 결과에
   * 맞는 궤적을 그리기만 한다.
   */
  private shoot(shooter: VPlayer, willScore: boolean) {
    const gx = this.goalX(shooter.side)
    let gy: number
    if (willScore) {
      // 골대 안쪽. 구석으로 갈수록 그림이 산다
      const corner = this.rng.next() < 0.65 ? 1 : 0
      const sign = this.rng.next() < 0.5 ? -1 : 1
      gy = GOAL_MID + sign * (corner ? 2.2 + this.rng.next() * 1.2 : this.rng.next() * 1.6)
    } else {
      // 막히거나 빗나간다. 멀리서 쏠수록 골대를 벗어나기 쉽다 —
      // 10미터 20% → 25미터 53% → 35미터 75%. 가까운 슛은 골키퍼
      // 정면으로 가서 막히는 그림이 된다
      const dGoal = Math.hypot(gx - shooter.x, GOAL_MID - shooter.y)
      const wide = this.rng.next() < clamp(0.2 + (dGoal - 10) * 0.022, 0.2, 0.8)
      const sign = this.rng.next() < 0.5 ? -1 : 1
      gy = wide
        ? GOAL_MID + sign * (GOAL_HALF + 1 + this.rng.next() * (2 + dGoal * 0.06))
        : GOAL_MID + sign * this.rng.next() * 2
    }

    const d = Math.hypot(gx - shooter.x, gy - shooter.y)
    this.ball.mode = 'SHOT'
    this.ball.holder = null
    this.ball.fromX = shooter.x
    this.ball.fromY = shooter.y
    this.ball.toX = gx
    this.ball.toY = clamp(gy, 2, PITCH_H - 2)
    this.ball.t = 0
    this.ball.dur = clamp(d / SHOT_SPEED, 0.25, SHOT_MAX_T)
    this.ball.targetId = null
    this.ball.willScore = willScore
    this.flash('SHOT', shooter.x, shooter.y)
  }

  /** 패스 받을 사람을 고른다. 앞쪽이고 마크가 헐거운 동료 */
  private choosePass(holder: VPlayer): VPlayer | null {
    const dir = holder.side === 'HOME' ? 1 : -1
    let best: VPlayer | null = null
    let bestScore = -Infinity

    for (const p of this.players) {
      if (p.side !== holder.side || p.id === holder.id || p.pos === 'GK') continue
      // 짧은 패스가 기본이다. 매번 롱볼을 때리면 공이 계속 공중에 있다
      const d = dist(p, holder)
      if (d < 5 || d > 46) continue

      // 앞으로 갈수록 좋고, 상대가 붙어 있으면 나쁘다
      const forward = (p.x - holder.x) * dir
      const marker = this.players.reduce((m, o) => {
        if (o.side === holder.side) return m
        return Math.min(m, dist(o, p))
      }, Infinity)
      const score = forward * 0.9 + Math.min(marker, 18) * 1.4 - d * 0.25 + this.rng.next() * 6
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }

  private pass(holder: VPlayer, to: VPlayer) {
    // 받는 사람이 뛰어갈 자리로 찔러준다
    const lead = 0.35
    let tx = clamp(to.x + to.vx * lead, 2, PITCH_W - 2)
    let ty = clamp(to.y + to.vy * lead, 2, PITCH_H - 2)
    const d = Math.hypot(tx - holder.x, ty - holder.y)

    // 패스는 100% 붙지 않는다. 가까우면 거의 붙고 멀수록 성공률이
    // 떨어지며, 발밑에 상대가 붙은 채로 차면 더 나빠진다.
    // 8미터 0.97 → 20미터 0.83 → 35미터 0.65
    const oppNear = this.players.reduce((m, o) => {
      if (o.side === holder.side || o.pos === 'GK') return m
      return Math.min(m, dist(o, holder))
    }, Infinity)
    let success = 0.97 - Math.max(0, d - 8) * 0.012
    if (oppNear < 3) success -= 0.08
    success = clamp(success, 0.6, 0.97)

    let targetId: string | null = to.id
    if (this.rng.next() >= success) {
      // 빗나간다 — 리시버에 못 미치거나 옆으로 새서 주인 없는 공이 된다
      const ang = this.rng.next() * Math.PI * 2
      const off = 3 + this.rng.next() * 5
      tx = clamp(tx + Math.cos(ang) * off, 2, PITCH_W - 2)
      ty = clamp(ty + Math.sin(ang) * off, 2, PITCH_H - 2)
      targetId = null
    }

    this.ball.mode = 'PASS'
    this.ball.holder = null
    this.ball.fromX = this.ball.x
    this.ball.fromY = this.ball.y
    this.ball.toX = tx
    this.ball.toY = ty
    this.ball.t = 0
    this.ball.dur = clamp(d / PASS_SPEED, 0.14, PASS_MAX_T)
    this.ball.targetId = targetId
  }

  /** 공을 가진 선수가 무엇을 할지 정한다 */
  private decide(holder: VPlayer, dt: number) {
    const nearest = this.players.reduce((m, o) => {
      if (o.side === holder.side || o.pos === 'GK') return m
      return Math.min(m, dist(o, holder))
    }, Infinity)

    // 발밑까지 붙었으면 여유 부릴 시간이 없다. 원터치로 내준다.
    // 이게 없으면 수비수가 몸에 붙었는데 태연히 공을 몰고 다닌다
    if (nearest < 2.6) this.decideIn = Math.min(this.decideIn, 0.06)

    this.decideIn -= dt
    if (this.decideIn > 0) return

    const target = this.choosePass(holder)

    // 쫓기면 빨리 내주고, 여유가 있으면 조금 몰고 간다.
    // 15분에 여든 번쯤 오가야 축구로 보인다 — 내주는 쪽이 기본이다
    const wantPass = nearest < 8 ? 0.96 : 0.72
    if (target && this.rng.next() < wantPass) {
      this.pass(holder, target)
    } else {
      // 내줄 데가 없으면 몰고 가며 다시 살핀다
      this.decideIn = 0.35 + this.rng.next() * 0.45
    }
  }

  /**
   * 압박 게이지.
   *
   * 상대가 발밑까지 붙은 시간이 쌓이면 공을 지킬 수 없다. 둘러싸일수록
   * 빨리 쌓인다. 이것이 없으면 수비수 셋이 몸에 붙어 있는데도 공을 영영
   * 안 뺏기는, 축구에서 있을 수 없는 그림이 나온다.
   */
  private updatePressure(holder: VPlayer, dt: number) {
    let nearest = Infinity
    let crowd = 0
    let taker: VPlayer | undefined
    for (const o of this.players) {
      if (o.side === holder.side || o.pos === 'GK' || o.recover > 0) continue
      const d = dist(o, holder)
      if (d < nearest) {
        nearest = d
        taker = o
      }
      if (d < 3.2) crowd += 1
    }

    // 발끝이 닿는 거리면 터치하는 순간을 노린 태클이 바로 나올 수 있다
    if (taker && nearest < 1.7 && this.rng.next() < dt * 3.2) {
      this.flash('TACKLE', this.ball.x, this.ball.y)
      holder.recover = 0.55
      this.giveTo(taker)
      return
    }

    if (nearest < 2.4) this.pressure += dt * (1 + 0.8 * Math.max(0, crowd - 1))
    else if (nearest > 3.6) this.pressure = Math.max(0, this.pressure - dt * 1.8)

    // 붙잡힌 시간이 쌓여도 뺏긴다. 둘러싸이면 더 빨리
    if (taker && this.pressure > 0.4 && this.rng.next() < dt * (1.6 + crowd * 0.9)) {
      this.flash('TACKLE', this.ball.x, this.ball.y)
      holder.recover = 0.55
      this.giveTo(taker)
    }
  }

  /** 각 선수가 지금 가려는 곳을 정한다 */
  private setTargets(state: MatchState) {
    const holder = this.byId(this.ball.holder)
    const ballSide: 'HOME' | 'AWAY' | null =
      holder?.side ?? (this.ball.mode === 'PASS' ? this.byId(this.ball.targetId)?.side ?? null : null)

    for (const p of this.players) {
      if (p.pos === 'GK') {
        // 골키퍼는 골대와 공을 잇는 선 위에 선다
        const gx = this.goalX(p.side === 'HOME' ? 'AWAY' : 'HOME')
        const toBall = Math.hypot(this.ball.x - gx, this.ball.y - 34)
        const out = clamp(14 - toBall * 0.25, 1.5, 9)
        const k = p.side === 'HOME' ? 1 : -1
        p.tx = p.homeX + out * k
        p.ty = 34 + (this.ball.y - 34) * 0.45
        continue
      }

      const dir = p.side === 'HOME' ? 1 : -1
      const attacking = ballSide === p.side

      if (holder && holder.id === p.id) {
        // 공을 몰 때는 앞이 기본이되, 막힌 쪽을 피해 빈 길로 꺾는다.
        // 무작정 직진하면 수비수 무리 속으로 제 발로 파고든다
        let ex = dir * 1.1
        let ey = (PITCH_H / 2 - p.y) * 0.015
        let boxed = 0
        for (const o of this.players) {
          if (o.side === p.side || o.pos === 'GK') continue
          const d = dist(o, p)
          if (d > 9) continue
          const w = (9 - d) / 9
          ex -= ((o.x - p.x) / (d || 1)) * w * 1.5
          ey -= ((o.y - p.y) / (d || 1)) * w * 1.5
          if (d < 3.2) boxed += 1
        }
        const m = Math.hypot(ex, ey) || 1
        // 완전히 갇히면 멀리 못 간다. 몸으로 지키며 내줄 곳을 찾는 그림
        const run = boxed >= 2 ? 5 : 13
        p.tx = clamp(p.x + (ex / m) * run, 4, PITCH_W - 4)
        p.ty = clamp(p.y + (ey / m) * run, 4, PITCH_H - 4)
        continue
      }

      if (attacking) {
        // 공격 — 팀 전체가 올라간다.
        //
        // 공격할 때 가만히 서 있는 선수는 없다. 수비라인은 하프라인까지
        // 밀고 올라가고 미드필더는 상대 박스 근처까지 들어간다. 전진 폭이
        // 작으면 공만 앞에 가 있고 뒤에 아홉 명이 서 있는 화면이 된다.
        const push = p.pos === 'FW' ? 22 : p.pos === 'MF' ? 30 : 32
        let tx = p.homeX + push * dir
        let ty = p.homeY

        if (holder) {
          // 공 있는 쪽으로 팀 전체가 쏠린다. 반대편은 폭을 유지한다
          const lateral = p.pos === 'DF' ? 0.35 : 0.5
          ty = p.homeY + (holder.y - p.homeY) * lateral

          const d = dist(p, holder)
          if (d < 24 && p.pos !== 'DF') {
            // 가까우면 받을 각을 만든다 — 겹치지 않게 벌려 선다
            const away = p.y > holder.y ? 1 : -1
            ty = clamp(holder.y + away * (8 + (p.pos === 'FW' ? 4 : 0)), 4, PITCH_H - 4)
            tx = clamp(holder.x + (p.pos === 'FW' ? 14 : 8) * dir, 4, PITCH_W - 4)
          }
          // 수비라인은 공보다 너무 뒤처지지 않는다. 압축된 블록을 유지한다
          if (p.pos === 'DF') {
            const lineCap = holder.x - 34 * dir
            tx = dir > 0 ? Math.max(tx, lineCap) : Math.min(tx, lineCap)
          }
        }

        p.tx = clamp(tx, 3, PITCH_W - 3)
        p.ty = clamp(ty, 3, PITCH_H - 3)
      } else {
        // 수비 — 추격조 세 명은 공에 달려들고 나머지는 자리를 지킨다.
        // 공을 가진 선수가 몰고 가므로 지금 자리가 아니라 갈 자리를 노린다
        const rank = this.chasersOf(p.side).indexOf(p.id)
        const lead = 0.45
        const px = holder ? holder.x + holder.vx * lead : this.ball.x
        const py = holder ? holder.y + holder.vy * lead : this.ball.y

        if (rank === 0) {
          p.tx = px
          p.ty = py
        } else if (rank === 1) {
          // 두 번째는 뒤를 받친다 — 제쳐져도 바로 다음이 붙는다
          p.tx = px - 4 * dir
          p.ty = py + (p.y > py ? 5 : -5)
        } else if (rank === 2) {
          p.tx = px - 9 * dir
          p.ty = py + (p.y > py ? 8 : -8)
        } else {
          // 나머지는 블록을 유지한 채 공 쪽으로 통째로 이동한다.
          // 이게 헐거우면 패스 한 번에 압박이 풀려 아무도 안 붙는 화면이
          // 된다. 실제 수비 블록은 공에서 20미터 안쪽에 모여 있다.
          const compact = p.pos === 'DF' ? 0.42 : 0.72
          let tx = p.homeX + (this.ball.x - p.homeX) * compact

          // 수비할 때는 자기 골대 쪽에 머문다. 상대가 자기 진영에서 공을
          // 돌린다고 우리 수비라인이 하프라인을 넘어가면 축구가 아니다
          const limit = p.pos === 'DF' ? -9 : 16
          tx =
            dir > 0
              ? Math.min(tx, PITCH_W / 2 + limit)
              : Math.max(tx, PITCH_W / 2 - limit)

          p.tx = clamp(tx, 3, PITCH_W - 3)
          p.ty = clamp(p.homeY + (this.ball.y - p.homeY) * 0.68, 3, PITCH_H - 3)
        }
      }
    }
    void state
  }

  /**
   * 공에 달려들 추격조 세 명.
   *
   * 매 프레임 거리순으로 다시 뽑으면 두 선수의 순위가 오락가락할 때마다
   * 역할이 뒤바뀌어 전원이 갈지자로 뛴다. 한 번 정한 추격조는 잠깐
   * 유지하고, 공 주인이 바뀔 때 새로 짠다.
   */
  private chasersOf(side: 'HOME' | 'AWAY'): string[] {
    if (this.clock - this.chaseAt[side] > 0.7) {
      this.chaseIds[side] = this.players
        .filter((p) => p.side === side && p.pos !== 'GK')
        .sort((a, b) => dist(a, this.ball) - dist(b, this.ball))
        .slice(0, 3)
        .map((p) => p.id)
      this.chaseAt[side] = this.clock
    }
    return this.chaseIds[side]
  }

  private movePlayer(p: VPlayer, dt: number) {
    if (p.recover > 0) {
      p.recover -= dt
      p.vx *= 0.85
      p.vy *= 0.85
      p.x += p.vx * dt
      p.y += p.vy * dt
      return
    }

    const dx = p.stx - p.x
    const dy = p.sty - p.y
    const d = Math.hypot(dx, dy)
    // 공을 몰고 뛰는 선수는 빈 몸으로 뛰는 선수보다 느리다.
    // 이것 때문에 수비수가 따라붙을 수 있고, 압박이 실제로 작동한다
    const carrying = this.ball.mode === 'HELD' && this.ball.holder === p.id
    const top =
      p.top * (0.62 + 0.38 * clamp(p.stamina, 0, 100) / 100) * (carrying ? 0.76 : 1)

    let wx = 0
    let wy = 0
    if (d > ARRIVE) {
      const speed = d < 5 ? WALK + (d / 5) * (top - WALK) : top
      wx = (dx / d) * speed
      wy = (dy / d) * speed
    }

    const step = ACCEL * dt
    const ax = wx - p.vx
    const ay = wy - p.vy
    const am = Math.hypot(ax, ay)
    if (am > step) {
      p.vx += (ax / am) * step
      p.vy += (ay / am) * step
    } else {
      p.vx = wx
      p.vy = wy
    }
    p.x = clamp(p.x + p.vx * dt, 1, PITCH_W - 1)
    p.y = clamp(p.y + p.vy * dt, 1, PITCH_H - 1)
  }

  private moveBall(dt: number) {
    const b = this.ball

    if (b.mode === 'HELD') {
      const h = this.byId(b.holder)
      if (!h) {
        b.mode = 'LOOSE'
        return
      }
      // 공은 발밑에서 진행 방향으로 조금 앞서 있다
      const sp = Math.hypot(h.vx, h.vy)
      const ux = sp > 0.4 ? h.vx / sp : h.side === 'HOME' ? 1 : -1
      const uy = sp > 0.4 ? h.vy / sp : 0
      b.x += (h.x + ux * CONTROL_DIST - b.x) * Math.min(1, dt * 18)
      b.y += (h.y + uy * CONTROL_DIST - b.y) * Math.min(1, dt * 18)
      b.lift = 0
      return
    }

    if (b.mode === 'PASS' || b.mode === 'SHOT') {
      b.t += dt
      const k = clamp(b.t / b.dur, 0, 1)
      b.x = b.fromX + (b.toX - b.fromX) * k
      b.y = b.fromY + (b.toY - b.fromY) * k
      b.lift = Math.sin(k * Math.PI) * (b.mode === 'SHOT' ? 1 : 0.45)

      if (k >= 1) {
        if (b.mode === 'SHOT') {
          const conceding = b.toX > 52 ? 'AWAY' : 'HOME'
          if (b.willScore) {
            // 골망에 꽂힌다. 공은 골 안에 그대로 두고 잠시 멈춘다
            b.mode = 'LOOSE'
            b.holder = null
            b.lift = 0
            this.flash('GOAL', b.x, b.y)
            // 75초짜리 경기다. 세리머니가 길면 플레이 시간을 잡아먹는다
            this.celebration = {
              side: conceding === 'AWAY' ? 'HOME' : 'AWAY',
              life: 1.5,
              x: b.x,
              y: b.y,
            }
          } else {
            const gk = this.players.find((p) => p.side === conceding && p.pos === 'GK')
            const missedWide = Math.abs(b.toY - GOAL_MID) > GOAL_HALF
            // 골대 안이면 선방, 밖이면 그냥 빗나간 것 — 골킥으로 이어진다
            if (!missedWide) this.flash('SAVE', b.x, b.y)
            if (gk) this.giveTo(gk)
            else b.mode = 'LOOSE'
          }
        } else if (!b.targetId) {
          // 빗나간 패스 — 주인 없는 공. 제일 먼저 닿는 쪽이 줍는다
          b.mode = 'LOOSE'
        } else {
          // 패스 도착. 더 가까운 상대가 있으면 가로챈다
          const receiver = this.byId(b.targetId)
          const thief = this.nearestOf(receiver?.side === 'HOME' ? 'AWAY' : 'HOME', b)
          if (receiver && (!thief || dist(thief, b) > dist(receiver, b) - 0.5)) {
            this.giveTo(receiver)
          } else if (thief) {
            this.flash('TACKLE', b.x, b.y)
            this.giveTo(thief)
          } else {
            b.mode = 'LOOSE'
          }
        }
      }
      return
    }

    // 흘러나온 공 — 제일 가까운 사람이 몸을 던져 줍는다
    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      const d = dist(p, b)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (best && bd < 2.6) this.giveTo(best)
  }

  /**
   * 겹침 방지.
   *
   * 두 사람이 같은 점 위에 서 있으면 사람이 아니라 표식으로 보인다.
   * 몸이 닿을 거리면 서로 밀어낸다.
   */
  private separate() {
    for (let a = 0; a < this.players.length; a++) {
      for (let b = a + 1; b < this.players.length; b++) {
        const p = this.players[a]
        const q = this.players[b]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d = Math.hypot(dx, dy)
        if (d >= 1.4 || d < 1e-6) continue
        const push = Math.min(0.08, (1.4 - d) / 2)
        const ux = dx / d
        const uy = dy / d
        p.x = clamp(p.x - ux * push, 1, PITCH_W - 1)
        p.y = clamp(p.y - uy * push, 1, PITCH_H - 1)
        q.x = clamp(q.x + ux * push, 1, PITCH_W - 1)
        q.y = clamp(q.y + uy * push, 1, PITCH_H - 1)
      }
    }
  }

  /** 관전 장면을 dt 초만큼 진행시킨다 */
  advance(state: MatchState, dt: number) {
    const step = Math.min(dt, 0.05)
    this.clock += step

    for (const f of this.flashes) f.life -= step
    this.flashes = this.flashes.filter((f) => f.life > 0)

    // 세리머니 중에는 공이 골망에 있고 선수들은 제자리로 돌아간다
    if (this.celebration) {
      this.celebration.life -= step
      for (const p of this.players) {
        p.tx = p.homeX
        p.ty = p.homeY
        p.stx = p.homeX
        p.sty = p.homeY
        this.movePlayer(p, step)
      }
      this.ball.x = this.celebration.x
      this.ball.y = this.celebration.y
      if (this.celebration.life <= 0) {
        const restartFor = this.celebration.side === 'HOME' ? 'AWAY' : 'HOME'
        this.celebration = null
        this.kickoff(restartFor)
      }
      return
    }

    this.setTargets(state)

    // 목표를 부드럽게 따라간다. 역할이 바뀌어 목표가 반대편으로 튀어도
    // 몸이 홱 꺾이지 않고 사람처럼 방향을 눌러서 바꾼다
    const follow = Math.min(1, step * 5)
    for (const p of this.players) {
      p.stx += (p.tx - p.stx) * follow
      p.sty += (p.ty - p.sty) * follow
    }

    const holder = this.byId(this.ball.holder)
    if (holder && this.ball.mode === 'HELD') {
      this.updatePressure(holder, step)
      // 방금 태클로 주인이 바뀌었을 수 있다
      const now = this.byId(this.ball.holder)
      if (now && this.ball.mode === 'HELD') this.decide(now, step)
    }

    for (const p of this.players) this.movePlayer(p, step)
    this.separate()
    this.moveBall(step)
  }
}
