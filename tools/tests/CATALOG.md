# 100 工具总目录（含已有 12 个）

目标：/tools/ 下 100 个单文件工具，新增工具 zh/en/id 页内切换、零外部请求、有 Node 测试、可被大厅目录驱动；screen-share-calc（EN/ID/VI/TH）与 sari-sari（EN/ID/FIL）为存量例外。
公共契约见仓库内 `tools/tests/CONTRACT.md`；测试基建见 `/Users/fa/games/AGENTS.md`。

## 分类与计数（合计 100）

1. 计算与财务 calc-finance：21
2. 文本与开发 text-dev：24
3. 设计与图片 design-image：12
4. 日期与时间 date-time：8
5. 数学 math：10
6. 健康 health：9
7. 生活与家居 life-home：7
8. 随机与趣味 random-fun：8
9. 记账 ledger：1

## 已有 12 个

- screen-share-calc — 屏幕共享延迟/带宽计算器 — text-dev
- sari-sari-ledger — 杂货店赊账本 — ledger
- percentage-calculator — 百分比计算器 — calc-finance
- unit-converter — 单位换算器 — calc-finance
- loan-calculator — 贷款月供计算器 — calc-finance
- date-calculator — 日期计算器 — date-time
- bmi-calculator — BMI 与每日热量 — health
- text-tools — 文本工具箱 — text-dev
- json-formatter — JSON 格式化 — text-dev
- password-generator — 密码生成器 — text-dev
- tip-splitter — 小费与分账 — calc-finance
- pomodoro-timer — 番茄钟 — date-time

## 新增 88 个详细规格

### A. 计算与财务（17 个新增；加已有 4 个 = 21）

1. compound-interest-calculator — 复利计算器 / Compound Interest Calculator / Kalkulator Bunga Majemuk
   本金、年利率、年限、复利频率（年/半年/季/月/日）、可选每月追加。输出终值、总利息、本金与利息占比、逐年表。引擎：compound(P,r,years,freq,monthlyAdd)；逐年 schedule；校验。
   测试：10000/5%/10 年按年=16288.95；按月复利更高；0 利率；追加；非法频率；表末值=终值。

2. savings-goal-calculator — 储蓄目标计算器 / Savings Goal Calculator / Kalkulator Target Tabungan
   目标金额、当前储蓄、年利率、目标月数 → 每月需存；或给定每月储蓄 → 达成月数。两种方向。引擎：monthlyNeeded(target,current,rate,months)、monthsToGoal(target,current,rate,monthly)。
   测试：0 利率、已达目标、负利率不允许、月数=0、四舍五入、单调性。

3. inflation-calculator — 通胀购买力计算器 / Inflation Calculator / Kalkulator Inflasi
   金额、年通胀率、年数 → 未来购买力/未来等价金额；支持反向（未来金额折现）。引擎：futureValue、presentValue、purchasingPower。
   测试：100 元 3% 10 年≈134.39；反向；0%；负通胀；边界。

4. discount-calculator — 折扣计算器 / Discount Calculator / Kalkulator Diskon
   原价、折扣 %、第二件折扣/固定减免（可选）、税（可选）→ 省多少、实付、单价。引擎：applyDiscount、finalPrice。
   测试：100 打 8 折=80；折上折；固定减免不低于 0；0%；舍入。

5. vat-calculator — 含税/不含税计算器 / VAT Calculator / Kalkulator PPN
   金额、税率 %、模式（价外加税 / 价内含税）→ 税额、净额、总额。引擎：addVat、extractVat。
   测试：100+10%=110；110 含 10%=100 净额；0%；负数拒绝；舍入。

6. salary-converter — 时薪月薪年薪换算 / Salary Converter / Konversi Gaji
   金额 + 周期（时/日/周/月/年）、每周工时、每年工作周 → 其余周期等值，税前。引擎：toAnnual、fromAnnual、allPeriods。
   测试：时薪 100×40×52=208000/年；月→年；往返；0 工时拒绝；周工时上限。

7. overtime-pay-calculator — 加班费计算器 / Overtime Pay Calculator / Kalkulator Lembur
   月薪/时薪、标准工时、工作日/休息日/节假日加班小时、倍率（1.5/2/3 可调）→ 加班费与总收入。引擎：hourlyFromMonthly、overtimePay、breakdown。
   测试：月薪 8000/21.75/8 时薪；1.5 倍；三类相加；0；非法倍率。

8. freelance-rate-calculator — 自由职业报价计算器 / Freelance Rate Calculator / Kalkulator Tarif Freelance
   目标年收入、每年可计费周、每周可计费小时、非计费比例、税费/平台费 → 建议时薪/日薪/项目价。引擎：hourlyRate、dayRate、projectPrice。
   测试：目标 30 万、48 周、30 时、20% 非计费；平台费；往返；0 输入拒绝。

