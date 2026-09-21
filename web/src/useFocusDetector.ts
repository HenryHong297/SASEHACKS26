import { useCallback, useEffect, useRef, useState } from 'react'
import { socket } from './socket'

// Same calibration/grace-period/rolling-score approach as the old
// public/client.js (vanilla test client) - ported here so the real React UI
// gets the same on-device MediaPipe focus detection instead of a placeholder.
const CALIB_SECONDS = 3
const GRACE_SECONDS = 3
const YAW_TOL = 0.35 // in interocular-distance units, not degrees - see headPoseProxy
const PITCH_TOL = 0.35 // in face-height units
const WINDOW_SECONDS = 300
const UI_THROTTLE_MS = 250 // detectForVideo runs every frame, but the UI doesn't need to

// landmark indices, same points the ML-Tracking.py prototype used
const LM = { nose: 1, chin: 152, leftEye: 33, rightEye: 263 }

// Minimal shape of the @mediapipe/tasks-vision exports we use. This module is
// self-hosted at runtime by the Express server (src/vendorAssets.js downloads
// it into public/vendor/mediapipe/) rather than installed as a dependency
// here, so TS can't resolve it statically - see the @ts-expect-error below.
interface FaceLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { faceLandmarks: Array<Array<{ x: number; y: number; z: number }>> }
}
interface MediapipeVisionModule {
  FilesetResolver: { forVisionTasks(wasmLoaderPath: string): Promise<unknown> }
  FaceLandmarker: { createFromOptions(vision: unknown, options: Record<string, unknown>): Promise<FaceLandmarkerInstance> }
}

export type DetectorPhase = 'idle' | 'requesting-camera' | 'camera-error' | 'loading-model' | 'calibrating' | 'tracking' | 'manual'

export interface DetectorState {
  phase: DetectorPhase
  cameraError?: string
  calibSecondsLeft?: number
  focused: boolean
  focusScore?: number
  distractions?: number
}

type Landmark = { x: number; y: number; z: number }

// Scale-invariant head-direction proxy from raw landmark positions (avoids
// depending on the exact row/column-major layout of the transformation
// matrix output, which isn't documented and wasn't practical to verify
// without a browser to test against). Nose position relative to the eye
// midpoint, normalized by interocular distance/face height, shifts
// measurably as the head turns - not real degrees, but consistent and good
// enough to compare against a calibrated "looking at the screen" baseline.
function headPoseProxy(landmarks: Landmark[]) {
  const nose = landmarks[LM.nose]
  const chin = landmarks[LM.chin]
  const leftEye = landmarks[LM.leftEye]
  const rightEye = landmarks[LM.rightEye]

  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeMidY = (leftEye.y + rightEye.y) / 2
  const interocular = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1e-6
  const faceHeight = Math.hypot(chin.x - eyeMidX, chin.y - eyeMidY) || 1e-6

  return {
    yaw: (nose.x - eyeMidX) / interocular,
    pitch: (nose.y - eyeMidY) / faceHeight,
  }
}

