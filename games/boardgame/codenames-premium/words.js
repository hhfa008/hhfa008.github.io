/* Codenames Premium — Chinese word bank.
 * UMD: require() in Node, window.CodenamesWords in the browser.
 *
 * 20 themed groups, 275 unique words. Every word belongs to one primary group
 * and inherits the group's extra tags, which gives the clue AI several honest
 * angles (e.g. 苹果 → 水果 / 食物) without shipping a second data table.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodenamesWords = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GROUPS = [
    {
      name: '水果', also: ['食物'], clues: ['果味', '果园'],
      words: ['苹果', '香蕉', '西瓜', '葡萄', '菠萝', '草莓', '橙子', '桃子',
        '梨', '樱桃', '芒果', '柠檬', '石榴', '荔枝']
    },
    {
      name: '蔬菜', also: ['食物'], clues: ['青菜', '菜园'],
      words: ['白菜', '萝卜', '番茄', '黄瓜', '茄子', '土豆', '南瓜', '菠菜',
        '洋葱', '辣椒', '蘑菇', '玉米', '豌豆', '芹菜']
    },
    {
      name: '陆地动物', also: ['动物'], clues: ['野兽', '陆地'],
      words: ['老虎', '熊猫', '大象', '狮子', '长颈鹿', '斑马', '猴子', '兔子',
        '狼', '狐狸', '熊', '鹿', '骆驼', '松鼠']
    },
    {
      name: '鸟类', also: ['动物'], clues: ['飞禽', '有翅膀'],
      words: ['猫头鹰', '老鹰', '麻雀', '鹦鹉', '企鹅', '天鹅', '孔雀', '鸽子',
        '乌鸦', '燕子', '火烈鸟', '啄木鸟', '鸵鸟', '海鸥']
    },
    {
      name: '海洋生物', also: ['动物', '自然'], clues: ['水下', '海鲜'],
      words: ['海豚', '鲸鱼', '鲨鱼', '章鱼', '水母', '海龟', '珊瑚', '海星',
        '龙虾', '螃蟹', '海马', '小丑鱼', '乌贼', '海豹']
    },
    {
      name: '昆虫', also: ['动物'], clues: ['虫子', '小虫'],
      words: ['蝴蝶', '蜜蜂', '蚂蚁', '蜻蜓', '蜘蛛', '甲虫', '蝉', '萤火虫',
        '螳螂', '蜗牛', '瓢虫', '蚊子', '毛毛虫']
    },
    {
      name: '食物', also: ['饮食'], clues: ['美食', '吃的'],
      words: ['面条', '火锅', '饺子', '包子', '米饭', '披萨', '汉堡', '寿司',
        '蛋糕', '面包', '巧克力', '冰淇淋', '薯条', '沙拉', '月饼']
    },
    {
      name: '饮品', also: ['饮食'], clues: ['饮料', '喝的'],
      words: ['咖啡', '茶', '牛奶', '果汁', '可乐', '啤酒', '红酒', '豆浆',
        '奶茶', '矿泉水', '柠檬水', '酸奶', '椰子水']
    },
    {
      name: '交通工具', also: ['城市'], clues: ['出行', '交通'],
      words: ['地铁', '飞机', '自行车', '轮船', '火车', '汽车', '公交车',
        '出租车', '摩托车', '直升机', '热气球', '滑板', '帆船', '高铁']
    },
    {
      name: '城市设施', also: ['城市'], clues: ['市区', '公共设施'],
      words: ['学校', '医院', '银行', '超市', '公园', '图书馆', '电影院',
        '博物馆', '车站', '机场', '广场', '邮局', '餐厅', '酒店']
    },
    {
      name: '建筑', also: ['城市'], clues: ['楼房', '建筑物'],
      words: ['桥', '塔', '城堡', '教堂', '摩天楼', '隧道', '大坝', '灯塔',
        '体育馆', '剧院', '宫殿', '寺庙', '城墙']
    },
    {
      name: '学校', also: ['学习'], clues: ['校园', '上课'],
      words: ['黑板', '书包', '考试', '操场', '铅笔', '橡皮', '课本', '教室',
        '课桌', '粉笔', '作业', '校服', '讲台', '实验室']
    },
    {
      name: '职业', also: ['人物'], clues: ['工作', '职场'],
      words: ['医生', '教师', '厨师', '宇航员', '警察', '消防员', '律师',
        '工程师', '画家', '歌手', '演员', '农民', '飞行员', '科学家']
    },
    {
      name: '家庭', also: ['生活'], clues: ['家人', '居家'],
      words: ['妈妈', '爸爸', '爷爷', '奶奶', '厨房', '沙发', '卧室', '阳台',
        '餐桌', '摇篮', '全家福', '钥匙', '门铃']
    },
    {
      name: '运动', also: ['竞技'], clues: ['体育', '比赛'],
      words: ['篮球', '足球', '游泳', '滑雪', '马拉松', '网球', '羽毛球',
        '乒乓球', '排球', '体操', '拳击', '冲浪', '攀岩', '射箭']
    },
    {
      name: '自然', also: ['地理'], clues: ['野外', '大自然'],
      words: ['森林', '沙漠', '海洋', '火山', '瀑布', '草原', '峡谷', '冰川',
        '山洞', '湖泊', '河流', '岛屿', '沼泽', '绿洲']
    },
    {
      name: '天气', also: ['自然'], clues: ['气象', '天气现象'],
      words: ['下雨', '彩虹', '台风', '雪花', '雷电', '龙卷风', '大雾', '冰雹',
        '晴天', '乌云', '露水', '霜', '沙尘暴']
    },
    {
      name: '颜色', also: ['视觉'], clues: ['色彩', '色调'],
      words: ['红色', '蓝色', '绿色', '黄色', '紫色', '橙色', '黑色', '白色',
        '粉色', '灰色', '金色', '银色', '棕色']
    },
    {
      name: '科技', also: ['未来'], clues: ['科学', '技术'],
      words: ['手机', '电脑', '机器人', '火箭', '卫星', '互联网', '人工智能',
        '激光', '电池', '芯片', '无人机', '虚拟现实', '打印机', '雷达']
    },
    {
      name: '节日', also: ['庆祝'], clues: ['庆典', '过节'],
      words: ['春节', '中秋', '生日', '婚礼', '圣诞', '万圣节', '端午节',
        '元宵节', '情人节', '国庆节', '感恩节', '复活节', '毕业典礼', '周年庆']
    }
  ];

  var cache = null;

  function all() {
    if (cache) return cache.map(function (w) {
      return { text: w.text, tags: w.tags.slice(), group: w.group };
    });
    var seen = Object.create(null);
    cache = [];
    GROUPS.forEach(function (g) {
      var tags = [g.name].concat(g.also || []);
      g.words.forEach(function (text) {
        if (seen[text]) return;
        seen[text] = 1;
        cache.push({ text: text, tags: tags.slice(), group: g.name });
      });
    });
    return cache.map(function (w) {
      return { text: w.text, tags: w.tags.slice(), group: w.group };
    });
  }

  function size() { return all().length; }

  return {
    GROUPS: GROUPS,
    all: all,
    size: size,
    groups: function () { return GROUPS.map(function (g) { return g.name; }); }
  };
}));