9. break-even-calculator — 盈亏平衡计算器 / Break-Even Calculator / Kalkulator Titik Impas
   固定成本、单位售价、单位变动成本 → 盈亏平衡销量、销售额、安全边际（可选实际销量）。引擎：breakEvenUnits、breakEvenRevenue、marginOfSafety。
   测试：固定 10000、售价 50、变动 30 → 500 件；售价≤变动报错；安全边际；小数向上取整。

10. profit-margin-calculator — 毛利率/加价率计算器 / Profit Margin Calculator / Kalkulator Margin Laba
    成本、售价 → 毛利、毛利率、加价率；或目标毛利率反推售价。引擎：margin、markup、priceForMargin。
    测试：成本 60 售价 100 → 毛利 40、毛利率 40%、加价 66.67%；反推；成本 0 报错。

11. roi-calculator — 投资回报率计算器 / ROI Calculator / Kalkulator ROI
    投入成本、回报金额、持有年数（可选）→ ROI、年化 ROI、净收益。引擎：roi、annualizedRoi、netGain。
    测试：投入 1000 回报 1500 → 50%；年化 2 年≈22.47%；亏损；0 成本拒绝。

12. debt-payoff-calculator — 债务还款计算器 / Debt Payoff Calculator / Kalkulator Pelunasan Utang
    多笔债务（余额/年利率/最低还款）+ 每月额外预算，比较雪崩（高利率优先）与雪球（低余额优先）→ 还清月数、总利息。引擎：simulateDebts(debts,extra,strategy)、compare。
    测试：单笔；两笔策略差异；额外预算缩短；最小还款不足利息时提示；总额守恒。

13. retirement-calculator — 退休储蓄计算器 / Retirement Calculator / Kalkulator Pensiun
    当前年龄、退休年龄、当前储蓄、月存、年化回报、退休后年支出、预期寿命 → 退休时余额、可支撑年数、缺口。引擎：futureBalance、yearsSustained、gap。
    测试：已知终值；0 回报；退休年龄≤当前报错；缺口正负；边界。

14. rent-split-calculator — 合租分摊计算器 / Rent Split Calculator / Kalkulator Bagi Sewa
    房租、水电等附加、按房间面积/人数/自定义权重分摊，输出每人均摊与明细。引擎：splitByWeights(total, weights)、equalSplit。
    测试：权重和；分项和=总额（最大余数）；0 权重；单人；非法。

15. fuel-cost-calculator — 油费计算器 / Fuel Cost Calculator / Kalkulator Biaya BBM
    距离、油耗（L/100km 或 km/L 或 MPG）、油价 → 总油费、每公里成本、所需油量。引擎：fuelNeeded、tripCost，单位切换。
    测试：500km、7L/100km、8 元/L=280；MPG 换算；0 距离；单位往返。

16. electricity-cost-calculator — 电费计算器 / Electricity Cost Calculator / Kalkulator Biaya Listrik
    电器功率 W、每天小时、天数、电价/kWh → 用电量、费用；支持多电器清单。引擎：kwh、cost、sumAppliances。
    测试：1000W×2h×30=60kWh；电价；多电器；0；功率上限。

17. aspect-ratio-calculator — 宽高比计算器 / Aspect Ratio Calculator / Kalkulator Rasio Aspek
    已知宽/高/比例任两项求第三项；常见比例预设（16:9、4:3、1:1、9:16、21:9）；缩放保持比例。引擎：solve、scale、simplifyRatio。
    测试：1920×1080=16:9；求高；简化；非法 0；小数比。

### B. 文本与开发（20 个新增；加已有 4 个 = 24）

18. case-converter — 大小写转换器 / Case Converter / Konverter Huruf
    句子、标题、全大写、全小写、驼峰、帕斯卡、蛇形、烤肉串、常量、交替；实时统计。引擎：toTitle、toSentence、toCamel、toPascal、toSnake、toKebab、toConstant、toAlternating。
    测试：含缩写/数字/空格/下划线/连字符边界；空串；Unicode；幂等。

19. lorem-ipsum-generator — Lorem Ipsum 生成器 / Lorem Ipsum Generator / Generator Lorem Ipsum
    段落数/句数/词数、是否以 "Lorem ipsum" 开头、是否加 HTML 标签；中英说明。引擎：generateWords、generateSentences、generateParagraphs（种子可选）。
    测试：词数准确；段数；首句；无重复标点；种子可复现。