const median = (arr: number[]) => {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function useFocusDetector() {
  const [state, setState] = useState<DetectorState>({ phase: 'idle', focused: true })

  const focusedRef = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const landmarkerRef = useRef<FaceLandmarkerInstance | null>(null)
  const runningRef = useRef(false)
  const lastUiUpdateRef = useRef(0)
  const calibRef = useRef<{ start: number; yaws: number[]; pitches: number[]; base: { yaw: number; pitch: number } | null }>({
    start: 0,
    yaws: [],
    pitches: [],
    base: null,
  })
  const focusRef = useRef<{ awaySince: number | null; inDistraction: boolean; distractions: number; samples: { t: number; focused: boolean }[] }>({
    awaySince: null,
    inDistraction: false,
    distractions: 0,
    samples: [],
  })

  const emitFocus = useCallback((focused: boolean) => {
    if (focusedRef.current !== focused) {
      focusedRef.current = focused
      socket.emit('focus-update', { focused })
    }
  }, [])

  const detectLoop = useCallback(() => {
    if (!runningRef.current) return
    const video = videoRef.current
    const landmarker = landmarkerRef.current
    if (!video || !landmarker) return

    if (video.readyState < 2) {
      requestAnimationFrame(detectLoop)
      return
    }

    const now = performance.now() / 1000
    const result = landmarker.detectForVideo(video, performance.now())
    const pose = result.faceLandmarks?.length > 0 ? headPoseProxy(result.faceLandmarks[0]) : null

    const calib = calibRef.current
    if (!calib.base) {
      const elapsed = now - calib.start
      if (pose) {
        calib.yaws.push(pose.yaw)
        calib.pitches.push(pose.pitch)
      }
      const secondsLeft = Math.max(0, CALIB_SECONDS - elapsed)
      setState({ phase: 'calibrating', calibSecondsLeft: secondsLeft, focused: true })
      if (elapsed >= CALIB_SECONDS && calib.yaws.length > 10) {
        calib.base = { yaw: median(calib.yaws), pitch: median(calib.pitches) }
        focusRef.current = { awaySince: null, inDistraction: false, distractions: 0, samples: [] }
      }
    } else {
      const attentive = pose
        ? Math.abs(pose.yaw - calib.base.yaw) < YAW_TOL && Math.abs(pose.pitch - calib.base.pitch) < PITCH_TOL
        : false // no face in frame counts as away

      const f = focusRef.current
      if (attentive) {
        f.awaySince = null
        f.inDistraction = false
      } else {
        if (f.awaySince === null) f.awaySince = now
        if (now - f.awaySince >= GRACE_SECONDS && !f.inDistraction) {
          f.inDistraction = true
          f.distractions++
        }
      }

      const isFocused = !f.inDistraction
      f.samples.push({ t: now, focused: isFocused })
      while (f.samples.length && now - f.samples[0].t > WINDOW_SECONDS) f.samples.shift()
      const focusScore = f.samples.reduce((s, x) => s + (x.focused ? 1 : 0), 0) / f.samples.length

      emitFocus(isFocused)

      if (now - lastUiUpdateRef.current > UI_THROTTLE_MS / 1000) {
        lastUiUpdateRef.current = now
        setState({ phase: 'tracking', focused: isFocused, focusScore, distractions: f.distractions })
      }
    }

    requestAnimationFrame(detectLoop)
  }, [emitFocus])

  const startCamera = useCallback(async () => {
    setState({ phase: 'requesting-camera', focused: true })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      // never appended to the page - detectForVideo reads frames straight off
      // the element regardless of whether it's actually displayed anywhere
      await video.play().catch(() => {})
      videoRef.current = video
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setState({ phase: 'camera-error', cameraError: message, focused: true })
      return
    }

    setState({ phase: 'loading-model', focused: true })
    try {
      // Self-hosted (see src/vendorAssets.js) instead of loaded from a CDN -
      // some networks block CDNs outright. @vite-ignore because this path is
      // served at runtime by the Express server, not part of this build; TS
      // can't resolve a path-like specifier ambiently, hence the cast below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { FilesetResolver, FaceLandmarker } = (await import(/* @vite-ignore */ '/vendor/mediapipe/vision_bundle.mjs' as any)) as MediapipeVisionModule
      const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm')
      landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/vendor/mediapipe/face_landmarker.task',
          delegate: 'CPU', // more consistently supported across different browsers/hardware than GPU
        },
        runningMode: 'VIDEO',
        numFaces: 1,
      })
    } catch {
      // Camera works but the detector didn't load - fall back to a manual toggle.
      landmarkerRef.current = null
      setState({ phase: 'manual', focused: focusedRef.current })
      return
    }

    calibRef.current = { start: performance.now() / 1000, yaws: [], pitches: [], base: null }
    focusRef.current = { awaySince: null, inDistraction: false, distractions: 0, samples: [] }
    runningRef.current = true
    requestAnimationFrame(detectLoop)
  }, [detectLoop])

  const retryCamera = useCallback(() => {
    runningRef.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    videoRef.current = null
    startCamera()
  }, [startCamera])

  const toggleManualFocus = useCallback(() => {
    const next = !focusedRef.current
    emitFocus(next)
    setState({ phase: 'manual', focused: next })
  }, [emitFocus])

  useEffect(() => {
    startCamera()
    return () => {
      runningRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { state, retryCamera, toggleManualFocus }
}
