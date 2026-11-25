/* The event's menu language for the screens under MenuLangProvider
   (src/components/MenuLang.jsx): the context, and useLocal() - everything a
   screen needs to show a dish, category, course or button in that language. */
import { createContext, useContext, useMemo } from 'react'
import { phrase, localOf, courseLocal, differs } from '../lib/menuLang'
import { readMenu } from '../lib/cache'

export const MenuLangCtx = createContext(null)

// English name -> local name, from the menu this tablet last loaded (order
// lists carry only the English name of a dish)
const nameMaps = new WeakMap()
function localByName(eventId, code, name) {
  const menu = readMenu(eventId)
  if (!menu || !Array.isArray(menu.items)) return ''
  let byCode = nameMaps.get(menu.items)
  if (!byCode) { byCode = new Map(); nameMaps.set(menu.items, byCode) }
  let m = byCode.get(code)
  if (!m) {
    m = new Map()
    for (const it of menu.items) {
      const l = localOf(it, code)
      if (l && it?.name) m.set(String(it.name).trim().toLowerCase(), l)
    }
    byCode.set(code, m)
  }
  return m.get(String(name || '').trim().toLowerCase()) || ''
}

/* Everything a screen needs. `on` is false when the event has no language. */
export function useLocal() {
  const v = useContext(MenuLangCtx)
  return useMemo(() => {
    if (!v) {
      const none = () => ''
      return { on: false, info: null, code: null, dish: none, dishDesc: none, cat: none, course: none, ph: none, byName: none }
    }
    const { code, eventData, buttons } = v
    return {
      on: true, info: v.info, code, buttons,
      dish: item => { const l = localOf(item, code); return differs(item?.name, l) ? l : '' },
      dishDesc: item => { const l = localOf(item, code, 'description'); return differs(item?.description, l) ? l : '' },
      // a category stored as "Lunch - Starters": the local name is for the guest-facing part
      cat: c => { const l = localOf(c, code); return differs(c?.name, l) ? l : '' },
      course: name => { const l = courseLocal(eventData, name, code); return differs(name, l) ? l : '' },
      // fixed words: guest tablets only
      ph: en => (buttons ? phrase(en, code) : ''),
      byName: name => { const l = localByName(eventData?.id, code, name); return differs(name, l) ? l : '' },
    }
  }, [v])
}

