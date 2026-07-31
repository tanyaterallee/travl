import type { Category } from '../core/types'

/**
 * A small bundled place index.
 *
 * It exists so the app is fully usable with no API keys at all: search,
 * itinerary building, the map and print all work offline. Google and Amap
 * supersede it whenever their keys are configured.
 *
 * Coordinates are WGS-84. The mainland Chinese entries are what exercise the
 * GCJ-02 path, and the Hong Kong entries exercise the carve-out where the
 * shift must *not* be applied.
 */

export interface SeedPlace {
  id: string
  name: string
  nameZh: string
  city: string
  cityZh: string
  address: string
  lat: number
  lng: number
  category: Category
  rating: number
  ratingCount: number
}

export const SEED_PLACES: readonly SeedPlace[] = [
  // ---- Beijing ------------------------------------------------------------
  { id: 'bj-forbidden', name: 'Forbidden City', nameZh: '故宫博物院', city: 'Beijing', cityZh: '北京', address: '4 Jingshan Front St, Dongcheng', lat: 39.9163, lng: 116.3972, category: 'sight', rating: 4.8, ratingCount: 62140 },
  { id: 'bj-tiananmen', name: 'Tiananmen Square', nameZh: '天安门广场', city: 'Beijing', cityZh: '北京', address: 'Dongcheng District', lat: 39.9055, lng: 116.3976, category: 'sight', rating: 4.6, ratingCount: 41230 },
  { id: 'bj-heaven', name: 'Temple of Heaven', nameZh: '天坛公园', city: 'Beijing', cityZh: '北京', address: '1 Tiantan E Rd, Dongcheng', lat: 39.8822, lng: 116.4066, category: 'sight', rating: 4.7, ratingCount: 28910 },
  { id: 'bj-summer', name: 'Summer Palace', nameZh: '颐和园', city: 'Beijing', cityZh: '北京', address: '19 Xinjian Gongmen Rd, Haidian', lat: 39.9996, lng: 116.2755, category: 'sight', rating: 4.7, ratingCount: 33400 },
  { id: 'bj-wall', name: 'Mutianyu Great Wall', nameZh: '慕田峪长城', city: 'Beijing', cityZh: '北京', address: 'Huairou District', lat: 40.4319, lng: 116.5704, category: 'sight', rating: 4.9, ratingCount: 19870 },
  { id: 'bj-nanluogu', name: 'Nanluoguxiang', nameZh: '南锣鼓巷', city: 'Beijing', cityZh: '北京', address: 'Nanluogu Xiang, Dongcheng', lat: 39.9368, lng: 116.4032, category: 'shopping', rating: 4.3, ratingCount: 15220 },
  { id: 'bj-wangfujing', name: 'Wangfujing Street', nameZh: '王府井大街', city: 'Beijing', cityZh: '北京', address: 'Wangfujing St, Dongcheng', lat: 39.9151, lng: 116.4106, category: 'shopping', rating: 4.2, ratingCount: 20140 },
  { id: 'bj-quanjude', name: 'Quanjude Roast Duck', nameZh: '全聚德烤鸭店', city: 'Beijing', cityZh: '北京', address: '32 Qianmen St, Dongcheng', lat: 39.9093, lng: 116.4108, category: 'food', rating: 4.1, ratingCount: 8820 },
  { id: 'bj-798', name: '798 Art District', nameZh: '798艺术区', city: 'Beijing', cityZh: '北京', address: '2 Jiuxianqiao Rd, Chaoyang', lat: 39.9843, lng: 116.4951, category: 'activity', rating: 4.4, ratingCount: 11360 },
  { id: 'bj-pek', name: 'Beijing Capital Airport', nameZh: '北京首都国际机场', city: 'Beijing', cityZh: '北京', address: 'Shunyi District', lat: 40.0799, lng: 116.6031, category: 'transit', rating: 4.0, ratingCount: 24500 },

  // ---- Shanghai -----------------------------------------------------------
  { id: 'sh-bund', name: 'The Bund', nameZh: '外滩', city: 'Shanghai', cityZh: '上海', address: 'Zhongshan East 1st Rd, Huangpu', lat: 31.2397, lng: 121.4905, category: 'sight', rating: 4.7, ratingCount: 58200 },
  { id: 'sh-yu', name: 'Yu Garden', nameZh: '豫园', city: 'Shanghai', cityZh: '上海', address: '279 Yuyuan Old St, Huangpu', lat: 31.227, lng: 121.4922, category: 'sight', rating: 4.5, ratingCount: 31400 },
  { id: 'sh-pearl', name: 'Oriental Pearl Tower', nameZh: '东方明珠广播电视塔', city: 'Shanghai', cityZh: '上海', address: '1 Century Ave, Pudong', lat: 31.2397, lng: 121.4998, category: 'sight', rating: 4.5, ratingCount: 27600 },
  { id: 'sh-nanjing', name: 'Nanjing Road', nameZh: '南京路步行街', city: 'Shanghai', cityZh: '上海', address: 'Nanjing E Rd, Huangpu', lat: 31.2354, lng: 121.4737, category: 'shopping', rating: 4.4, ratingCount: 36800 },
  { id: 'sh-tianzifang', name: 'Tianzifang', nameZh: '田子坊', city: 'Shanghai', cityZh: '上海', address: '210 Taikang Rd, Huangpu', lat: 31.2093, lng: 121.4675, category: 'shopping', rating: 4.3, ratingCount: 14900 },
  { id: 'sh-museum', name: 'Shanghai Museum', nameZh: '上海博物馆', city: 'Shanghai', cityZh: '上海', address: '201 Renmin Ave, Huangpu', lat: 31.2286, lng: 121.4757, category: 'sight', rating: 4.6, ratingCount: 18700 },
  { id: 'sh-xintiandi', name: 'Xintiandi', nameZh: '新天地', city: 'Shanghai', cityZh: '上海', address: 'Taicang Rd, Huangpu', lat: 31.2204, lng: 121.475, category: 'food', rating: 4.4, ratingCount: 16300 },
  { id: 'sh-jingan', name: "Jing'an Temple", nameZh: '静安寺', city: 'Shanghai', cityZh: '上海', address: '1686 Nanjing W Rd, Jing’an', lat: 31.2237, lng: 121.4452, category: 'sight', rating: 4.4, ratingCount: 12900 },
  { id: 'sh-disney', name: 'Shanghai Disneyland', nameZh: '上海迪士尼乐园', city: 'Shanghai', cityZh: '上海', address: '310 Huangzhao Rd, Pudong', lat: 31.1443, lng: 121.657, category: 'activity', rating: 4.6, ratingCount: 44100 },
  { id: 'sh-pvg', name: 'Shanghai Pudong Airport', nameZh: '上海浦东国际机场', city: 'Shanghai', cityZh: '上海', address: 'Pudong New District', lat: 31.1443, lng: 121.8083, category: 'transit', rating: 4.1, ratingCount: 29800 },

  // ---- Hong Kong (outside the GCJ-02 shift envelope) ----------------------
  { id: 'hk-peak', name: 'Victoria Peak', nameZh: '太平山顶', city: 'Hong Kong', cityZh: '香港', address: 'The Peak, Hong Kong Island', lat: 22.2759, lng: 114.1455, category: 'sight', rating: 4.6, ratingCount: 38400 },
  { id: 'hk-tst', name: 'Tsim Sha Tsui Promenade', nameZh: '尖沙咀海濱花園', city: 'Hong Kong', cityZh: '香港', address: 'Salisbury Rd, Kowloon', lat: 22.2934, lng: 114.1722, category: 'sight', rating: 4.6, ratingCount: 21500 },

  // ---- Tokyo --------------------------------------------------------------
  { id: 'tk-sensoji', name: 'Sensō-ji', nameZh: '浅草寺', city: 'Tokyo', cityZh: '东京', address: '2-3-1 Asakusa, Taito City', lat: 35.7148, lng: 139.7967, category: 'sight', rating: 4.5, ratingCount: 52300 },
  { id: 'tk-shibuya', name: 'Shibuya Crossing', nameZh: '涩谷十字路口', city: 'Tokyo', cityZh: '东京', address: 'Shibuya City', lat: 35.6595, lng: 139.7005, category: 'sight', rating: 4.5, ratingCount: 47600 },
  { id: 'tk-meiji', name: 'Meiji Jingu', nameZh: '明治神宫', city: 'Tokyo', cityZh: '东京', address: '1-1 Yoyogikamizonocho, Shibuya', lat: 35.6764, lng: 139.6993, category: 'sight', rating: 4.6, ratingCount: 39100 },
  { id: 'tk-teamlab', name: 'teamLab Planets', nameZh: 'teamLab Planets', city: 'Tokyo', cityZh: '东京', address: '6-1-16 Toyosu, Koto City', lat: 35.6486, lng: 139.7906, category: 'activity', rating: 4.4, ratingCount: 18200 },
  { id: 'tk-tsukiji', name: 'Tsukiji Outer Market', nameZh: '築地场外市场', city: 'Tokyo', cityZh: '东京', address: '4 Chome Tsukiji, Chuo City', lat: 35.6654, lng: 139.7707, category: 'food', rating: 4.4, ratingCount: 26800 },
  { id: 'tk-skytree', name: 'Tokyo Skytree', nameZh: '东京晴空塔', city: 'Tokyo', cityZh: '东京', address: '1-1-2 Oshiage, Sumida City', lat: 35.7101, lng: 139.8107, category: 'sight', rating: 4.5, ratingCount: 41900 },

  // ---- Elsewhere ----------------------------------------------------------
  { id: 'pa-eiffel', name: 'Eiffel Tower', nameZh: '埃菲尔铁塔', city: 'Paris', cityZh: '巴黎', address: 'Champ de Mars, 5 Av. Anatole France', lat: 48.8584, lng: 2.2945, category: 'sight', rating: 4.7, ratingCount: 143000 },
  { id: 'pa-louvre', name: 'Louvre Museum', nameZh: '卢浮宫', city: 'Paris', cityZh: '巴黎', address: 'Rue de Rivoli, 75001', lat: 48.8606, lng: 2.3376, category: 'sight', rating: 4.7, ratingCount: 98400 },
  { id: 'ny-times', name: 'Times Square', nameZh: '时代广场', city: 'New York', cityZh: '纽约', address: 'Manhattan, NY 10036', lat: 40.758, lng: -73.9855, category: 'sight', rating: 4.7, ratingCount: 187000 },
  { id: 'ny-central', name: 'Central Park', nameZh: '中央公园', city: 'New York', cityZh: '纽约', address: 'Manhattan, NY', lat: 40.7829, lng: -73.9654, category: 'sight', rating: 4.8, ratingCount: 132000 },
  { id: 'ld-tower', name: 'Tower Bridge', nameZh: '伦敦塔桥', city: 'London', cityZh: '伦敦', address: 'Tower Bridge Rd, SE1 2UP', lat: 51.5055, lng: -0.0754, category: 'sight', rating: 4.7, ratingCount: 76500 },
  { id: 'ld-british', name: 'British Museum', nameZh: '大英博物馆', city: 'London', cityZh: '伦敦', address: 'Great Russell St, WC1B 3DG', lat: 51.5194, lng: -0.127, category: 'sight', rating: 4.7, ratingCount: 104000 },
]

/** Case- and script-insensitive scoring, so "外滩" and "bund" both find it. */
export function scoreSeedPlace(p: SeedPlace, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const fields: [string, number][] = [
    [p.name.toLowerCase(), 10],
    [p.nameZh, 10],
    [p.city.toLowerCase(), 4],
    [p.cityZh, 4],
    [p.address.toLowerCase(), 2],
  ]
  let best = 0
  for (const [value, weight] of fields) {
    if (value === q) best = Math.max(best, weight * 3)
    else if (value.startsWith(q)) best = Math.max(best, weight * 2)
    else if (value.includes(q)) best = Math.max(best, weight)
  }
  return best
}