20. slug-generator — URL 别名生成器 / Slug Generator / Generator Slug
    文本 → 小写连字符 slug；支持保留 Unicode（中文）、音译开关（不做复杂音译则说明）、去停用词、最大长度、分隔符。引擎：slugify。
    测试：空格/标点/连续分隔符；中文保留；大小写；长度截断；空串。

21. uuid-generator — UUID 生成器 / UUID Generator / Generator UUID
    v4（crypto.getRandomValues）、数量 1–100、大小写/连字符选项、批量复制。引擎：uuidV4(rng)、batch。
    测试：格式、版本位、变体位、唯一性、禁用 Math.random、批量数量。

22. hash-generator — 哈希生成器 / Hash Generator / Generator Hash
    文本 → SHA-1/256/384/512（WebCrypto），hex/base64，大小写；比较两段文本哈希。引擎：需异步 crypto.subtle，纯 Node 测试用 node:crypto 注入；导出 normalizeHex。
    测试：已知 "abc" SHA-256；hex 长度；base64；不同输入；空串；大小写。

23. base64-encoder — Base64 编解码 / Base64 Encoder & Decoder / Encoder Base64
    UTF-8 文本 ↔ Base64；URL-safe 选项；文件转 Base64（本地 FileReader）；错误提示。引擎：encodeUtf8、decodeUtf8、toUrlSafe、fromUrlSafe。
    测试：中文往返；emoji；空串；非法 Base64；URL-safe；换行容忍。

24. url-encoder — URL 编解码 / URL Encoder & Decoder / Encoder URL
    encodeURIComponent / encodeURI / 解码；URL 结构拆解（协议/主机/路径/查询参数表）；查询串构建。引擎：encodeComponent、decodeComponent、parseUrl、buildQuery。
    测试：中文/空格/&/=/+/%；非法百分号；重复参数；空查询。

25. html-entity-encoder — HTML 实体转义 / HTML Entity Encoder / Encoder Entitas HTML
    & < > " ' ↔ 实体；命名/数字实体选项；反转义。引擎：escapeHtml、unescapeHtml、toNumericEntities。
    测试：五字符；已有实体不重复转义（反转义再转义）；Unicode；空串；XSS 样例。

26. jwt-decoder — JWT 解码器 / JWT Decoder / Dekoder JWT
    本地解码 header/payload（base64url），显示 exp/iat/nbf 本地时间与过期状态；明确“不验证签名，勿粘贴真实敏感 token”。引擎：decodePart、decodeJwt、claimsStatus。
    测试：标准三段 token；URL-safe；非法段；过期/未生效；不验证签名提示。

27. regex-tester — 正则测试器 / Regex Tester / Penguji Regex
    模式、flags（g/i/m/s/u/y）、测试文本；高亮全部匹配、捕获组表、替换预览；非法正则就地错误；常用预设（email/URL/日期）。引擎：execAll、replaceAll、validatePattern（防 ReDoS 提示不保证）。
    测试：全局匹配索引；捕获组；零宽匹配不无限循环；非法 flags；替换 $1；空模式。

28. cron-explainer — Cron 表达式解释器 / Cron Expression Explainer / Penjelas Cron
    5 段 cron（分 时 日 月 周），支持 * , - /；解释中文描述；计算接下来 5 次运行时间；常用预设。引擎：parseCron、describe、nextRuns。
    测试：*/5 * * * *；0 9 * * 1-5；月末/闰年；非法段；时区说明（本地时间）。

29. text-diff — 文本差异对比 / Text Diff / Pembanding Teks
    两段文本按行 LCS diff，显示新增/删除/未变，统计行数；忽略空白/大小写选项；并排或统一视图。引擎：diffLines。
    测试：插入/删除/替换；空文本；全等；忽略空白；大文本性能上限。

30. markdown-preview — Markdown 预览 / Markdown Preview / Pratinjau Markdown
    安全子集：标题、粗斜体、行内代码、代码块、列表、引用、链接、水平线；先转义 HTML 再渲染受控标签；导出 HTML/复制。引擎：escapeHtml、renderMarkdown（返回安全 HTML 字符串）。
    测试：XSS 被转义；标题/列表/代码块；链接；嵌套；空串。

31. csv-to-json — CSV 转 JSON / CSV to JSON / CSV ke JSON
    分隔符（, ; tab |）、引号、首行表头、类型推断开关、嵌套点号键选项；错误行列提示；下载 JSON。引擎：parseCsv、toJson、inferValue。
    测试：引号内逗号/换行；空字段；CRLF；表头重复；类型推断；非法引号。

32. json-to-csv — JSON 转 CSV / JSON to CSV / JSON ke CSV
    数组对象 → CSV；并集键、嵌套展平、分隔符、引号转义、BOM 选项；下载。引擎：flatten、toCsv。
    测试：键并集；嵌套；逗号/引号/换行转义；空数组；非数组报错；BOM。

