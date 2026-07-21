// 名人名句与散文诗词，每次启动程序随机展示一条
export interface Quote {
  text: string;
  author: string;
}

export const quotes: Quote[] = [
  { text: '世界上只有一种真正的英雄主义，那就是在认清生活的真相后依然热爱生活。', author: '罗曼·罗兰' },
  { text: '人生天地之间，若白驹之过隙，忽然而已。', author: '庄子' },
  { text: '山中何事？松花酿酒，春水煎茶。', author: '张可久' },
  { text: '醉后不知天在水，满船清梦压星河。', author: '唐珙' },
  { text: '生活不可能像你想象得那么好，但也不会像你想象得那么糟。', author: '莫泊桑' },
  { text: '浮世三千，吾爱有三：日月与卿。日为朝，月为暮，卿为朝朝暮暮。', author: '佚名' },
  { text: '从前的日色变得慢，车马邮件都慢，一生只够爱一个人。', author: '木心' },
  { text: '少年与爱永不老去，即便披荆斩棘，丢失怒马鲜衣。', author: '佚名' },
  { text: '我们听过无数的道理，却仍旧过不好这一生。', author: '韩寒' },
  { text: '纵有疾风起，人生不言弃。', author: '堀辰雄' },
  { text: '优于别人，并不高贵，真正的高贵应该是优于过去的自己。', author: '海明威' },
  { text: '宠辱不惊，看庭前花开花落；去留无意，望天上云卷云舒。', author: '洪应明' },
  { text: '人生如逆旅，我亦是行人。', author: '苏轼' },
  { text: '你不愿意种花，你说，我不愿看见它一点点凋落。是的，为了避免结束，你避免了一切开始。', author: '顾城' },
  { text: '我来不及认真地年轻，待明白过来时，只能选择认真地老去。', author: '三毛' },
  { text: '每一个不曾起舞的日子，都是对生命的辜负。', author: '尼采' },
  { text: '黑夜给了我黑色的眼睛，我却用它寻找光明。', author: '顾城' },
  { text: '人生亦如旅途，一切美好与温暖都将会如星辰般藏匿于流年的缝隙里。', author: '佚名' },
  { text: '此心安处是吾乡。', author: '苏轼' },
  { text: '愿你一生努力，一生被爱，想要的都拥有，得不到的都释怀。', author: '八月长安' },
  { text: '人间有味是清欢。', author: '苏轼' },
  { text: '但愿人长久，千里共婵娟。', author: '苏轼' },
  { text: '采菊东篱下，悠然见南山。', author: '陶渊明' },
  { text: '不乱于心，不困于情，不畏将来，不念过往。如此，安好。', author: '丰子恺' },
  { text: '岁月不饶人，我亦未曾饶过岁月。', author: '木心' },
  { text: '你若盛开，蝴蝶自来；你若精彩，天自安排。', author: '佚名' },
  { text: '一个人拥有此生此世是不够的，他还应该拥有诗意的世界。', author: '王小波' },
  { text: '所谓无底深渊，下去，也是前程万里。', author: '木心' },
  { text: '满地都是六便士，他却抬头看见了月亮。', author: '毛姆' },
  { text: '纵然伤心，也不要愁眉不展，因为你不知是谁会爱上你的笑容。', author: '泰戈尔' },
];

/**
 * 根据日期种子生成伪随机数，保证同一天内展示同一条名句
 */
export function getDailyQuote(): Quote {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const index = seed % quotes.length;
  return quotes[index];
}
