/* The event's menu language on screen (src/lib/menuLang.js says where the
   words come from). One provider at the top of the guest app; everything
   under it shows English first and the event's language with it.

   - Dish, category and course names: on guest tablets and captain tablets.
   - Fixed buttons and headings (Place Order, Help…): guest tablets only - a
     captain is our own staff and reads the English.
   With no menu language set, every helper here returns nothing and the
   screens look exactly as before. */
import { useContext, useMemo } from 'react'
import { langInfo, fontFor } from '../lib/menuLang'
import { MenuLangCtx, useLocal } from './menuLangCtx'

export function MenuLangProvider({ eventData, buttons = true, children }) {
  const info = langInfo(eventData?.menu_lang)
  const value = useMemo(() => (info ? { info, code: info.code, buttons: !!buttons, eventData } : null), [info, buttons, eventData])
  return <MenuLangCtx.Provider value={value}>{children}</MenuLangCtx.Provider>
}

/* Text in the event's language, with its own font, script and direction.
   sep: put in front (" · " for one line). block: its own line. */
export function Loc({ text, block, sep, style, clamp, className }) {
  const v = useContext(MenuLangCtx)
  if (!v || !text) return null
  const Tag = block ? 'div' : 'span'
  const lines = clamp ? { display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : null
  return (
    <>
      {sep && !block ? <span aria-hidden="true" style={{ opacity: 0.55 }}>{sep}</span> : null}
      <Tag lang={v.info.code} dir={v.info.rtl ? 'rtl' : undefined}
        className={'ss-loc' + (className ? ' ' + className : '')}
        style={{ fontFamily: fontFor(v.info), textTransform: 'none', letterSpacing: 'normal', unicodeBidi: 'isolate',
          ...(block ? { textAlign: 'start' } : null), ...lines, ...style }}>
        {text}
      </Tag>
    </>
  )
}

/* A fixed label: the English as given, and the event's language with it
   (guest tablets). stack: under the English, smaller; otherwise on the same
   line after " · ". The English stays exactly as the screen had it. */
export function Bi({ en, children, stack, start, sub, sep = ' · ' }) {
  const L = useLocal()
  const local = L.ph(en)
  const english = children ?? en
  if (!local) return <>{english}</>
  // start: a left-aligned heading; otherwise centred under the English (buttons)
  if (stack) return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: start ? 'flex-start' : 'center', lineHeight: 1.15 }}>
      <span>{english}</span>
      <Loc text={local} block style={{ fontSize: '0.86em', fontWeight: 700, opacity: 0.95, textAlign: start ? 'start' : 'center', marginTop: 2, lineHeight: 1.3, ...sub }} />
    </span>
  )
  return <>{english}<Loc text={local} sep={sep} style={sub} /></>
}