33. xml-formatter — XML 格式化 / XML Formatter / Formatter XML
    DOMParser 校验并格式化缩进；压缩；错误行列；CDATA/注释保留；本地文件读取。引擎需可在 Node 测试：用简单 tokenizer（不依赖 DOMParser）或注入 parser。定义 parse/format 纯函数。
    测试：嵌套缩进；自闭合；属性；CDATA；非法标签；压缩往返。

34. json-to-typescript — JSON 转 TypeScript / JSON to TypeScript / JSON ke TypeScript
    JSON → interface/type，合并数组元素、可选/可空推断、根类型命名、导出开关；非法 JSON 行列。引擎：inferType、toTypeScript。
    测试：嵌套对象；数组混合类型联合；null；根数组；命名；非法 JSON。

35. css-formatter — CSS 格式化 / CSS Formatter / Formatter CSS
    格式化/压缩 CSS；保留注释选项；错误大括号就地提示；选择器/声明缩进。引擎：formatCss、minifyCss（保守，不处理字符串内花括号则报错或说明）。
    测试：规则缩进；压缩；字符串内花括号；注释；空输入；不配对报错。

36. color-converter — 颜色格式转换 / Color Converter / Konverter Warna
    HEX/RGB/HSL/HSV/CMYK 互转；颜色名；对比度（WCAG AA/AAA）；预览色块；随机色。引擎：hexToRgb、rgbToHsl、hslToRgb、rgbToCmyk、contrastRatio、parseColor。
    测试：#b93d12 往返；黑白对比 21:1；HSL 边界；3 位 HEX；非法；CMYK。

37. number-base-converter — 进制转换 / Number Base Converter / Konverter Basis Angka
    2/8/10/16 及自定义 2–36 进制；大整数用 BigInt；带符号/小数（有限精度说明）；分组显示。引擎：convertBase、parseBase、formatGroup。
    测试：255↔FF；BigInt 大数；负数；非法数字；2 进制；36 进制。

### C. 设计与图片（12 个新增）

38. color-palette-generator — 配色方案生成器 / Color Palette Generator / Generator Palet Warna
    基色 → 互补/类似/三角/四角/单色/明暗梯度；每个色显示 HEX/复制；导出 CSS 变量/JSON。引擎：harmonies(hex)、shades(hex)、toCssVars。
    测试：互补色；5 色数量；HSL 环绕；明暗单调；CSS 输出。

39. gradient-generator — CSS 渐变生成器 / CSS Gradient Generator / Generator Gradasi CSS
    线性/径向；多色标（增删、位置）、角度；实时预览；复制 CSS；预设。引擎：buildGradient(config)、normalizeStops。
    测试：线性/径向字符串；角度；色标排序；最少 2 色；非法颜色。

40. box-shadow-generator — 阴影生成器 / Box Shadow Generator / Generator Bayangan
    x/y/模糊/扩散/颜色/透明度/inset，多阴影层；实时预览；复制 CSS。引擎：buildShadow(layers)。
    测试：单层；多层逗号；inset；0 值；颜色 alpha；非法层。

41. border-radius-generator — 圆角生成器 / Border Radius Generator / Generator Sudut
    四角独立圆角 + 斜杠椭圆语法；预设（胶囊/圆形/叶子）；复制 CSS。引擎：buildRadius(tl,tr,br,bl)。
    测试：单值省略；四值；椭圆语法；百分比；负值拒绝。

42. image-compressor — 图片压缩 / Image Compressor / Kompres Gambar
    本地选择 JPG/PNG/WebP；质量/最大宽高；canvas 压缩；显示前后体积与压缩率；下载；多图队列。所有处理本地。引擎：targetSize(w,h,max)、qualityFor？主要是 UI；纯函数 calculateDimensions、formatBytes。
    测试：尺寸缩放保持比例；不放大；formatBytes；质量边界；非图片拒绝。

43. image-resizer — 图片缩放 / Image Resizer / Pengubah Ukuran Gambar
    指定宽/高/百分比，锁定比例；canvas 输出；批量；下载。引擎：resizeDimensions(w,h,opts)。
    测试：锁定比例；只给宽；百分比；不放大；0 拒绝；批量命名。

44. image-to-base64 — 图片转 Base64 / Image to Base64 / Gambar ke Base64
    选择图片 → data URI，显示大小与 MIME；复制 CSS background/HTML img；限制 5MB。引擎：bytesToBase64、mimeFromName、formatBytes。
    测试：小字节编码；MIME；大小；空文件；Base64 往返。

