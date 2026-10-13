import { useCallback, useEffect, useLayoutEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { GameApp } from '../app';
import { TOUCH_TOUR_STEPS, TOUR_KEY_ROWS, TOUR_STEPS, type TourStep } from './tour-steps';

interface Box { left: number; top: number; width: number; height: number }
type Side = 'right' | 'left' | 'below' | 'above' | 'center';

const PAD = 6;
const BUBBLE_W = 380;

const SPOKEN: Record<string, string> = {
  '↑': 'up arrow', '↓': 'down arrow', '←': 'left arrow', '→': 'right arrow', '/': 'slash', Esc: 'Escape', Arrows: 'the arrow keys',
};

function keyText(app: GameApp, action: string): string {
  if (action === 'next') return '→';
  if (action === 'stick') return '← → ↑ ↓';
  return app.keyFor(action);
}

function spokenKey(label: string): string {
  return label.split(/\s+|\//).map(k => SPOKEN[k] ?? k).join(label.includes('/') ? ' and ' : ', ');
}

/** Split "{action}" tokens into keycaps and "[[Label]]" into touch-button chips. */
function renderText(app: GameApp, text: string): ReactNode[] {
  return text.split(/(\{\w+\}|\[\[[^\]]+\]\])/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part);
    if (key) return <kbd key={i}>{keyText(app, key[1]!)}</kbd>;
    const chip = /^\[\[([^\]]+)\]\]$/.exec(part);
    return chip ? <span key={i} className="tchip">{chip[1]}</span> : part;
  });
}

function speechFor(app: GameApp, step: TourStep): string {
  const lines = [step.title, ...step.text, ...(step.when ? [`When to use it: ${step.when}`] : [])];
  if (step.id === 'keys') lines.push(...TOUR_KEY_ROWS.map(([a, label]) => `${label}: ${spokenKey(keyText(app, a))}`));
  return lines.join('. ')
    .replace(/\{(\w+)\}/g, (_, a: string) => spokenKey(keyText(app, a)))
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\.\./g, '.');
}

/** Frame every visible match of the step's selector. */
function measure(step: TourStep): Box | null {
  if (!step.target) return null;
  const rects = [...document.querySelectorAll<Element>(step.target)].filter(e => e.getClientRects().length > 0).map(e => e.getBoundingClientRect());
  if (!rects.length) return null;
  const l = Math.min(...rects.map(r => r.left));
  const t = Math.min(...rects.map(r => r.top));
  const r = Math.max(...rects.map(x => x.right));
  const b = Math.max(...rects.map(x => x.bottom));
  return { left: l - PAD, top: t - PAD, width: r - l + PAD * 2, height: b - t + PAD * 2 };
}

/** Put the bubble on the roomiest side of the spotlight, clamped to the viewport. */
function place(box: Box | null, bw: number, bh: number): { left: number; top: number; side: Side; arrow: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Phones are short: tighter margins keep the bubble beside the spotlight instead of on it.
  const m = vh < 520 ? 8 : 16;
  const GAP = vh < 520 ? 12 : 16;
  const clampX = (x: number): number => Math.max(m, Math.min(vw - bw - m, x));
  const clampY = (y: number): number => Math.max(m, Math.min(vh - bh - m, y));
  if (!box) return { left: clampX((vw - bw) / 2), top: clampY((vh - bh) / 2), side: 'center', arrow: 0 };
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const room: Record<Exclude<Side, 'center'>, number> = {
    right: vw - (box.left + box.width) - bw, left: box.left - bw, below: vh - (box.top + box.height) - bh, above: box.top - bh,
  };
  const side = (Object.keys(room) as (keyof typeof room)[]).reduce((a, b) => (room[b] > room[a] ? b : a));
  let left: number;
  let top: number;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? box.left + box.width + GAP : box.left - bw - GAP;
    top = clampY(cy - bh / 2);
    return { left, top, side, arrow: Math.max(16, Math.min(bh - 16, cy - top)) };
  }
  top = side === 'below' ? box.top + box.height + GAP : box.top - bh - GAP;
  left = clampX(cx - bw / 2);
  return { left, top: clampY(top), side, arrow: Math.max(16, Math.min(bw - 16, cx - left)) };
}

/**
 * Static cockpit tour: the game is frozen; a spotlight and a bubble walk through each instrument.
 * On touch screens the spotlit control stays live for "try it" steps, and a swipe pages the tour.
 */
