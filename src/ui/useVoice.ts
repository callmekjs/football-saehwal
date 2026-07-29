import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 브라우저 기본 음성 인식을 눌러 말하는 방식으로 감싼다.
 *
 * **버튼을 누르고 있는 동안만 듣는다.** 항상 켜두면 감독이 혼잣말한 것이
 * 지시로 들어간다. 되돌릴 수 없는 시뮬레이션에서 그건 기능이 아니라 함정이다.
 *
 * **키가 필요 없다.** `SpeechRecognition` 은 브라우저가 이미 가진 기능이라
 * 심사자가 따로 준비할 것이 없다. 외부 서비스를 붙이면 키가 필요해지고,
 * 그러면 대회 평가에서 그 기능이 빠질 수 있다.
 *
 * 지원하지 않는 브라우저(파이어폭스 등)와 권한을 거절한 경우를 **둘 다**
 * 정상 경로로 취급한다. 음성은 덤이고, 탭으로 하던 길은 그대로 살아 있다.
 */

interface RecognitionAlternative {
  transcript: string
}

interface RecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: RecognitionAlternative
}

interface RecognitionEvent {
  resultIndex: number
  results: { length: number; [index: number]: RecognitionResult }
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => Recognition

function ctorOf(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface VoiceHandle {
  /** 이 브라우저가 음성 인식을 가지고 있는가 */
  supported: boolean
  /** 마이크 권한을 거절당했는가 */
  denied: boolean
  listening: boolean
  /** 들은 말 그대로. 잘못 알아들었을 때 그걸 보여주는 것이 핵심이다 */
  heard: string
  /** 그래서 무엇을 했는가 */
  note: string
  press: () => void
  release: () => void
}

export function useVoice(onFinal: (text: string) => string): VoiceHandle {
  const [supported] = useState(() => ctorOf() !== null)
  const [denied, setDenied] = useState(false)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [note, setNote] = useState('')

  const recRef = useRef<Recognition | null>(null)
  const activeRef = useRef(false)
  /** 이번에 누른 동안 알아들은 것이 있었는가 */
  const gotRef = useRef(false)
  /** 권한을 거절당하면 "다시 말씀해 주세요"가 아니라 조용히 접어야 한다 */
  const deniedRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    return () => {
      activeRef.current = false
      recRef.current?.abort()
    }
  }, [])

  const press = useCallback(() => {
    const Ctor = ctorOf()
    if (!Ctor || activeRef.current) return

    const rec = new Ctor()
    rec.lang = 'ko-KR'
    // 한 번 누를 때 한 마디. 계속 열어두지 않는다
    rec.continuous = false
    // 말하는 동안 들은 말을 그대로 보여주기 위해 중간 결과를 받는다
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let text = ''
      let final = false
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        text += r[0].transcript
        if (r.isFinal) final = true
      }
      setHeard(text)
      if (!final) return
      gotRef.current = true
      // 알아들었든 못 알아들었든 결과 한 줄은 반드시 보여준다
      setNote(onFinalRef.current(text))
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        deniedRef.current = true
        setDenied(true)
        setHeard('')
        setNote('')
      }
    }

    rec.onend = () => {
      activeRef.current = false
      recRef.current = null
      setListening(false)
      // 한 마디도 못 알아들었으면 아무것도 하지 않고 그렇다고 말한다.
      // 엉뚱한 지시를 거는 것이 못 알아듣는 것보다 훨씬 나쁘다
      if (!gotRef.current && !deniedRef.current) setNote('다시 말씀해 주세요')
    }

    recRef.current = rec
    activeRef.current = true
    gotRef.current = false
    setHeard('')
    setNote('')
    try {
      rec.start()
      setListening(true)
    } catch {
      // 이미 돌고 있는 경우. 조용히 접는다
      activeRef.current = false
      recRef.current = null
      setListening(false)
    }
  }, [])

  const release = useCallback(() => {
    if (!activeRef.current) return
    // stop() 은 마지막 결과를 마저 돌려준다. abort() 는 버린다
    recRef.current?.stop()
    setListening(false)
  }, [])

  return { supported, denied, listening, heard, note, press, release }
}