45. image-rotate — 图片旋转翻转 / Image Rotate & Flip / Putar & Balik Gambar
    90° 步进旋转、水平/垂直翻转；canvas 输出；下载；保持格式。引擎：rotateDimensions、nextAngle。
    测试：90/180/270 尺寸；角度归一；翻转组合；0 度。

46. qr-code-generator — 二维码生成器 / QR Code Generator / Generator Kode QR
    文本/URL/WiFi/电话/短信模板；纠错等级 L/M/Q/H；尺寸；颜色；下载 PNG/SVG。需内嵌完整 QR 编码器（byte mode，版本自适应），不得外链。引擎：encodeQR(text,ec) 返回矩阵；测试固定输入矩阵尺寸/定位图案/版本边界；用已知短文本的矩阵哈希回归（自生成基准需谨慎，至少验证结构）。
    测试：定位图案；版本 1/2/10 尺寸；纠错等级；超长报错；UTF-8；静区。

47. barcode-generator — 条形码生成器 / Barcode Generator / Generator Barcode
    Code 128B（数字/字母），校验位；SVG/PNG 下载；显示编码值。引擎：encodeCode128(text) → 位串；测试校验位、起止符、已知值。
    测试：已知 "ABC" 模式宽度；校验位；非法字符；SVG 生成。

48. favicon-generator — Favicon 生成器 / Favicon Generator / Generator Favicon
    文字/emoji/底色/圆角 → PNG 16/32/180/192/512 下载；预览；说明放置路径。canvas。引擎：hexToRgb、clampSize、suggestNames。
    测试：尺寸集合；颜色；文本截断；文件命名。

49. placeholder-image-generator — 占位图生成器 / Placeholder Image Generator / Generator Gambar Placeholder
    宽高、底色、文字色、文字、格式 PNG/JPG/WebP → canvas 下载；常用尺寸预设。引擎：parseDimension、buildLabel。
    测试：尺寸；默认文案；上限 4096；格式 MIME；非法输入。

### D. 随机与趣味（8 个新增）

50. random-number-generator — 随机数生成器 / Random Number Generator / Generator Angka Acak
    范围、数量、是否唯一、是否排序、小数位；crypto 随机；批量复制。引擎：randomInt(min,max,rng)、uniqueSample、randomFloat。
    测试：范围边界；唯一；数量>范围报错；小数位；rng 确定性；无偏（大样本）。

51. name-picker — 随机点名器 / Random Name Picker / Pemilih Nama Acak
    名单（每行一个）、不重复抽取、历史、重置；crypto 洗牌。引擎：parseNames、pickOne、shuffle。
    测试：去空行；不重复；抽完提示；单名；洗牌置换。

52. dice-roller — 骰子模拟器 / Dice Roller / Pelempar Dadu
    d4/d6/d8/d10/d12/d20/d100，数量，修正值；总和/明细；历史。引擎：rollDice(sides,count,mod,rng)。
    测试：范围；数量；修正；d20 暴击提示可选；rng 确定性；非法面数。

53. coin-flip — 抛硬币 / Coin Flip / Lempar Koin
    单次/多次（10/100/1000），正反统计与百分比；动画可选。引擎：flip(count,rng) → {heads,tails,sequence}。
    测试：总数；百分比；rng 确定性；0/负数拒绝。

54. lottery-number-generator — 彩票号码生成器 / Lottery Number Generator / Generator Nomor Lotre
    选号范围、每注个数、注数、是否唯一；常见预设（6/49、5/35+2）；仅娱乐声明。引擎：drawTicket(pool,count,rng)、batch。
    测试：数量；范围；不重复；多注；池小于选号报错；声明存在。

55. team-generator — 随机分组器 / Team Generator / Pembagi Tim
    名单、组数或每组人数；随机均衡分组；显示各组；复制。引擎：splitTeams(names,groups,rng)。
    测试：人数分配差≤1；空名单；组数>人数；确定性 rng；去重。

56. list-shuffler — 列表洗牌器 / List Shuffler / Pengacak Daftar
    每行一项 → 随机顺序；可设种子复现；编号选项；复制。引擎：shuffleSeeded(list,seed)。
    测试：元素守恒；种子复现；空/单元素；编号。

57. decision-wheel — 转盘决定器 / Decision Wheel / Roda Keputusan
    选项列表 → 旋转转盘（SVG/canvas）、随机结果、历史；crypto；动画 reduced-motion。引擎：pickIndex(weights,rng)、polarToCartesian。
    测试：权重选择；等权；单项；空选项；角度计算。

### E. 日期与时间（6 个新增；加已有 2 个 = 8）

