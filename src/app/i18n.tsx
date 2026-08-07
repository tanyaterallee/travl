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

  /* -- travl meet: scheduling ---------------------------------------------- */

  'meet.name': ['travl meet', 'travl 会面'],
  'meet.tagline': ['Give away the hours you are free', '把空出来的时间分享给朋友'],
  'meet.backToTrip': ['Trip planner', '行程规划'],
  'meet.nav': ['Meet', '会面'],
  'meet.times': ['Times shown in your own time zone', '时间按你所在的时区显示'],

  'meet.page.title': ['Page title', '页面标题'],
  'meet.page.headline': ['A line for your guests', '给客人的一句话'],
  'meet.page.host': ['Host', '主人'],
  'meet.page.hostPlaceholder': ['Your name', '你的名字'],

  'meet.link.title': ['Booking link', '预约链接'],
  'meet.link.copy': ['Copy link', '复制链接'],
  'meet.link.copied': ['Copied', '已复制'],
  'meet.link.email': ['Send by email', '通过邮件发送'],
  'meet.link.open': ['Open it', '打开'],
  'meet.link.hint': [
    'Anyone with this link can take one of your open slots.',
    '任何拿到链接的人都可以预约一个空闲时间段。',
  ],
  'meet.link.localOnly': [
    'This page lives in this browser only. Run the relay and set VITE_RELAY_URL for the link to reach anybody else.',
    '此页面目前只存在于本浏览器中。运行中继服务并设置 VITE_RELAY_URL，链接才能被其他人打开。',
  ],

  'meet.google.title': ['Google account', 'Google 账号'],
  'meet.google.connect': ['Sign in with Google', '使用 Google 登录'],
  'meet.google.signOut': ['Sign out', '退出登录'],
  'meet.google.connecting': ['Connecting…', '连接中…'],
  'meet.google.why': [
    'Signing in names you on the booking page and mirrors your slots into your calendar.',
    '登录后可在预约页面显示你的身份，并把时间段同步到你的日历。',
  ],
  'meet.google.unconfigured': [
    'Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID to sync with a calendar — everything else works without it.',
    '未配置 Google 登录。设置 VITE_GOOGLE_CLIENT_ID 后即可同步日历，其他功能无需登录即可使用。',
  ],
  'meet.google.calendar': ['Mirror slots to', '同步时间段到'],
  'meet.google.noCalendar': ['Do not mirror', '不同步'],
  'meet.google.pushAll': ['Push every slot', '推送全部时间段'],
  'meet.google.syncing': ['Syncing…', '同步中…'],
  'meet.google.synced': ['Calendar up to date', '日历已同步'],
  'meet.google.syncFailed': ['Calendar sync failed', '日历同步失败'],

  'meet.itin.title': ['Linked itinerary', '关联行程'],
  'meet.itin.help': [
    'Link what you are already doing. Everything on it becomes unavailable time on your booking page.',
    '关联你已有的安排。其中的行程会在预约页面显示为不可预约。',
  ],
  'meet.itin.placeholder': ['Paste a Wanderlog or calendar .ics link', '粘贴 Wanderlog 或日历 .ics 链接'],
  'meet.itin.link': ['Link it', '关联'],
  'meet.itin.useTrip': ['Use my travl trip', '使用我的 travl 行程'],
  'meet.itin.useCalendar': ['Import this calendar', '导入此日历'],
  'meet.itin.paste': ['Paste the file instead', '改为粘贴文件内容'],
  'meet.itin.pastePlaceholder': ['BEGIN:VCALENDAR…', 'BEGIN:VCALENDAR…'],
  'meet.itin.unlink': ['Unlink', '取消关联'],
  'meet.itin.refresh': ['Re-import', '重新导入'],
  'meet.itin.none': ['Nothing linked yet', '尚未关联行程'],
  'meet.itin.events': ['events', '条安排'],
  'meet.itin.importing': ['Importing…', '导入中…'],

  'meet.err.empty': ['That calendar has no events in it.', '该日历中没有日程。'],
  'meet.err.blocked': [
    'The browser was not allowed to fetch that link. Paste the file contents instead — it works the same.',
    '浏览器无法跨域获取该链接。请改为粘贴文件内容，效果相同。',
  ],
  'meet.err.notCalendar': ['That link did not return a calendar file.', '该链接返回的不是日历文件。'],
  'meet.err.network': ['Could not reach that link.', '无法访问该链接。'],
  'meet.err.needsIcs': [
    'Use the .ics export link rather than the page address. Wanderlog: Export → calendar file. Google Calendar: Settings → Integrate calendar → iCal address.',
    '请使用 .ics 导出链接，而不是网页地址。Wanderlog：导出 → 日历文件；Google 日历：设置 → 集成日历 → iCal 地址。',
  ],
  'meet.err.noTrip': [
    'Your travl trip has no stops with a start time yet.',
    '你的 travl 行程中还没有设置了时间的地点。',
  ],
  'meet.err.noCalendar': ['Pick a calendar first.', '请先选择一个日历。'],

  'meet.slot.add': ['Add a time slot', '添加时间段'],
  'meet.slot.edit': ['Edit', '编辑'],
  'meet.slot.duplicate': ['Duplicate', '复制'],
  'meet.slot.delete': ['Delete', '删除'],
  'meet.slot.what': ['What are you doing?', '活动内容'],
  'meet.slot.whatPlaceholder': ['Coffee at the Bund', '外滩喝咖啡'],
  'meet.slot.place': ['Place', '地点'],
  'meet.slot.address': ['Address', '地址'],
  'meet.slot.blurb': ['A line for your guest', '给客人的说明'],
  'meet.slot.start': ['Starts', '开始'],
  'meet.slot.end': ['Ends', '结束'],
  'meet.slot.save': ['Save', '保存'],
  'meet.slot.none': [
    'No time slots yet. Add the hours you are happy to give away.',
    '还没有时间段。添加你愿意空出来的时间。',
  ],
  'meet.slot.backwards': ['The end has to come after the start.', '结束时间必须晚于开始时间。'],
  'meet.slot.needsTitle': ['Give the slot a name.', '请填写活动内容。'],
  'meet.slot.pick': ['Pick from my trip', '从行程中选择'],

  'meet.state.open': ['Open to reserve', '可预约'],
  'meet.state.booked': ['Already slotted', '已被预约'],
  'meet.state.blocked': ['Unavailable', '不可预约'],
  'meet.state.past': ['Past', '已结束'],
  'meet.state.tentative': ['2nd option', '备选'],
  'meet.state.holds': ['holding this as a second option', '将其作为备选'],

  'meet.book.who': ['Who booked', '预约情况'],
  'meet.book.none': ['Nobody has booked yet.', '还没有人预约。'],
  'meet.book.cancel': ['Cancel', '取消'],
  'meet.book.promote': ['Make this the booking', '设为正式预约'],

  'meet.guest.name': ['Your name', '你的名字'],
  'meet.guest.email': ['Your email', '你的邮箱'],
  'meet.guest.continue': ['Continue', '继续'],
  'meet.guest.slots': ['Available times', '可选时间'],
  'meet.guest.noSlots': ['Nothing is open at the moment.', '目前没有可预约的时间。'],
  'meet.guest.about': ['About this place', '地点介绍'],
  'meet.guest.openMaps': ['Open in Google Maps', '在 Google 地图中打开'],
  'meet.guest.confirm': ['Confirm', '确认预约'],
  'meet.guest.confirmTentative': ['Save as my 2nd option', '存为备选'],
  'meet.guest.tentativeHint': [
    'A second option holds nothing — anyone else can still take it.',
    '备选不会占用该时间，其他人仍可预约。',
  ],
  'meet.guest.back': ['Back', '返回'],
  'meet.guest.note': ['Anything to add?', '备注'],
  'meet.guest.notePlaceholder': ['Optional', '可不填'],
  'meet.guest.booked': ['You are booked', '预约成功'],
  'meet.guest.savedTentative': ['Saved as your second option', '已存为备选'],
  'meet.guest.addGoogle': ['Add to Google Calendar', '添加到 Google 日历'],
  'meet.guest.addOutlook': ['Add to Outlook', '添加到 Outlook'],
  'meet.guest.download': ['Download .ics', '下载 .ics'],
  'meet.guest.addSecond': ['Add a second option', '添加备选时间'],
  'meet.guest.yours': ['Your booking', '你的预约'],
  'meet.guest.change': ['Pick a different time', '换一个时间'],
  'meet.guest.with': ['with', '与'],
  'meet.guest.hosted': ['Hosted by', '主人'],
  'meet.guest.empty': [
    'This booking page has nothing on it. Either the host has not published any times yet, or the link has not reached this device — ask them to check that their travl relay is running.',
    '此预约页面还没有内容。可能主人尚未发布时间，或链接未同步到此设备——请让对方确认 travl 中继服务是否在运行。',
  ],

  'meet.prob.name': ['Enter your name.', '请填写名字。'],
  'meet.prob.email': ['That does not look like an email address.', '邮箱格式不正确。'],
  'meet.prob.taken': ['Somebody just took that time.', '该时间刚刚被别人预约了。'],
  'meet.prob.blocked': ['That time is no longer free.', '该时间已不再空闲。'],
  'meet.prob.past': ['That time has already passed.', '该时间已过。'],
  'meet.prob.gone': ['That slot no longer exists.', '该时间段已不存在。'],
  'meet.prob.sameSlot': ['That is already your booking.', '这已经是你的预约。'],
  'meet.prob.hasPrimary': [
    'You already have a booking. Cancel it first, or save this as your second option.',
    '你已经有一个预约。请先取消，或把它存为备选。',
  ],
  'meet.prob.hasTentative': [
    'You already have a second option saved.',
    '你已经保存了一个备选时间。',
  ],

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