export function Tour({ app, narrate, touch }: { app: GameApp; narrate: boolean; touch: boolean }): ReactNode {
  const steps = touch ? TOUCH_TOUR_STEPS : TOUR_STEPS;
  const [i, setI] = useState(0);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const [tried, setTried] = useState(false);
  const [swipe, setSwipe] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<ReturnType<typeof place>>({ left: 0, top: 0, side: 'center', arrow: 0 });

  const go = useCallback((d: number) => setI(n => Math.max(0, Math.min(steps.length - 1, n + d))), [steps]);

  useEffect(() => app.setTourDemo(step.demo ?? null), [app, step]);

  // "Try it": tick the bubble when the player uses the spotlit control.
  useEffect(() => {
    setTried(false);
    const want = step.try?.action;
    if (!want) return;
    const touchCtl = app.hud.touch;
    touchCtl.onAction = a => {
      if (a !== want) return;
      setTried(true);
      app.haptic(25);
    };
    return () => {
      touchCtl.onAction = null;
      touchCtl.reset();
    };
  }, [app, step]);

  useLayoutEffect(() => {
    const update = (): void => {
      const b = measure(step);
      setBox(b);
      const r = bubble?.getBoundingClientRect();
      setPos(place(b, r?.width ?? BUBBLE_W, r?.height ?? 200));
    };
    update();
    window.addEventListener('resize', update);
    // The bubble grows or shrinks when a "try it" ticks; keep it on screen.
    const ro = typeof ResizeObserver === 'function' && bubble ? new ResizeObserver(update) : null;
    if (ro && bubble) ro.observe(bubble);
    return () => {
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [step, bubble]);

  useEffect(() => {
    if (narrate) app.audio.narrate(speechFor(app, step));
    else app.audio.stopSpeech();
  }, [app, step, narrate]);

  useEffect(() => () => app.audio.stopSpeech(), [app]);

  useEffect(() => {
    bubble?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [bubble, i]);

  // Keys belong to the tour while it is open: capture them before the flight controls see them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.repeat && e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return;
      if (e.code === 'ArrowRight' || (!onButton && (e.code === 'Enter' || e.code === 'Space'))) {
        e.preventDefault();
        if (last) app.endTour('training');
        else go(1);
      } else if (e.code === 'ArrowLeft' || e.code === 'Backspace') {
        e.preventDefault();
        go(-1);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        app.endTour('menu');
      } else if (e.code === 'KeyR') {
        app.updateSettings({ tourNarration: !app.settings.tourNarration });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [app, go, last]);

  const live = !!(step.try && box);
  const onDown = (e: ReactPointerEvent): void => setSwipe({ x: e.clientX, y: e.clientY });
  const onUp = (e: ReactPointerEvent): void => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    setSwipe(null);
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && last) return;
    go(dx < 0 ? 1 : -1);
  };

  return (
    <div className={`tour ${live ? 'live' : ''}`} data-testid="tour" data-touch={touch} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => setSwipe(null)}>
      {box
        ? <div className="tour-spot" data-testid="tour-spot" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
        : <div className="tour-shade" />}
      {live && box && (
        // Four blockers around the spotlight: the control inside stays touchable, nothing else does.
        <>
          <div className="tour-block" style={{ left: 0, top: 0, right: 0, height: Math.max(0, box.top) }} />
          <div className="tour-block" style={{ left: 0, top: box.top + box.height, right: 0, bottom: 0 }} />
          <div className="tour-block" style={{ left: 0, top: box.top, width: Math.max(0, box.left), height: box.height }} />
          <div className="tour-block" style={{ left: box.left + box.width, top: box.top, right: 0, height: box.height }} />
        </>
      )}
      <div
        ref={setBubble}
        className="tour-bubble"
        data-side={pos.side}
        data-step={step.id}
        role="dialog"
        aria-label={`Cockpit tour: ${step.title}`}
        aria-live="polite"
        style={{ left: pos.left, top: pos.top, ['--arrow' as string]: `${pos.arrow}px` }}
      >
        <div className="tour-head">
          <span className="tour-count">{i + 1} / {steps.length}</span>
          <button
            type="button"
            className={`tour-voice ${narrate ? 'on' : ''}`}
            aria-pressed={narrate}
            data-testid="tour-narrate"
            title="Read each bubble aloud (R)"
            onClick={() => app.updateSettings({ tourNarration: !narrate })}
          >
            {narrate ? '🔊' : '🔈'} Read aloud{!touch && <> <kbd>R</kbd></>}
          </button>
        </div>
        <h2>{step.title}</h2>
        {step.text.map(t => <p key={t}>{renderText(app, t)}</p>)}
        {step.when && <p className="tour-when"><b>When to use it:</b> {renderText(app, step.when)}</p>}
        {step.try && (
          <p className="tour-try" data-testid="tour-try" data-done={tried}>
            {tried ? <><b>✓</b> Nice. That is how it works.</> : <><b>☐</b> {step.try.text}</>}
          </p>
        )}
        {step.id === 'keys' && (
          <div className="ctl-keys tour-keys">
            {TOUR_KEY_ROWS.map(([a, label]) => (
              <div key={a}><kbd>{a === 'throttle' ? app.keyFor('throttle') : keyText(app, a)}</kbd><span>{label}</span></div>
            ))}
            <div className="hint">A gamepad works too: left stick steers, triggers boost and fire.</div>
          </div>
        )}
        <div className="tour-nav">
          <button type="button" className="btn ghost" data-testid="tour-exit" onClick={() => app.endTour('menu')}>Exit{!touch && <> <kbd>Esc</kbd></>}</button>
          <span className="tour-spacer" />
          {i > 0 && <button type="button" className="btn" data-testid="tour-back" onClick={() => go(-1)}>← Back</button>}
          {last
            ? <button type="button" className="btn primary" data-testid="tour-training" data-autofocus onClick={() => app.endTour('training')}>Start training flight</button>
            : <button type="button" className={`btn primary ${tried ? 'nudge' : ''}`} data-testid="tour-next" data-autofocus onClick={() => go(1)}>Next →</button>}
        </div>
      </div>
    </div>
  );
}
