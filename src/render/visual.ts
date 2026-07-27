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

/** 우리는 오른쪽(x=105) 골대를 공격한다 */
const HOME_GOAL_X = 103
const AWAY_GOAL_X = 2

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
}

export interface Flash {
  kind: 'TACKLE' | 'GOAL' | 'SAVE' | 'SHOT'
  x: number
  y: number
  life: number
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
  private rng: Rng
  private decideIn = 0
  private lastStats = { homeShot: 0, awayShot: 0 }
  private lastScore: [number, number] = [0, 0]
  private lastOwner: 'HOME' | 'AWAY' = 'HOME'
  private lastFormation = ''
  private lastHomeCount = 11

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

    // 골 — 시뮬이 점수를 올렸으면 그 장면을 만든다
    const scored = state.score[0] - this.lastScore[0]
    const conceded = state.score[1] - this.lastScore[1]
    if (scored > 0 || conceded > 0) {
      this.flash('GOAL', this.ball.x, this.ball.y)
      this.kickoff(scored > 0 ? 'AWAY' : 'HOME')
      this.lastScore = [...state.score] as [number, number]
      this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
      this.lastOwner = state.ball.owner
      return
    }

    // 슛 — 시뮬이 슈팅 상황을 셌으면 실제로 골대로 찬다
    const newHomeShot = state.stats.homeShot - this.lastStats.homeShot
    const newAwayShot = state.stats.awayShot - this.lastStats.awayShot
    this.lastStats = { homeShot: state.stats.homeShot, awayShot: state.stats.awayShot }
    if (newHomeShot > 0 || newAwayShot > 0) {
      const side = newHomeShot > 0 ? 'HOME' : 'AWAY'
      const shooter =
        this.byId(this.ball.holder)?.side === side
          ? this.byId(this.ball.holder)!
          : this.nearestOf(side, this.ball)
      if (shooter) this.shoot(shooter)
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

  private kickoff(side: 'HOME' | 'AWAY') {
    for (const p of this.players) {
      p.x = p.homeX
      p.y = p.homeY
      p.vx = 0
      p.vy = 0
      p.recover = 0
    }
    this.ball.x = PITCH_W / 2
    this.ball.y = PITCH_H / 2
    const taker = this.nearestOf(side, { x: PITCH_W / 2, y: PITCH_H / 2 })
    if (taker) {
      taker.x = PITCH_W / 2 - (side === 'HOME' ? 2 : -2)
      taker.y = PITCH_H / 2
      this.giveTo(taker)
    }
  }

  private goalX(side: 'HOME' | 'AWAY') {
    return side === 'HOME' ? HOME_GOAL_X : AWAY_GOAL_X
  }

  private shoot(shooter: VPlayer) {
    const gx = this.goalX(shooter.side)
    const gy = 34 + (this.rng.next() - 0.5) * 12
    const d = Math.hypot(gx - shooter.x, gy - shooter.y)
    this.ball.mode = 'SHOT'
    this.ball.holder = null
    this.ball.fromX = shooter.x
    this.ball.fromY = shooter.y
    this.ball.toX = gx
    this.ball.toY = gy
    this.ball.t = 0
    this.ball.dur = clamp(d / SHOT_SPEED, 0.2, SHOT_MAX_T)
    this.ball.targetId = null
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
      if (d < 5 || d > 32) continue

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
    const tx = clamp(to.x + to.vx * lead, 2, PITCH_W - 2)
    const ty = clamp(to.y + to.vy * lead, 2, PITCH_H - 2)
    const d = Math.hypot(tx - holder.x, ty - holder.y)
    this.ball.mode = 'PASS'
    this.ball.holder = null
    this.ball.fromX = this.ball.x
    this.ball.fromY = this.ball.y
    this.ball.toX = tx
    this.ball.toY = ty
    this.ball.t = 0
    this.ball.dur = clamp(d / PASS_SPEED, 0.14, PASS_MAX_T)
    this.ball.targetId = to.id
  }

  /** 공을 가진 선수가 무엇을 할지 정한다 */
  private decide(holder: VPlayer, dt: number) {
    this.decideIn -= dt
    if (this.decideIn > 0) return

    const target = this.choosePass(holder)
    const pressure = this.players.reduce((m, o) => {
      if (o.side === holder.side) return m
      return Math.min(m, dist(o, holder))
    }, Infinity)

    // 쫓기면 빨리 내주고, 여유가 있으면 조금 몰고 간다.
    // 15분에 여든 번쯤 오가야 축구로 보인다 — 내주는 쪽이 기본이다
    const wantPass = pressure < 8 ? 0.96 : 0.72
    if (target && this.rng.next() < wantPass) {
      this.pass(holder, target)
    } else {
      // 내줄 데가 없으면 몰고 가며 다시 살핀다
      this.decideIn = 0.35 + this.rng.next() * 0.45
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
        // 공을 몰고 앞으로
        p.tx = clamp(p.x + 14 * dir, 4, PITCH_W - 4)
        p.ty = clamp(p.y + (34 - p.y) * 0.12, 4, PITCH_H - 4)
        continue
      }

      if (attacking) {
        // 공격 — 앞으로 나가 패스 받을 자리를 잡는다
        const push = p.pos === 'FW' ? 16 : p.pos === 'MF' ? 11 : 6
        let tx = p.homeX + push * dir
        let ty = p.homeY
        if (holder) {
          // 공 잡은 선수 근처면 지원하러 붙되 너무 겹치지 않는다
          const d = dist(p, holder)
          if (d < 22) {
            const away = p.y > holder.y ? 1 : -1
            ty = clamp(p.homeY + away * 7, 4, PITCH_H - 4)
            tx = clamp(holder.x + 9 * dir + (p.pos === 'FW' ? 8 : 0), 4, PITCH_W - 4)
          }
        }
        p.tx = clamp(tx, 3, PITCH_W - 3)
        p.ty = clamp(ty, 3, PITCH_H - 3)
      } else {
        // 수비 — 가장 가까운 두세 명은 공에 달려들고 나머지는 자리를 지킨다.
        // 공을 가진 선수가 몰고 가므로 지금 자리가 아니라 갈 자리를 노린다
        const rank = this.pressRank(p)
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
          // 수비수는 뒷공간을 지켜야 하므로 덜 나온다
          const compact = p.pos === 'DF' ? 0.52 : 0.72
          p.tx = clamp(p.homeX + (this.ball.x - p.homeX) * compact, 3, PITCH_W - 3)
          p.ty = clamp(p.homeY + (this.ball.y - p.homeY) * 0.68, 3, PITCH_H - 3)
        }
      }
    }
    void state
  }

  /** 이 선수가 자기 팀에서 공에 몇 번째로 가까운가 */
  private pressRank(p: VPlayer): number {
    let rank = 0
    const mine = dist(p, this.ball)
    for (const o of this.players) {
      if (o.side !== p.side || o.pos === 'GK' || o.id === p.id) continue
      if (dist(o, this.ball) < mine) rank += 1
    }
    return rank
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

    const dx = p.tx - p.x
    const dy = p.ty - p.y
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
          // 골은 sync 가 처리한다. 여기 도달했다면 막혔거나 빗나간 것이다
          const side = b.toX > 52 ? 'AWAY' : 'HOME'
          const gk = this.players.find((p) => p.side === side && p.pos === 'GK')
          this.flash('SAVE', b.x, b.y)
          if (gk) this.giveTo(gk)
          else b.mode = 'LOOSE'
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

    // 흘러나온 공 — 제일 가까운 사람이 잡는다
    let best: VPlayer | undefined
    let bd = Infinity
    for (const p of this.players) {
      const d = dist(p, b)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (best && bd < 2) this.giveTo(best)
  }

  /** 관전 장면을 dt 초만큼 진행시킨다 */
  advance(state: MatchState, dt: number) {
    const step = Math.min(dt, 0.05)
    this.setTargets(state)

    const holder = this.byId(this.ball.holder)
    if (holder && this.ball.mode === 'HELD') this.decide(holder, step)

    for (const p of this.players) this.movePlayer(p, step)
    this.moveBall(step)

    for (const f of this.flashes) f.life -= step
    this.flashes = this.flashes.filter((f) => f.life > 0)
  }
}
