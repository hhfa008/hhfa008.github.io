/* Avalon premium — role cards, quest-board copy and Bilibili sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvalonPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'avalon-premium',
    title: 'Avalon 阿瓦隆',
    subtitle: '三次任务，一次暗杀，梅林能否活到最后',
    players: '5 人（官方基础版）',
    duration: '20–30 分钟',
    mood: '身份 / 推理 / 圆桌',
    tagline: '正义方要赢下三次任务，还要在最后躲过刺客的一刀。',
    roles: {
      merlin: {
        name: '梅林',
        side: 'good',
        icon: '✦',
        tone: 'merlin',
        ability: '你知道所有邪恶阵营的玩家是谁（莫甘娜与刺客），但必须隐藏身份。',
        tip: '用投票和组队暗示，但别说得太明白——刺客正在观察谁最像梅林。'
      },
      percival: {
        name: '派西维尔',
        side: 'good',
        icon: '☾',
        tone: 'percival',
        ability: '你知道梅林与莫甘娜是谁，但两人都以「魔法师」身份出现，无法分辨。',
        tip: '保护真正的梅林，同时提防你看到的另一个魔法师其实是莫甘娜。'
      },
      loyal: {
        name: '忠臣',
        side: 'good',
        icon: '❖',
        tone: 'loyal',
        ability: '你没有特殊情报，只能通过发言、投票与任务结果找出邪恶阵营。',
        tip: '保护梅林，但不要盲目相信任何一支队伍。'
      },
      morgana: {
        name: '莫甘娜',
        side: 'evil',
        icon: '◆',
        tone: 'morgana',
        ability: '你与刺客互相认识；在派西维尔眼中，你会伪装成梅林。',
        tip: '利用派西维尔的误判，必要时让任务成功以换取信任。'
      },
      assassin: {
        name: '刺客',
        side: 'evil',
        icon: '†',
        tone: 'assassin',
        ability: '你与莫甘娜互相认识。正义方赢下三次任务后，你可以暗杀梅林。',
        tip: '前期伪装成忠臣，记下谁总是在避开邪恶队伍。'
      }
    },
    roleOrder: ['merlin', 'percival', 'loyal', 'morgana', 'assassin'],
    roleCounts: { merlin: 1, percival: 1, loyal: 1, morgana: 1, assassin: 1 },
    aiNames: ['你', '蓝骑士', '灰袍', '红隼', '夜莺'],
    questSizes: [2, 3, 2, 3, 3],
    questFailCards: [1, 1, 1, 1, 1],
    maxRejects: 5,
    questsToWin: 3,
    playerCount: 5,
    seats: [
      { avatar: '✦', tone: 'merlin' },
      { avatar: '♞', tone: 'loyal' },
      { avatar: '☾', tone: 'percival' },
      { avatar: '†', tone: 'assassin' },
      { avatar: '◆', tone: 'morgana' }
    ],
    soundLabels: {
      role: '身份',
      propose: '提名',
      vote: '投票',
      mission: '任务',
      assassinate: '暗杀',
      win: '结算'
    },
    sources: [
      {
        title: '【桌游规则】阿瓦隆AVALON基础规则讲解',
        up: '是你大菇子呀',
        bv: 'BV1Ym4y1Q7Gq',
        url: 'https://www.bilibili.com/video/BV1Ym4y1Q7Gq',
        points: ['5 人局固定梅林、派西维尔、忠臣、莫甘娜、刺客', '队长提名后全体投票，多数通过', '任务成员秘密提交成功或失败']
      },
      {
        title: '阿瓦隆完整规则',
        up: '桌游鼠王',
        bv: 'BV16CYPzLE7p',
        url: 'https://www.bilibili.com/video/BV16CYPzLE7p',
        points: ['五个任务、八人以上任务四需两张失败', '正义方完成三次任务后进入暗杀环节', '连续五次组队被否决由邪恶方获胜']
      },
      {
        title: '《阿瓦隆》桌游教学',
        up: '雷老板向太阳',
        bv: 'BV1JZtZetESQ',
        url: 'https://www.bilibili.com/video/BV1JZtZetESQ',
        points: ['派西维尔看到梅林与莫甘娜但无法区分', '邪恶玩家互相认识并可以破坏任务', '刺客若暗杀梅林，邪恶方直接翻盘']
      }
    ]
  };
});
