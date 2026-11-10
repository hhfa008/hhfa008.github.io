/**
 * 桌游目录的统一数据契约。
 * 与 data/boardgames.schema.json 保持一一对应；页面与脚本均只依赖这些字段。
 */

export type Category =
  | 'euro'
  | 'party'
  | 'ameritrash'
  | 'card'
  | 'two-player'
  | 'family';

export interface CategoryInfo {
  key: Category;
  name: { zh: string; en: string };
  desc: { zh: string; en: string };
}

export interface BoardGameSource {
  /** 采集站点。当前目录全部来自集石；bgg / manual 为契约保留值。 */
  site: 'gstone' | 'bgg' | 'manual';
  url: string;
  /** ISO 8601 时间戳，表示该条原始页面被抓取的时间。 */
  fetchedAt: string;
}

export interface BoardGamePlayable {
  /** 相对 boardgame 根目录的入口，例如 "hero-realms/"。 */
  href: string;
  /** true 表示可跨设备联机；false 表示同屏/AI 本地开局。 */
  online: boolean;
}

export interface BoardGame {
  /** 稳定 id，例如 "gstone-550" 或 "bgg-230802"。 */
  id: string;
  /** URL 用 kebab-case，全局唯一。 */
  slug: string;
  /** 中文名 / 原名（中文原创游戏为本目录使用的英文译名）。 */
  name: { zh: string; en: string };
  category: Category;
  players: { min: number; max: number };
  /** 最佳人数，可为空数组。 */
  bestPlayers: number[];
  /** 单局总时长，单位分钟。 */
  playTime: { min: number; max: number };
  /** 重度 1–5，一位小数。 */
  weight: number;
  /** 评分 0–10，一位小数。 */
  rating: number;
  designers: string[];
  publishers: string[];
  year: number;
  /** 只存数据，页面不直接加载外链。 */
  coverUrl: string;
  source: BoardGameSource;
  tags?: string[];
  /** 仅填确证可玩的版本；缺省表示目录收录、暂未提供可玩版本。 */
  playable?: BoardGamePlayable;
  /** 相对 boardgame 根目录的规则页；文件不存在时页面显示「规则待补」。 */
  rules?: string;
}