58. stopwatch — 秒表 / Stopwatch / Stopwatch
    开始/暂停/重置/计次；毫秒显示；键盘；页面隐藏不丢失（performance.now 基准）。引擎：elapsed(start,now,pausedTotal)、formatMs、lapSplit。
    测试：格式；累计；计次差；0；跨暂停。

59. countdown-timer — 倒计时器 / Countdown Timer / Timer Hitung Mundur
    时/分/秒输入、开始/暂停/重置、快捷 1/3/5/10 分钟、结束提示（WebAudio/标题）；不依赖通知权限。引擎：clampDuration、remaining(end,now)、format。
    测试：格式；剩余不为负；结束；快捷值；非法。

60. world-clock — 世界时钟 / World Clock / Jam Dunia
    选择城市/时区（Intl.supportedValuesOf('timeZone') 可用则用），显示当地日期时间、与本地时差、昼夜标记；秒更新。引擎：formatInZone、offsetMinutes。
    测试：UTC 与 Asia/Shanghai 时差；跨日；DST 说明；非法时区。

61. timezone-converter — 时区转换器 / Timezone Converter / Konverter Zona Waktu
    某时区日期时间 → 另一时区；会议规划多时区并排；用 Intl 而不是手算偏移。引擎：convertZone(isoLocal,from,to)、parseLocal。
    测试：UTC→上海 +8；跨日；非法时区；纽约 DST 日期（用 Intl 期望值）；格式。

62. unix-timestamp-converter — 时间戳转换器 / Unix Timestamp Converter / Konverter Timestamp
    Unix 秒/毫秒 ↔ 本地/UTC ISO；当前时间戳实时；解析多格式；复制。引擎：toUnix、fromUnix、detectUnit。
    测试：0；已知 1700000000；毫秒自动识别；负时间；ISO 往返。

63. week-number-calculator — 周数计算器 / Week Number Calculator / Kalkulator Nomor Minggu
    日期 → ISO 周数/年、周起止日；周数+年份 → 日期范围；今天快捷。引擎：isoWeek(date)、weekRange(year,week)、weeksInYear。
    测试：2024-01-01=第1周；2023-01-01=52 周 2022；2024-12-30=2025 第1周；闰年；非法周。

### F. 数学（10 个新增）

64. fraction-calculator — 分数计算器 / Fraction Calculator / Kalkulator Pecahan
    两分数 + − × ÷，化简、带分数、小数；BigInt 防溢出。引擎：gcd、simplify、add/sub/mul/div、toMixed。
    测试：1/2+1/3=5/6；约分；负分数；除零；BigInt 大数；带分数。

65. gcd-lcm-calculator — 最大公约数/最小公倍数 / GCD & LCM Calculator / KPK & FPB
    多个整数 → GCD/LCM、质因数分解；BigInt。引擎：gcd、lcm、factorize。
    测试：12/18→6/36；多数；0 规则；负数；大数；LCM 溢出用 BigInt。

66. prime-factorizer — 质因数分解器 / Prime Factorizer / Faktorisasi Prima
    整数 → 质因数、指数形式、是否为质数、约数个数/和；试除 + 6k±1；大数上限。引擎：factorize、isPrime、divisorCount。
    测试：12=2²·3；质数；1；0/负数；大数；约数和。

67. statistics-calculator — 统计计算器 / Statistics Calculator / Kalkulator Statistik
    数据集 → 个数、和、均值、中位数、众数、极差、方差、标准差（样本/总体）、四分位；支持逗号/空格/换行。引擎：parseNumbers、mean、median、mode、variance、stdev、quartiles。
    测试：已知数据集；奇偶中位数；多众数；单值；空；样本/总体分母。

68. quadratic-solver — 一元二次方程求解 / Quadratic Solver / Penyelesai Persamaan Kuadrat
    ax²+bx+c=0 → 判别式、实根/复根、顶点、因式形式；a=0 退化为一次。引擎：solveQuadratic。
    测试：x²-3x+2→1,2；无实根→复根；a=0；重根；极小系数。

69. triangle-calculator — 三角形计算器 / Triangle Calculator / Kalkulator Segitiga
    已知三边（SSS）→ 面积（海伦）、角度、周长、类型；或两边夹角（SAS）；校验三角不等式。引擎：sss、sas、heron、classify。
    测试：3-4-5；等边；退化；非法；角度和 180；面积。

70. circle-calculator — 圆计算器 / Circle Calculator / Kalkulator Lingkaran
    半径/直径/周长/面积任一项 → 其余；扇形/弧长可选。引擎：solveCircle、sector。
    测试：r=5；周长/面积；直径输入；扇形；0 拒绝。

