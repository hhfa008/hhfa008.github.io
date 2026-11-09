/* Arcade 游戏家族与变体 —— 100 款游戏的唯一数据源。
 *
 * 每个 family 提供：玩法规格（给本地模型）、测试要点（先写测试）、图标与分类。
 * 变体只改参数与名字，避免 100 份重复描述。
 */

function g(slug, zh, en, id, params, spec, tests) {
  return { slug, zh, en, id, params: params || {}, spec, tests };
}

export const families = [
  {
    key: 'slide2048', cat: 'mini', icon: '2048',
    desc: { zh: '滑动合并相同数字，合到 2048；键盘、触屏都能玩。', en: 'Slide and merge equal tiles to reach 2048. Keyboard or swipe.', id: 'Geser dan gabungkan ubin bernilai sama sampai 2048.' },
    state: 'state={board: 长度 n*n 的一维数组（行优先）, score, moves, won, over}；act(state, dir, rng) 返回 {state, changed, gained}',
    stateKeys: ['board', 'score', 'moves', 'won', 'over'],
    actionSpec: "'left' | 'right' | 'up' | 'down'",
    variants: [
      g('2048-3', '2048 3×3', '2048 3×3', '2048 3×3', { n: 3 },
        '3×3 的 2048：方向键/WASD/滑动；所有块滑到底，同值合并（每块每次移动最多一次），合并值累加得分；每次有效移动后在随机空格生成 2（90%）或 4（10%）；合成 2048 判胜（可继续）；无空格且无相邻同值判负。',
        '3×3：左移 [2,2,0] 得 [4,0,0]；[2,2,2] 得 [4,2,0] 不连锁；无效移动 changed=false；同 rng 初始盘面确定。'),
      g('2048', '2048', '2048', '2048', { n: 4 },
        '4×4 经典 2048：方向键/WASD/滑动；所有块滑到底，同值合并（每块每次移动最多一次），合并值累加得分；每次有效移动后在随机空格生成 2（90%）或 4（10%）；合成 2048 判胜（可继续）；无空格且无相邻同值判负。',
        '4×4：左移 [2,2,0,0]→[4,0,0,0]；[2,2,2,2]→[4,4,0,0]；[4,4,8,0]→[8,8,0,0]；右/上/下方向正确；纯函数。'),
      g('2048-5', '2048 5×5', '2048 5×5', '2048 5×5', { n: 5 },
        '5×5 的 2048：规则同经典 2048，目标 2048；方向键/WASD/滑动；每块每次移动最多合并一次；每次有效移动生成 2 或 4。',
        '5×5：左移 [2,2,0,0,0]→[4,0,0,0,0]；行尾合并；无效移动 changed=false。'),
    ],
  },
  {
    key: 'slide-puzzle', cat: 'mini', icon: 'slide',
    desc: { zh: '移动数字块，按顺序拼回；步数越少越好。', en: 'Slide numbered tiles back into order; fewer moves is better.', id: 'Geser ubin angka kembali ke urutan; makin sedikit langkah makin baik.' },
    state: 'state={tiles: 长度 n*n 的一维数组（行优先，0 表示空格）, blank: 空格下标, moves, won}',
    stateKeys: ['tiles', 'blank', 'moves', 'won'],
    actionSpec: "'left' | 'right' | 'up' | 'down'（与空格交换）",
    variants: [
      g('slide-3', '数字华容道 3×3', 'Sliding Puzzle 3×3', 'Puzzle Geser 3×3', { n: 3 },
        '3×3 数字华容道：1..8 与一个空格随机打乱；点击或方向键移动与空格相邻的块；拼回 1..8 顺序且空格在右下角判胜；统计步数。',
        '3×3：解为 [1,2,3,4,5,6,7,8,0]；与空格相邻的块可移动，不相邻 changed=false；移动后空格位置互换；步数+1。'),
      g('slide-4', '数字华容道 4×4', 'Sliding Puzzle 4×4', 'Puzzle Geser 4×4', { n: 4 },
        '4×4 数字华容道（15-puzzle）：1..15 与空格；点击/方向键移动相邻块；拼回顺序判胜；统计步数。',
        '4×4：解为 1..15,0；空格在右下角；相邻移动；非法移动 changed=false。'),
      g('slide-5', '数字华容道 5×5', 'Sliding Puzzle 5×5', 'Puzzle Geser 5×5', { n: 5 },
        '5×5 数字华容道（24-puzzle）：1..24 与空格；点击/方向键移动；拼回顺序判胜；统计步数。',
        '5×5：初始方块数量 25，恰好一个 0；移动相邻块；步数累加。'),
    ],
  },
  {
    key: 'lights-out', cat: 'mini', icon: 'lights',
    desc: { zh: '点一盏灯会翻转它和四邻，目标全灭。', en: 'Tapping a light flips it and its neighbours; turn them all off.', id: 'Ketuk lampu untuk membaliknya dan tetangganya; matikan semua.' },
    state: 'state={lights: 长度 n*n 的一维数组（0/1，行优先）, moves, won}',
    stateKeys: ['lights', 'moves', 'won'],
    actionSpec: "格子下标 0..n*n-1（数字）",
    variants: [
      g('lights-3', '关灯 3×3', 'Lights Out 3×3', 'Matikan Lampu 3×3', { n: 3 },
        '3×3 关灯：点击一个格子翻转它和上下左右邻居的灯；目标全灭；统计点击次数；保证初始局面可解（由已解局面反向点击生成）。',
        '3×3：解盘全 0；点击中心翻转 5 格；点击角落翻转 3 格；全部熄灭时 status=won；反向生成可解。'),
      g('lights-4', '关灯 4×4', 'Lights Out 4×4', 'Matikan Lampu 4×4', { n: 4 },
        '4×4 关灯：规则同上，棋盘 4×4；目标全灭；点击次数计数；初始由已解局面反向打乱保证可解。',
        '4×4：翻转范围正确；点击 (0,0) 翻转 (0,0)(0,1)(1,0) 三格；全灭判胜。'),
      g('lights-5', '关灯 5×5', 'Lights Out 5×5', 'Matikan Lampu 5×5', { n: 5 },
        '5×5 关灯：棋盘 5×5，点击翻转十字五格；全灭判胜；点击计数；初始可解。',
        '5×5：中心点击翻转 5 格；边界点击翻转 4 格；全灭判胜；点击计数。'),
    ],
  },
  {
    key: 'minesweeper', cat: 'mini', icon: 'mines',
    desc: { zh: '翻开格子避开地雷，数字提示周围雷数。', en: 'Reveal squares and avoid mines; numbers count adjacent mines.', id: 'Buka kotak, hindari ranjau; angka menunjukkan ranjau di sekitarnya.' },
    state: 'state={rows, cols, mines: 雷的下标数组, revealed: 布尔数组, flags: 布尔数组, status: playing|won|lost, started}',
    stateKeys: ['rows', 'cols', 'mines', 'revealed', 'flags', 'status', 'started'],
    actionSpec: "{type:'reveal'|'flag', index}",
    variants: [
      g('mines-easy', '扫雷·初级', 'Minesweeper Easy', 'Sapu Ranjau Mudah', { rows: 9, cols: 9, mines: 10 },
        '9×9 扫雷，10 颗雷：左键翻开，右键/长按插旗；数字表示周围雷数；翻开雷判负；非雷格全部翻开判胜；首翻不踩雷；计时与剩余雷数。',
        '9×9：雷数 10；首翻安全；邻雷计数正确；翻开雷 status=lost；非雷全开 status=won；插旗不改变雷数。'),
      g('mines-mid', '扫雷·中级', 'Minesweeper Medium', 'Sapu Ranjau Sedang', { rows: 12, cols: 12, mines: 20 },
        '12×12 扫雷，20 颗雷：规则同初级；首翻安全；计时与剩余雷数。',
        '12×12：雷数 20；首翻安全；邻雷计数；胜负判定。'),
      g('mines-hard', '扫雷·高级', 'Minesweeper Hard', 'Sapu Ranjau Sulit', { rows: 16, cols: 16, mines: 40 },
        '16×16 扫雷，40 颗雷：规则同初级；首翻安全；计时与剩余雷数。',
        '16×16：雷数 40；首翻安全；邻雷计数；胜负判定。'),
    ],
  },
  {
    key: 'memory-pairs', cat: 'mini', icon: 'memory',
    desc: { zh: '翻牌配对，记住位置，用最少步数全配对。', en: 'Flip cards and match pairs from memory in as few moves as possible.', id: 'Balik kartu dan cocokkan pasangan dari ingatan.' },
    state: 'state={cards: [{pair: 配对编号, up: 是否翻开, matched: 是否已配对}], flips, moves, won}',
    stateKeys: ['cards', 'flips', 'moves', 'won'],
    actionSpec: "卡片下标 0..count-1（数字）",
    variants: [
      g('memory-3x4', '翻牌记忆 3×4', 'Memory Pairs 3×4', 'Memori Pasangan 3×4', { rows: 3, cols: 4 },
        '3×4 翻牌记忆：6 对图案；每次翻两张，相同则保持翻开，不同则短暂后翻回；全部配对判胜；统计步数与用时。',
        '3×4：牌数 12，成对 6；翻两张相同 matched；不同翻回；全配对 status=won；步数计数。'),
      g('memory-4x4', '翻牌记忆 4×4', 'Memory Pairs 4×4', 'Memori Pasangan 4×4', { rows: 4, cols: 4 },
        '4×4 翻牌记忆：8 对图案；规则同上；全部配对判胜。',
        '4×4：牌数 16，成对 8；配对逻辑；胜负判定。'),
      g('memory-5x4', '翻牌记忆 5×4', 'Memory Pairs 5×4', 'Memori Pasangan 5×4', { rows: 5, cols: 4 },
        '5×4 翻牌记忆：10 对图案；规则同上；全部配对判胜。',
        '5×4：牌数 20，成对 10；配对逻辑；胜负判定。'),
    ],
  },
  {
    key: 'snake', cat: 'mini', icon: 'snake',
    desc: { zh: '吃食物变长，别撞墙也别咬到自己。', en: 'Eat, grow longer, and avoid the walls and your own tail.', id: 'Makan, makin panjang, hindari dinding dan ekor sendiri.' },
    state: 'state={size, body: [[r,c], ...]（body[0] 是头）, dir, food: [r,c], score, alive}',
    stateKeys: ['size', 'body', 'dir', 'food', 'score', 'alive'],
    actionSpec: "'left'|'right'|'up'|'down'（禁止 180° 反向）",
    variants: [
      g('snake', '贪吃蛇', 'Snake', 'Ular', { size: 16, wrap: false, speed: 5 },
        '16×16 贪吃蛇：方向键/WASD/滑动转向；吃到食物长度+1、得分+1，食物随机出现在空格；撞墙或撞到自己判负；不能反向。',
        '16×16：初始长度 3；吃到食物长度+1、得分+1；撞墙 lost；撞自己 lost；禁止 180° 反向；食物不在蛇身上。'),
      g('snake-wrap', '贪吃蛇·穿墙', 'Snake Wrap', 'Ular Tembus', { size: 16, wrap: true, speed: 5 },
        '16×16 穿墙贪吃蛇：撞墙从对面出现；其余规则同经典；撞自己判负。',
        '穿墙：右移出界从左边进入；长度与得分增长；撞自己 lost。'),
      g('snake-fast', '贪吃蛇·极速', 'Snake Rapid', 'Ular Cepat', { size: 16, wrap: false, speed: 9 },
        '16×16 极速贪吃蛇：初始速度更快；规则同经典；撞墙/撞自己判负。',
        '极速：速度参数生效；基础移动/进食/死亡规则一致。'),
    ],
  },
  {
    key: 'pong', cat: 'mini', icon: 'pong',
    desc: { zh: '控制球拍对拉，先到 7 分。', en: 'Move your paddle and rally to 7 points.', id: 'Gerakkan pemukul dan raih 7 poin.' },
    state: 'state={w, h, ball: {x,y,vx,vy}, left: {y}, right: {y}, score: [left, right], over}',
    stateKeys: ['w', 'h', 'ball', 'left', 'right', 'score', 'over'],
    actionSpec: "'tick'（推进一帧）或 'up'|'down'（移动左拍）",
    variants: [
      g('pong', '乒乓', 'Pong', 'Pong', { ai: true, speed: 1 },
        '乒乓：球拍在左侧，鼠标/触屏/上下键控制；球碰到上下边界反弹；漏球对手得分；先到 7 分结束；AI 右侧追球。',
        '球在边界反弹；球拍碰撞反弹；漏球得分；先到 7 分 won；初始比分 0:0。'),
      g('pong-fast', '乒乓·极速', 'Pong Rapid', 'Pong Cepat', { ai: true, speed: 2 },
        '极速乒乓：球速更快，其余规则同经典；先到 7 分。',
        '速度参数；边界反弹；得分与结束条件。'),
      g('pong-2p', '乒乓·双人', 'Pong 2P', 'Pong 2 Pemain', { ai: false, speed: 1 },
        '双人乒乓：左拍 W/S，右拍上下键；球速固定；先到 7 分。',
        '双方球拍独立移动；得分归属正确；先到 7 分结束。'),
    ],
  },
  {
    key: 'tictactoe', cat: 'board', icon: 'tictactoe',
    desc: { zh: '与 AI 轮流落子，先连成一线者胜。', en: 'Take turns with the AI; line up your marks first to win.', id: 'Bermain bergiliran dengan AI; sejajarkan tanda duluan untuk menang.' },
    state: 'state={n, board: 长度 n*n 的一维数组（0 空, 1 X, 2 O）, turn: 1|2, status: playing|won|lost}',
    stateKeys: ['n', 'board', 'turn', 'status'],
    actionSpec: "格子下标 0..n*n-1（数字）",
    winCheck: '连成 n 个（行/列/对角）判胜；X 的胜利用 status=won，O 的胜利用 status=lost',
    variants: [
      g('tictactoe', '井字棋', 'Tic-tac-toe', 'Tic-tac-toe', { n: 3, ai: true },
        '3×3 井字棋：玩家 X 先手，对 AI；三连判胜；棋盘满平局；AI 采取最优策略至少不败。',
        '3×3：三连判胜（行/列/对角）；满盘平局；非法落子 changed=false；AI 能挡住必胜点。'),
      g('tictactoe-4', '四子棋 4×4', 'Tic-tac-toe 4×4', 'Tic-tac-toe 4×4', { n: 4, ai: true },
        '4×4 井字棋：连成 4 个判胜；玩家 X 先手对 AI；棋盘满平局。',
        '4×4：四连判胜；满盘平局；AI 挡子。'),
      g('tictactoe-5', '五子棋 5×5', 'Tic-tac-toe 5×5', 'Tic-tac-toe 5×5', { n: 5, ai: true },
        '5×5 井字棋：连成 5 个判胜；玩家 X 先手对 AI；棋盘满平局。',
        '5×5：五连判胜；满盘平局；AI 挡子。'),
    ],
  },
  {
    key: 'hanoi', cat: 'mini', icon: 'hanoi',
    desc: { zh: '每次移动一个盘，大盘不能压小盘。', en: 'Move one disk at a time; never put a larger disk on a smaller one.', id: 'Pindahkan satu cakram; cakram besar tak boleh menimpa yang kecil.' },
    state: 'state={disks, pegs: 三个数组，盘用 1..disks 表示（1 最小）, moves, won}',
    stateKeys: ['disks', 'pegs', 'moves', 'won'],
    actionSpec: "[from, to]（柱子下标 0..2）",
    variants: [
      g('hanoi-4', '汉诺塔 4 盘', 'Tower of Hanoi 4', 'Menara Hanoi 4', { disks: 4 },
        '汉诺塔 4 盘：三根柱子；每次移动最上面的一个盘；大盘不能压小盘；把所有盘从左柱移到右柱判胜；统计步数。',
        '4 盘：合法移动；大盘压小盘 changed=false；完成状态 won；最少步数 2^4-1=15。'),
      g('hanoi-5', '汉诺塔 5 盘', 'Tower of Hanoi 5', 'Menara Hanoi 5', { disks: 5 },
        '汉诺塔 5 盘：规则同上；最少步数 31。',
        '5 盘：合法/非法移动；完成判胜；最少步数 31。'),
      g('hanoi-6', '汉诺塔 6 盘', 'Tower of Hanoi 6', 'Menara Hanoi 6', { disks: 6 },
        '汉诺塔 6 盘：规则同上；最少步数 63。',
        '6 盘：合法/非法移动；完成判胜；最少步数 63。'),
    ],
  },
  {
    key: 'reaction', cat: 'mini', icon: 'reaction',
    desc: { zh: '比手速与眼力：点中目标，刷新自己的记录。', en: 'Test your speed and aim: hit the targets and beat your best.', id: 'Uji kecepatan dan bidikan; kalahkan skor terbaikmu.' },
    state: 'state={score, hits, misses, timeLeft, running, over}',
    stateKeys: ['score', 'hits', 'misses', 'timeLeft', 'running', 'over'],
    actionSpec: "'hit' 或 'tick'",
    variants: [
      g('whack', '打地鼠', 'Whack-a-Mole', 'Pukul Tikus', { time: 30, speed: 1 },
        '打地鼠：30 秒内点中随机出现的目标，点中得分，漏掉不扣分；时间结束统计得分；目标出现速度可调。',
        '初始得分 0；点中目标得分+1；同一目标不重复计分；时间结束 status=won。'),
      g('reaction-time', '反应测试', 'Reaction Test', 'Tes Reaksi', { rounds: 5 },
        '反应测试：屏幕变绿后尽快点击，记录 5 次反应时间并取平均；抢跑提示重来。',
        '5 轮；每轮记录毫秒；平均值计算；抢跑不计分。'),
      g('aim-trainer', '瞄准训练', 'Aim Trainer', 'Latihan Bidik', { time: 30 },
        '瞄准训练：30 秒内尽快点掉屏幕上的圆形目标，点中后在随机位置生成下一个；统计命中数与命中率。',
        '命中+1；生成位置在边界内；时间结束结束；命中率计算。'),
    ],
  },
];

