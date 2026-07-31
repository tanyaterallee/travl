import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from '../core/types'

/**
 * Bilingual strings.
 *
 * The app has to be usable in Chinese, not merely translated: a trip planned
 * on Amap will come back with Chinese place names regardless of the interface
 * language, so the two have to sit together comfortably. The font stack in
 * `index.css` puts PingFang and Microsoft YaHei next to the system UI face for
 * that reason.
 */

const STRINGS = {
  'nav.overview': ['Overview', '概览'],
  'nav.itinerary': ['Itinerary', '行程'],
  'nav.places': ['Places to visit', '想去的地方'],
  'nav.budget': ['Budget', '预算'],
  'nav.reservations': ['Reservations', '预订'],
  'nav.checklists': ['Checklists', '清单'],
  'nav.notes': ['Notes', '笔记'],

  'trip.untitled': ['Untitled trip', '未命名行程'],
  'trip.addDates': ['Add dates', '添加日期'],
  'trip.summary': ['Trip summary', '行程简介'],
  'trip.summaryPlaceholder': ['What is this trip about?', '这次旅行的主题是什么？'],

  'day.day': ['Day', '第'],
  'day.dayUnit': ['', '天'],
  'day.add': ['Add a day', '添加一天'],
  'day.remove': ['Remove day', '删除这一天'],
  'day.untitled': ['Add a subheading', '添加小标题'],
  'day.empty': ['Drag a place here, or search above', '把地点拖到这里，或在上方搜索'],
  'day.stops': ['stops', '个地点'],

  'place.add': ['Add a place', '添加地点'],
  'place.search': ['Search for a place', '搜索地点'],
  'place.searching': ['Searching…', '搜索中…'],
  'place.noResults': ['No places found', '没有找到地点'],
  'place.notes': ['Notes', '备注'],
  'place.notesPlaceholder': ['Add a note, a link, anything…', '添加备注、链接等…'],
  'place.remove': ['Remove', '移除'],
  'place.cost': ['Cost', '花费'],
  'place.duration': ['Time here', '停留时间'],
  'place.startTime': ['Start', '开始'],
  'place.moveToWishlist': ['Move to wishlist', '移到想去的地方'],
  'place.moveToDay': ['Move to day', '移到某天'],
  'place.website': ['Website', '网站'],
  'place.minutes': ['min', '分钟'],

  'wishlist.title': ['Places to visit', '想去的地方'],
  'wishlist.empty': ['Search for a place to start planning', '搜索一个地点开始规划'],
  'wishlist.count': ['saved', '已保存'],

  'leg.estimated': ['estimated', '估算'],
  'leg.pending': ['finding route…', '查找路线…'],

  'budget.total': ['Total', '合计'],
  'budget.byCategory': ['By category', '按类别'],
  'budget.add': ['Add an expense', '添加开销'],
  'budget.empty': ['No expenses yet', '还没有开销记录'],
  'budget.title': ['Description', '说明'],
  'budget.amount': ['Amount', '金额'],

  'res.add': ['Add a reservation', '添加预订'],
  'res.empty': ['No reservations yet', '还没有预订'],
  'res.flight': ['Flight', '航班'],
  'res.lodging': ['Lodging', '住宿'],
  'res.car': ['Car rental', '租车'],
  'res.rail': ['Rail', '火车'],
  'res.other': ['Other', '其他'],
  'res.confirmation': ['Confirmation', '确认号'],
  'res.from': ['From', '出发'],
  'res.to': ['To', '到达'],

  'check.add': ['Add a checklist', '添加清单'],
  'check.addItem': ['Add an item', '添加一项'],
  'check.empty': ['No checklists yet', '还没有清单'],
  'check.done': ['done', '已完成'],

  'share.title': ['Share this trip', '分享行程'],
  'share.copy': ['Copy link', '复制链接'],
  'share.copied': ['Copied', '已复制'],
  'share.print': ['Print', '打印'],
  'share.description': [
    'Anyone with this link can view the trip. The link contains the whole plan, so it keeps working offline.',
    '任何拿到链接的人都可以查看行程。链接本身包含完整计划，离线也能打开。',
  ],
  'share.excludeBudget': ['Leave the budget out', '不包含预算'],
  'share.tooLong': [
    'This trip is too large to fit in a link. Print it or remove some places.',
    '行程太大，无法放进链接。请打印或删除部分地点。',
  ],
  'share.readOnly': ['You are viewing a shared trip', '您正在查看分享的行程'],
  'share.makeYours': ['Make a copy', '复制一份'],

  'presence.you': ['You', '你'],
  'presence.editing': ['editing', '正在编辑'],
  'presence.alone': ['Only you are here', '只有你在'],
  'presence.rename': ['Change your name', '修改名字'],

  'sync.local': ['Saved on this device', '已保存在本机'],
  'sync.connecting': ['Connecting…', '连接中…'],
  'sync.live': ['Live', '实时同步'],
  'sync.offline': ['Offline', '离线'],
  'sync.readOnly': ['Read only', '只读'],

  'action.undo': ['Undo', '撤销'],
  'action.redo': ['Redo', '重做'],
  'action.done': ['Done', '完成'],
  'action.cancel': ['Cancel', '取消'],
  'action.close': ['Close', '关闭'],
  'action.save': ['Save', '保存'],
  'action.delete': ['Delete', '删除'],

  'map.provider': ['Map data', '地图数据'],
  'map.auto': ['Automatic', '自动'],
  'map.unreachable': ['unreachable', '无法连接'],
  'map.ready': ['ready', '可用'],
  'map.hint': [
    'Amap is used inside mainland China, where Google Maps is unreachable.',
    '在中国大陆使用高德地图，因为无法连接 Google 地图。',
  ],

  'print.title': ['Trip plan', '行程计划'],
  'print.generating': ['Preparing maps…', '正在生成地图…'],

  'cat.sight': ['Sight', '景点'],
  'cat.food': ['Food', '餐饮'],
  'cat.stay': ['Stay', '住宿'],
  'cat.activity': ['Activity', '活动'],
  'cat.shopping': ['Shopping', '购物'],
  'cat.transit': ['Transit', '交通'],
  'cat.other': ['Other', '其他'],
} as const

export type StringKey = keyof typeof STRINGS

interface I18n {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: StringKey) => string
}

const Ctx = createContext<I18n | null>(null)

const STORAGE_KEY = 'travl.locale'

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    // Storage unavailable; fall back to the browser's preference.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale: (l) => {
        setLocaleState(l)
        try {
          localStorage.setItem(STORAGE_KEY, l)
        } catch {
          // Preference just won't persist.
        }
        document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
      },
      t: (key) => STRINGS[key][locale === 'zh' ? 1 : 0],
    }),
    [locale],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