71. area-volume-calculator — 面积体积计算器 / Area & Volume Calculator / Luas & Volume
    常用图形：矩形/三角形/圆/梯形；立方体/长方体/圆柱/球/圆锥；输入切换；显示公式。引擎：areaOf、volumeOf、shape metadata。
    测试：各图形已知值；0；球体积；圆柱；非法。

72. speed-distance-time-calculator — 速度距离时间 / Speed Distance Time / Kecepatan Jarak Waktu
    三项知二求一；单位（km/h、m/s、mph、节）；时间格式 h:m:s；换算。引擎：solveSDT、parseDuration、formatDuration。
    测试：100km/2h=50km/h；求时间；求距离；单位换算；0 时间拒绝；h:m:s。

73. roman-numeral-converter — 罗马数字转换 / Roman Numeral Converter / Konverter Angka Romawi
    1–3999 双向；校验非法形式（IIII、VX）；大写/小写；逐步解释。引擎：toRoman、fromRoman、validate。
    测试：1994=MCMXCIV；4=IV；9=IX；4000 拒绝；非法；往返。

### G. 健康（8 个新增；加已有 1 个 = 9）

74. water-intake-calculator — 饮水量计算器 / Water Intake Calculator / Kalkulator Air Minum
    体重、活动时长、气候、孕哺状态 → 建议饮水量（ml/杯）；说明非医疗建议。引擎：dailyWater(kg,activityMin,climate,pregnant)。
    测试：基础 35ml/kg；运动追加；气候；孕哺；0；范围。

75. sleep-cycle-calculator — 睡眠周期计算器 / Sleep Cycle Calculator / Kalkulator Siklus Tidur
    入睡时间或起床时间 → 90 分钟周期建议（4/5/6 周期）、预留入睡时间；显示多个时间。引擎：wakeTimes、bedTimes、addMinutes。
    测试：5 周期 +15 分入睡；跨午夜；格式；非法时间；周期数。

76. pregnancy-due-date-calculator — 预产期计算器 / Due Date Calculator / Kalkulator HPL
    末次月经首日 → Naegele 规则（+280 天）、当前孕周；说明仅供参考。引擎：dueDate、gestationalAge。
    测试：已知日期；280 天；跨年；非法/未来日期；孕周。

77. ideal-weight-calculator — 理想体重计算器 / Ideal Weight Calculator / Berat Badan Ideal
    身高、性别 → Devine/Robinson/Miller/Hamwi 四种公式、范围；说明仅供估算。引擎：devine、robinson、miller、hamwi。
    测试：已知身高；男女差异；范围；非法；厘米/英寸。

78. macro-calculator — 宏量营养素计算器 / Macro Calculator / Kalkulator Makro
    热量目标、饮食比例（均衡/高蛋白/低碳/自定义）→ 蛋白/碳水/脂肪克数；说明非医疗建议。引擎：macroSplit(calories,ratios)、validateRatios。
    测试：2000 kcal 30/40/30；克数换算；比例和 100；非法；自定义。

79. heart-rate-zones — 心率区间计算器 / Heart Rate Zones / Zona Detak Jantung
    年龄（或最大心率）→ 5 区间（50–60/60–70/70–80/80–90/90–100%）；Karvonen 可选静息心率；说明。引擎：maxHr、zones、karvonen。
    测试：30 岁最大 190；区间边界；Karvonen；非法年龄；区间顺序。

80. steps-to-distance — 步数距离换算 / Steps to Distance / Langkah ke Jarak
    步数、步长（或身高估算）→ 距离 km/mi、消耗热量（体重可选）；反向。引擎：distanceFromSteps、stepsFromDistance、calories。
    测试：10000 步×0.7m=7km；反向；身高估算；热量；0。

81. pace-calculator — 配速计算器 / Pace Calculator / Kalkulator Pace
    距离 + 时间 → 配速/速度；已知配速 → 完赛时间；常见距离预设（5K/10K/半马/全马）；分段表。引擎：pace、finishTime、splitTable、parseTime。
    测试：10km/50min=5:00/km；速度；完赛；拆分；非法。

### H. 生活与家居（7 个新增；加已有 0 个 = 7）

82. cooking-converter — 烹饪单位换算 / Cooking Measurement Converter / Konversi Ukuran Masak
    杯/汤匙/茶匙/毫升/液量盎司 ↔ 克/盎司/磅；按食材密度（水 1.0、面粉 0.53、糖 0.85、米 0.85、黄油 0.911、牛奶 1.03 g/ml）换算；常见食材表与近似说明。
    引擎：volumeToMl、weightToG、convertIngredient(amount,from,to,ingredient)、ingredients。
    测试：1 cup 水≈236.6ml；1 tbsp≈14.79ml；1 cup 面粉≈125g；1 oz=28.3495g；往返；未知食材；0；负值拒绝。