/* 规模梯度：每个家族再补 7 个变体，凑满 100 款。
 * 变体只改参数与名字，玩法规格由家族统一描述。 */
const LADDERS = [
  {
    key: 'slide2048', values: [6, 7, 8, 9, 10, 11, 12],
    make: (n) => g(`2048-${n}`, `2048 ${n}×${n}`, `2048 ${n}×${n}`, `2048 ${n}×${n}`, { n },
      `${n}×${n} 的 2048：方向键/WASD/滑动；所有块滑到底，同值合并（每块每次移动最多一次），合并值累加得分；每次有效移动后在随机空格生成 2（90%）或 4（10%）；合成 2048 判胜（可继续）；无空格且无相邻同值判负。`,
      `${n}×${n}：左移合并；无效移动 changed=false；纯函数；同 rng 初始盘面确定。`),
  },
  {
    key: 'slide-puzzle', values: [6, 7, 8, 9, 10, 11, 12],
    make: (n) => g(`slide-${n}`, `数字华容道 ${n}×${n}`, `Sliding Puzzle ${n}×${n}`, `Puzzle Geser ${n}×${n}`, { n },
      `${n}×${n} 数字华容道：1..${n * n - 1} 与一个空格；点击/方向键移动相邻块；拼回顺序判胜；统计步数。`,
      `${n}×${n}：方块数 ${n * n}，恰好一个空格；相邻移动；非法移动 changed=false。`),
  },
  {
    key: 'lights-out', values: [6, 7, 8, 9, 10, 11, 12],
    make: (n) => g(`lights-${n}`, `关灯 ${n}×${n}`, `Lights Out ${n}×${n}`, `Matikan Lampu ${n}×${n}`, { n },
      `${n}×${n} 关灯：点击翻转自身与上下左右；目标全灭；统计点击；初始由已解局面反向点击生成，保证可解。`,
      `${n}×${n}：翻转范围；全灭 status=won；点击计数；反向生成。`),
  },
  {
    key: 'minesweeper',
    values: [[7,7,12],[10,10,18],[14,14,28],[18,18,50],[20,20,70],[24,24,99],[30,16,99]],
    make: ([rows, cols, mines]) => g(`mines-${rows}x${cols}`, `扫雷 ${rows}×${cols}`, `Minesweeper ${rows}×${cols}`, `Sapu Ranjau ${rows}×${cols}`, { rows, cols, mines },
      `${rows}×${cols} 扫雷，${mines} 颗雷：左键翻开，右键/长按插旗；首翻安全；邻雷计数；翻开雷判负；非雷格全开判胜。`,
      `${rows}×${cols}：雷数 ${mines}；首翻安全；邻雷计数；胜负判定。`),
  },
  {
    key: 'memory-pairs',
    values: [[4,5],[5,5],[6,4],[6,6],[8,5],[8,6],[4,6]],
    make: ([rows, cols]) => g(`memory-${rows}x${cols}`, `翻牌记忆 ${rows}×${cols}`, `Memory Pairs ${rows}×${cols}`, `Memori Pasangan ${rows}×${cols}`, { rows, cols },
      `${rows}×${cols} 翻牌记忆：${Math.floor(rows * cols / 2)} 对图案；每次翻两张，相同保持，不同翻回；全配对判胜；统计步数。`,
      `${rows}×${cols}：牌数 ${rows * cols}，成对 ${Math.floor(rows * cols / 2)}；配对逻辑；胜负判定。`),
  },
  {
    key: 'snake', values: [10, 12, 14, 18, 20, 24, 30],
    make: (size) => g(`snake-${size}`, `贪吃蛇 ${size}×${size}`, `Snake ${size}×${size}`, `Ular ${size}×${size}`, { size, wrap: false, speed: 5 },
      `${size}×${size} 贪吃蛇：方向键/WASD/滑动转向；吃到食物长度+1、得分+1；撞墙或撞自己判负；不能反向。`,
      `${size}×${size}：初始长度 3；进食增长；撞墙/撞自己 lost；禁止 180° 反向；食物不在蛇身。`),
  },
  {
    key: 'pong', values: [1.5, 2.5, 3, 3.5, 4, 5, 6],
    make: (speed) => g(`pong-${String(speed).replace('.', '-')}`, `乒乓 ${speed}×`, `Pong ${speed}×`, `Pong ${speed}×`, { ai: true, speed },
      `乒乓（速度 ${speed}）：球拍控制；边界反弹；漏球得分；先到 7 分结束；AI 追球。`,
      `速度 ${speed}；边界反弹；得分与结束条件。`),
  },
  {
    key: 'tictactoe', values: [6, 7, 8, 9, 10, 11, 12],
    make: (n) => g(`tictactoe-${n}`, `${n} 子棋 ${n}×${n}`, `Tic-tac-toe ${n}×${n}`, `Tic-tac-toe ${n}×${n}`, { n, ai: true },
      `${n}×${n} 井字棋：连成 ${n} 个判胜；玩家 X 先手对 AI；棋盘满平局。`,
      `${n}×${n}：${n} 连判胜；满盘平局；AI 挡子。`),
  },
  {
    key: 'hanoi', values: [7, 8, 9, 10, 11, 12, 13],
    make: (disks) => g(`hanoi-${disks}`, `汉诺塔 ${disks} 盘`, `Tower of Hanoi ${disks}`, `Menara Hanoi ${disks}`, { disks },
      `汉诺塔 ${disks} 盘：三根柱子；每次移动最上面的一个盘；大盘不能压小盘；全部移到右柱判胜；统计步数。`,
      `${disks} 盘：合法/非法移动；完成判胜；最少步数 ${2 ** disks - 1}。`),
  },
  {
    key: 'reaction',
    values: [['whack-15', 15], ['whack-60', 60], ['aim-15', 15], ['aim-60', 60], ['reaction-10', 10], ['reaction-20', 20], ['reaction-30', 30]],
    make: ([suffix, time]) => g(suffix, `反应挑战 ${suffix}`, `Reaction ${suffix}`, `Reaksi ${suffix}`, { time },
      `反应挑战（${time} 秒）：按目标出现后尽快点击；点中得分，漏掉不扣分；时间结束统计得分。`,
      `得分初始 0；点中 +1；时间结束结束；重复点击不重复计分。`),
  },
];

for (const L of LADDERS) {
  const f = families.find((x) => x.key === L.key);
  if (!f) continue;
  for (const v of L.values) {
    const item = L.make(v);
    if (!f.variants.some((x) => x.slug === item.slug)) f.variants.push(item);
  }
}

// 展开为游戏条目
export function allGames() {
  const out = [];
  for (const f of families) {
    for (const v of f.variants) {
      out.push({
        slug: v.slug, zh: v.zh, en: v.en, id: v.id,
        cat: f.cat, icon: f.icon, family: f.key,
        params: v.params, spec: v.spec, tests: v.tests,
        state: f.state, stateKeys: f.stateKeys, actionSpec: f.actionSpec, desc: f.desc,
      });
    }
  }
  return out;
}