82. grade-calculator — 成绩/GPA 计算器 / Grade Calculator / Kalkulator Nilai
    作业/考试条目（分数、权重）→ 加权总分、等级；GPA 4.0/4.3 映射；还差多少分；说明因学校而异。引擎：weightedGrade、gpa、neededForTarget。
    测试：加权；权重和≠100 归一化；缺项；目标分；GPA 映射；非法。

83. recipe-scaler — 食谱份量换算 / Recipe Scaler / Pengubah Porsi Resep
    原份数/目标份数、配料行（数量+单位+名称）→ 缩放；杯/克/毫升友好格式；取整选项。引擎：scaleFactor、scaleIngredients、formatAmount。
    测试：2→6 倍；分数；0 拒绝；格式化；单位不变。

84. paint-calculator — 涂料用量计算器 / Paint Calculator / Kalkulator Cat
    房间长宽高、门窗面积、涂刷遍数、每升覆盖面积 → 需涂料升数/桶数；可多房间。引擎：wallArea、paintLiters、buckets。
    测试：已知房间；扣门窗；两遍；向上取整；0。

85. tile-calculator — 瓷砖用量计算器 / Tile Calculator / Kalkulator Keramik
    面积（或长宽）、瓷砖尺寸、损耗 %、每箱片数 → 片数/箱数；单位切换。引擎：tilesNeeded、boxesNeeded、area。
    测试：面积/砖面积；损耗；箱数向上；单位；0 拒绝。

86. paper-size-converter — 纸张尺寸转换 / Paper Size Converter / Konverter Ukuran Kertas
    A/B/C 系列、Letter/Legal、像素（按 DPI）；尺寸表；缩放比例。引擎：paperSize、toPixels、scaleRatio。
    测试：A4=210×297；A0 面积是 A4 的 16 倍；Letter；DPI 像素；非法。

87. shoe-size-converter — 鞋码转换器 / Shoe Size Converter / Konverter Ukuran Sepatu
    脚长 cm ↔ EU/US/UK/JP 尺码（男/女/儿童表）；四舍五入与半码；说明品牌差异。引擎：cmToSize、sizeToCm、table lookup。
    测试：25cm 男 EU 40；往返；半码；女/儿童；非法范围。

## 批次分配（每个 batch 一个子 agent）

- finance-1（6）：compound-interest, savings-goal, inflation, discount, vat, salary-converter- finance-2（6）：overtime-pay, freelance-rate, break-even, profit-margin, roi, debt-payoff
- finance-3（5）：retirement, rent-split, fuel-cost, electricity-cost, aspect-ratio
- text-1（7）：case-converter, lorem-ipsum, slug, uuid, hash, base64, url-encoder
- text-2（6）：html-entities, jwt-decoder, regex-tester, cron-explainer, text-diff, markdown-preview
- data-1（7）：csv-to-json, json-to-csv, xml-formatter, json-to-typescript, css-formatter, color-converter, number-base-converter
- design-1（6）：color-palette, gradient-generator, box-shadow, border-radius, favicon, placeholder-image
- image-1（6）：image-compressor, image-resizer, image-to-base64, image-rotate, qr-code, barcode
- random-1（8）：random-number, name-picker, dice-roller, coin-flip, lottery-number, team-generator, list-shuffler, decision-wheel
- time-1（6）：stopwatch, countdown-timer, world-clock, timezone-converter, unix-timestamp, week-number
- math-1（5）：fraction, gcd-lcm, prime-factorizer, statistics, quadratic
- math-2（5）：triangle, circle, area-volume, speed-distance-time, roman-numeral
- health-1（4）：water-intake, sleep-cycle, pregnancy-due-date, ideal-weight
- health-2（4）：macro-calculator, heart-rate-zones, steps-to-distance, pace-calculator
- life-1（7）：cooking-converter, grade, recipe-scaler, paint, tile, paper-size, shoe-size

合计新增：6+6+5+7+6+7+6+6+8+6+5+5+4+4+7 = 88。

## 统一验收

- 每页遵守仓库内 `tools/tests/CONTRACT.md`；使用仓库内 `tools/tests/scaffold/scaffold.html` 起稿。
- 每页 `tools/tests/<slug>.test.js`，≥ 10 条引擎断言（复杂工具建议更多）+ 三语键一致 + data-i 键 + 静态合规。
- `node games/tests/run-all.js` 0 失败（工具测试全部并入）。
- `node games/tests/browser-check.js` 对每个新页 3 语全 PASS（390/320 无溢出、触控 ≥44×44px、零外链、无 console error、深色模式）。
- 不编造验证结果。
